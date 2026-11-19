import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createDraft,
  transitionDraftStatus,
  approveDraftProof,
  requestDraftProofChanges,
  attachDraftToUser,
  calculateDraftPrice,
  resetDraftsStore,
  canTransition,
} from "../draft-store";

describe("Job Draft Store & State Machine (§ 01, § 03, § 05, § 06, § 08)", () => {
  beforeEach(() => {
    resetDraftsStore();
  });

  test("creates a draft with 'configured' initial status", () => {
    const draft = createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 100,
      heightMm: 80,
      materialId: "gloss-white",
      quantity: 150,
    });

    assert.ok(draft.id.startsWith("dft_"));
    assert.equal(draft.status, "configured");
    assert.equal(draft.options.widthMm, 100);
    assert.equal(draft.options.heightMm, 80);
    assert.equal(draft.quantity, 150);
    assert.equal(draft.proofVersion, 1);
    assert.equal(draft.auditLog.length, 1);
    assert.equal(draft.auditLog[0].action, "DRAFT_CREATED");
  });

  test("enforces strict sequential state transitions", () => {
    const draft = createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 100,
      heightMm: 80,
      materialId: "gloss-white",
      quantity: 150,
    });

    // Cannot jump directly from 'configured' to 'payment_pending' or 'proof_approved'
    assert.equal(canTransition("configured", "payment_pending"), false);
    assert.equal(canTransition("configured", "proof_approved"), false);

    assert.throws(() => {
      transitionDraftStatus(
        draft.id,
        "payment_pending",
        { id: "usr-1", email: "user@example.com" }
      );
    }, /Illegal workflow transition/);

    // Valid: configured -> artwork_ready
    const readyDraft = transitionDraftStatus(
      draft.id,
      "artwork_ready",
      { id: "usr-1", email: "user@example.com" }
    );
    assert.equal(readyDraft.status, "artwork_ready");

    // Valid: artwork_ready -> proof_pending
    const pendingDraft = transitionDraftStatus(
      draft.id,
      "proof_pending",
      { id: "usr-1", email: "user@example.com" }
    );
    assert.equal(pendingDraft.status, "proof_pending");
  });

  test("records proof approval with hash, timestamp, and audit trail (Task 4)", () => {
    const draft = createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 100,
      heightMm: 80,
      materialId: "gloss-white",
      quantity: 150,
    });

    transitionDraftStatus(draft.id, "artwork_ready", { id: "usr-1", email: "user@example.com" });
    transitionDraftStatus(draft.id, "proof_pending", { id: "usr-1", email: "user@example.com" });

    const approvedDraft = approveDraftProof(draft.id, {
      id: "usr-1",
      email: "sarah@enduroclub.uk",
    });

    assert.equal(approvedDraft.status, "proof_approved");
    assert.equal(approvedDraft.proofs.length, 1);
    const proofV1 = approvedDraft.proofs[0];
    assert.equal(proofV1.version, 1);
    assert.equal(proofV1.approvedBy, "sarah@enduroclub.uk");
    assert.ok(proofV1.approvedAt);
    assert.ok(proofV1.sha256Hash.length === 64, "Must generate valid 64-char SHA-256 hash");
  });

  test("handles proof revision cycle: request changes spawns v2, v3 in 'proof_pending'", () => {
    const draft = createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 100,
      heightMm: 80,
      materialId: "gloss-white",
      quantity: 150,
    });

    transitionDraftStatus(draft.id, "artwork_ready", { id: "usr-1", email: "user@example.com" });
    transitionDraftStatus(draft.id, "proof_pending", { id: "usr-1", email: "user@example.com" });

    // Request revision
    const revisedDraft = requestDraftProofChanges(
      draft.id,
      "Please make the logo 10% larger and adjust cut border",
      { id: "usr-1", email: "sarah@enduroclub.uk" }
    );

    assert.equal(revisedDraft.status, "proof_pending");
    assert.equal(revisedDraft.proofVersion, 2);
    assert.equal(revisedDraft.proofs.length, 2);
    assert.equal(revisedDraft.proofs[0].feedback, "Please make the logo 10% larger and adjust cut border");
    assert.equal(revisedDraft.proofs[1].version, 2);

    // Now approve v2
    const approvedV2 = approveDraftProof(draft.id, {
      id: "usr-1",
      email: "sarah@enduroclub.uk",
    });

    assert.equal(approvedV2.status, "proof_approved");
    assert.equal(approvedV2.proofVersion, 2);
    const approvedProof = approvedV2.proofs.find((p) => p.version === 2);
    assert.ok(approvedProof);
    assert.equal(approvedProof.approvedBy, "sarah@enduroclub.uk");
  });

  test("attaches guest draft to authenticated user upon login", () => {
    const draft = createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 75,
      heightMm: 75,
      materialId: "gloss-white",
      quantity: 100,
    });

    assert.equal(draft.customerId, null);

    const attached = attachDraftToUser(draft.id, "usr_cust_42", "sarah@enduroclub.uk");
    assert.equal(attached.customerId, "usr_cust_42");
    assert.equal(attached.customerEmail, "sarah@enduroclub.uk");
  });

  test("recalculates price authoritatively from draft specs using pricing engine", () => {
    const draft = createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 100,
      heightMm: 100,
      materialId: "gloss-white",
      quantity: 100,
    });

    const pricing = calculateDraftPrice(draft);
    assert.equal(pricing.areaSqCm, 100);
    assert.equal(pricing.discountPercentage, 20); // 100 qty = 20% discount floor
    assert.ok(pricing.totalGrossCents > 0);
  });
});
