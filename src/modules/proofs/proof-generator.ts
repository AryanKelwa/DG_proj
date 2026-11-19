import { ProofRecord, ProofMetadata, ApprovalGateCheckResult } from "./types";
import { ProofStatus } from "@/types/database";

/**
 * The Approval Gate Engine (§ 08 & § 11 Capability 02):
 * Print-ready files unlock ONLY once a proof is approved.
 * In the admin panel, the download buttons for 300 DPI production files
 * remain strictly locked/disabled until status === 'approved'.
 */
export function checkApprovalGate(status: ProofStatus): ApprovalGateCheckResult {
  if (status === "approved") {
    return {
      isUnlocked: true,
      status: "approved",
    };
  }

  if (status === "changes_requested") {
    return {
      isUnlocked: false,
      status: "changes_requested",
      reason: "Production Locked: Customer requested artwork revisions (Awaiting updated proof v+1).",
    };
  }

  return {
    isUnlocked: false,
    status: "pending_review",
    reason: "Production Locked: Awaiting customer proof inspection and formal approval (§ 08 Gate).",
  };
}

/**
 * State Transition: Approve Proof (§ 08)
 * Records who approved which version and when.
 */
export function processProofApproval(
  proof: ProofRecord,
  approvedByEmail: string
): ProofRecord {
  return {
    ...proof,
    status: "approved",
    approvedBy: approvedByEmail,
    approvedAt: new Date().toISOString(),
  };
}

/**
 * State Transition: Request Changes (§ 08)
 * Captures revision notes and spawns next revision version (v+1).
 */
export function processProofRevisionRequest(
  currentProof: ProofRecord,
  feedback: string
): { updatedCurrent: ProofRecord; nextRevision: ProofRecord } {
  const updatedCurrent: ProofRecord = {
    ...currentProof,
    status: "changes_requested",
    customerFeedback: feedback,
  };

  const nextVersionNumber = currentProof.version + 1;

  const nextRevision: ProofRecord = {
    id: `prf-${currentProof.orderId}-v${nextVersionNumber}`,
    orderId: currentProof.orderId,
    orderItemId: currentProof.orderItemId,
    version: nextVersionNumber,
    status: "pending_review",
    previewUrl: currentProof.previewUrl,
    metadata: {
      ...currentProof.metadata,
      version: nextVersionNumber,
      createdAt: new Date().toISOString(),
    },
    customerFeedback: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date().toISOString(),
  };

  return {
    updatedCurrent,
    nextRevision,
  };
}

/**
 * Generates an SVG/Canvas Watermarked Visual Proof with Metadata (§ 08)
 */
export function generateWatermarkedProofSvg(meta: ProofMetadata, artworkSvgOrContent?: string): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
      <!-- Background -->
      <rect width="800" height="600" fill="#0D0F14" />
      
      <!-- Technical Pre-Press Header Banner -->
      <rect x="0" y="0" width="800" height="45" fill="#171A21" />
      <text x="20" y="28" font-family="monospace" font-size="12" font-weight="bold" fill="#FF5A1F">
        W2P PROOF VERIFICATION · REVISION v${meta.version}
      </text>
      <text x="500" y="28" font-family="monospace" font-size="11" fill="#8690A2">
        ORDER: ${meta.orderNumber} | BLEED: +${meta.bleedMm}mm
      </text>
      
      <!-- Inner Artwork Target Boundary -->
      <rect x="80" y="80" width="640" height="440" fill="#FFFFFF" rx="8" />
      
      <!-- Artwork Content Placeholder -->
      <g transform="translate(100, 120)">
        <text x="20" y="60" font-family="sans-serif" font-size="28" font-weight="bold" fill="#111318">
          ${(meta.materialName || meta.productName || "CUSTOM VINYL").toUpperCase()}
        </text>
        <text x="20" y="100" font-family="monospace" font-size="14" fill="#6B7280">
          FINISHED CUT TRIM: ${meta.widthMm || 75}mm × ${meta.heightMm || 75}mm
        </text>
      </g>
      
      <!-- Diagonal Security Watermarks (§ 08) -->
      <g opacity="0.15" fill="#FF5A1F" font-family="monospace" font-size="32" font-weight="900">
        <text x="120" y="260" transform="rotate(-25 120,260)">W2P PROOF · NOT FOR FINAL PRINT</text>
        <text x="160" y="420" transform="rotate(-25 160,420)">UNAPPROVED PRE-PRESS ASSET · REVISION v${meta.version}</text>
      </g>
      
      <!-- Bottom Metadata Bar -->
      <rect x="0" y="555" width="800" height="45" fill="#171A21" />
      <text x="20" y="582" font-family="monospace" font-size="11" fill="#8690A2">
        ISSUED: ${meta.createdAt.slice(0, 10)} | GATE: HIGH-RES 300 DPI LOCKED UNTIL APPROVAL
      </text>
    </svg>
  `.trim();
}
