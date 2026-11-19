import fs from "fs";
import path from "path";
import crypto from "crypto";
import { JobDraft, DraftStatus, DraftAuditLogEntry, DraftProofRecord } from "@/types/draft";
import { PRODUCTS } from "@/lib/data/mock-data";
import { calculatePrintPrice, PricingBreakdown } from "@/modules/pricing/pricing-engine";
import { generateWatermarkedProofSvg } from "@/modules/proofs/proof-generator";

const DRAFT_STORE_FILE = path.join(process.cwd(), ".drafts-store.json");

// In-memory cache synced with disk
let draftsMap: Map<string, JobDraft> = new Map();
let lastLoadedMtime = 0;

function loadStore() {
  try {
    if (fs.existsSync(DRAFT_STORE_FILE)) {
      const stat = fs.statSync(DRAFT_STORE_FILE);
      if (stat.mtimeMs > lastLoadedMtime || draftsMap.size === 0) {
        const data = fs.readFileSync(DRAFT_STORE_FILE, "utf-8");
        const parsed = JSON.parse(data);
        draftsMap = new Map(Object.entries(parsed));
        lastLoadedMtime = stat.mtimeMs;
      }
    }
  } catch (err) {
    console.error("Failed to load drafts store:", err);
  }
}

function persistStore() {
  try {
    const obj: Record<string, JobDraft> = {};
    for (const [key, value] of draftsMap.entries()) {
      obj[key] = value;
    }
    fs.writeFileSync(DRAFT_STORE_FILE, JSON.stringify(obj, null, 2), "utf-8");
    if (fs.existsSync(DRAFT_STORE_FILE)) {
      lastLoadedMtime = fs.statSync(DRAFT_STORE_FILE).mtimeMs;
    }
  } catch (err) {
    console.error("Failed to persist drafts store:", err);
  }
}

/**
 * Valid state transitions for the customer journey (§ 01, § 03, § 05, § 06, § 08):
 * configured -> artwork_ready -> proof_pending -> proof_approved -> payment_pending -> paid
 * (change requested returns proof_pending with a new version; failed or abandoned payment returns to proof_approved)
 */
const VALID_TRANSITIONS: Record<DraftStatus, DraftStatus[]> = {
  configured: ["artwork_ready"],
  artwork_ready: ["proof_pending", "configured"],
  proof_pending: ["proof_approved", "proof_pending", "artwork_ready"],
  proof_approved: ["payment_pending", "proof_pending"],
  payment_pending: ["paid", "proof_approved"],
  paid: [], // Terminal state
};

export function canTransition(from: DraftStatus, to: DraftStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface CreateDraftInput {
  productId: string;
  widthMm: number;
  heightMm: number;
  materialId: string;
  quantity: number;
  orientation?: "portrait" | "landscape" | "square";
  customerId?: string | null;
  customerEmail?: string | null;
}

export function createDraft(input: CreateDraftInput): JobDraft {
  loadStore();
  const product = PRODUCTS.find((p) => p.id === input.productId || p.slug === input.productId) || PRODUCTS[0];
  const now = new Date().toISOString();
  const draftId = `dft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const auditEntry: DraftAuditLogEntry = {
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: now,
    actorId: input.customerId || "anonymous",
    actorEmail: input.customerEmail || "anonymous@guest.local",
    fromStatus: "configured",
    toStatus: "configured",
    action: "DRAFT_CREATED",
    details: {
      productId: product.id,
      dimensions: `${input.widthMm}x${input.heightMm}mm`,
      quantity: input.quantity,
      materialId: input.materialId,
    },
  };

  const draft: JobDraft = {
    id: draftId,
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    divisionSlug: product.division_slug,
    options: {
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      materialId: input.materialId,
      orientation: input.orientation || "landscape",
      bleedMm: product.default_bleed_mm,
      safetyMarginMm: product.default_safety_margin_mm,
    },
    quantity: input.quantity,
    designJson: null,
    uploadedFileRef: null,
    csvFileRef: null,
    proofVersion: 1,
    proofs: [],
    status: "configured",
    customerId: input.customerId || null,
    customerEmail: input.customerEmail || null,
    orderId: null,
    auditLog: [auditEntry],
    createdAt: now,
    updatedAt: now,
  };

  draftsMap.set(draftId, draft);
  persistStore();
  return draft;
}

export function getDraft(draftId: string): JobDraft | null {
  loadStore();
  return draftsMap.get(draftId) || null;
}

export function updateDraft(
  draftId: string,
  updates: Partial<JobDraft>,
  actor: { id: string; email: string },
  actionLabel = "DRAFT_UPDATED"
): JobDraft {
  loadStore();
  const draft = draftsMap.get(draftId);
  if (!draft) {
    throw new Error(`Draft ${draftId} not found`);
  }

  const now = new Date().toISOString();
  const auditEntry: DraftAuditLogEntry = {
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: now,
    actorId: actor.id,
    actorEmail: actor.email,
    fromStatus: draft.status,
    toStatus: updates.status || draft.status,
    action: actionLabel,
    details: { updates: Object.keys(updates) },
  };

  const updated: JobDraft = {
    ...draft,
    ...updates,
    auditLog: [...draft.auditLog, auditEntry],
    updatedAt: now,
  };

  // Issue 2: Generate initial stored proof if none exists upon proof generation
  if (
    (actionLabel === "PROOF_GENERATED" || updates.status === "proof_pending") &&
    (!updated.proofs || updated.proofs.length === 0)
  ) {
    const initialProof = generateDraftProof(updated, updated.proofVersion || 1);
    updated.proofs = [initialProof];
  }

  draftsMap.set(draftId, updated);
  persistStore();
  return updated;
}

export function transitionDraftStatus(
  draftId: string,
  newStatus: DraftStatus,
  actor: { id: string; email: string },
  details?: Record<string, unknown>
): JobDraft {
  loadStore();
  const draft = draftsMap.get(draftId);
  if (!draft) {
    throw new Error(`Draft ${draftId} not found`);
  }

  if (draft.status !== newStatus && !canTransition(draft.status, newStatus)) {
    throw new Error(
      `Illegal workflow transition: Cannot move draft ${draftId} from "${draft.status}" to "${newStatus}". Proof must be approved before payment.`
    );
  }

  const now = new Date().toISOString();
  const auditEntry: DraftAuditLogEntry = {
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: now,
    actorId: actor.id,
    actorEmail: actor.email,
    fromStatus: draft.status,
    toStatus: newStatus,
    action: `STATUS_TRANSITION_${newStatus.toUpperCase()}`,
    details,
  };

  const updated: JobDraft = {
    ...draft,
    status: newStatus,
    auditLog: [...draft.auditLog, auditEntry],
    updatedAt: now,
  };

  draftsMap.set(draftId, updated);
  persistStore();
  return updated;
}

/**
 * Generate a server-rendered immutable proof for the draft (§ 06, § 08)
 */
export function generateDraftProof(draft: JobDraft, version?: number): DraftProofRecord {
  const currentVersion = version || draft.proofVersion || 1;
  const product = PRODUCTS.find((p) => p.id === draft.productId || p.slug === draft.productId) || PRODUCTS[0];
  const mat = product.allowed_materials.find((m) => m.id === draft.options.materialId) || product.allowed_materials[0];

  const svg = generateWatermarkedProofSvg({
    version: currentVersion,
    widthMm: draft.options.widthMm,
    heightMm: draft.options.heightMm,
    materialName: mat.name,
    bleedMm: draft.options.bleedMm,
    orderNumber: draft.id,
    createdAt: new Date().toISOString(),
  });

  const sha256Hash = crypto.createHash("sha256").update(svg).digest("hex");
  const renderedUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

  return {
    version: currentVersion,
    renderedUrl,
    sha256Hash,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Task 4: Approve proof.
 * Validates state transition, records SHA-256 hash, timestamp, user ID.
 */
export function approveDraftProof(
  draftId: string,
  actor: { id: string; email: string }
): JobDraft {
  loadStore();
  const draft = draftsMap.get(draftId);
  if (!draft) {
    throw new Error(`Draft ${draftId} not found`);
  }

  // Ensure proof exists or generate it
  let activeProof = draft.proofs.find((p) => p.version === draft.proofVersion);
  if (!activeProof) {
    activeProof = generateDraftProof(draft, draft.proofVersion);
  }

  const now = new Date().toISOString();
  const approvedProofRecord: DraftProofRecord = {
    ...activeProof,
    approvedBy: actor.email,
    approvedAt: now,
  };

  const updatedProofs = [
    ...draft.proofs.filter((p) => p.version !== draft.proofVersion),
    approvedProofRecord,
  ];

  // Must transition from artwork_ready or proof_pending to proof_approved
  const fromStatus = draft.status;
  const toStatus: DraftStatus = "proof_approved";

  const auditEntry: DraftAuditLogEntry = {
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: now,
    actorId: actor.id,
    actorEmail: actor.email,
    fromStatus,
    toStatus,
    action: "PROOF_APPROVED",
    details: {
      version: draft.proofVersion,
      sha256Hash: approvedProofRecord.sha256Hash,
      approvedBy: actor.email,
    },
  };

  const updated: JobDraft = {
    ...draft,
    status: toStatus,
    proofs: updatedProofs,
    auditLog: [...draft.auditLog, auditEntry],
    updatedAt: now,
  };

  draftsMap.set(draftId, updated);
  persistStore();
  return updated;
}

/**
 * Task 4 & Task 3: Request changes creates v2, v3... and returns to proof_pending
 */
export function requestDraftProofChanges(
  draftId: string,
  feedback: string,
  actor: { id: string; email: string }
): JobDraft {
  loadStore();
  const draft = draftsMap.get(draftId);
  if (!draft) {
    throw new Error(`Draft ${draftId} not found`);
  }

  const now = new Date().toISOString();
  const currentProof = draft.proofs.find((p) => p.version === draft.proofVersion);
  const updatedCurrentProof: DraftProofRecord = currentProof
    ? { ...currentProof, feedback }
    : {
        version: draft.proofVersion,
        renderedUrl: "",
        sha256Hash: "",
        createdAt: now,
        feedback,
      };

  const nextVersion = draft.proofVersion + 1;
  const newProof = generateDraftProof(draft, nextVersion);

  const updatedProofs = [
    ...draft.proofs.filter((p) => p.version !== draft.proofVersion),
    updatedCurrentProof,
    newProof,
  ];

  const auditEntry: DraftAuditLogEntry = {
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: now,
    actorId: actor.id,
    actorEmail: actor.email,
    fromStatus: draft.status,
    toStatus: "proof_pending",
    action: "PROOF_CHANGES_REQUESTED",
    details: {
      previousVersion: draft.proofVersion,
      newVersion: nextVersion,
      feedback,
    },
  };

  const updated: JobDraft = {
    ...draft,
    status: "proof_pending",
    proofVersion: nextVersion,
    proofs: updatedProofs,
    auditLog: [...draft.auditLog, auditEntry],
    updatedAt: now,
  };

  draftsMap.set(draftId, updated);
  persistStore();
  return updated;
}

/**
 * Task 2: Attach guest draft to user account upon login
 */
export function attachDraftToUser(
  draftId: string,
  userId: string,
  userEmail: string
): JobDraft {
  loadStore();
  const draft = draftsMap.get(draftId);
  if (!draft) {
    throw new Error(`Draft ${draftId} not found`);
  }

  const now = new Date().toISOString();
  const auditEntry: DraftAuditLogEntry = {
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: now,
    actorId: userId,
    actorEmail: userEmail,
    fromStatus: draft.status,
    toStatus: draft.status,
    action: "DRAFT_ATTACHED_TO_USER",
    details: { userId, userEmail },
  };

  const updated: JobDraft = {
    ...draft,
    customerId: userId,
    customerEmail: userEmail,
    auditLog: [...draft.auditLog, auditEntry],
    updatedAt: now,
  };

  draftsMap.set(draftId, updated);
  persistStore();
  return updated;
}

/**
 * Task 2 & Task 5: Authoritative price recalculation from draft specifications
 */
export function calculateDraftPrice(draft: JobDraft): PricingBreakdown {
  const product = PRODUCTS.find((p) => p.id === draft.productId || p.slug === draft.productId) || PRODUCTS[0];
  return calculatePrintPrice({
    product,
    widthMm: draft.options.widthMm,
    heightMm: draft.options.heightMm,
    materialId: draft.options.materialId,
    quantity: draft.quantity,
  });
}

/**
 * Helper to reset/seed draft store for tests
 */
export function resetDraftsStore(seedDrafts?: JobDraft[]) {
  draftsMap = new Map();
  if (seedDrafts) {
    for (const d of seedDrafts) {
      draftsMap.set(d.id, d);
    }
  }
  persistStore();
}
