import { test, expect } from "@playwright/test";
import { checkApprovalGate, processProofRevisionRequest, processProofApproval } from "../src/modules/proofs/proof-generator";
import { ProofRecord } from "../src/modules/proofs/types";

test.describe("W5. Proofs & Approval Gate (PRD §08)", () => {
  const initialProofV1: ProofRecord = {
    id: "prf-ord-test-01-v1",
    orderId: "ord-test-01",
    orderItemId: "item-01",
    version: 1,
    status: "pending_review",
    previewUrl: "https://w2p.example/proofs/v1.svg",
    metadata: {
      orderId: "ord-test-01",
      productName: "Downhill MTB Plate",
      version: 1,
      createdAt: new Date().toISOString(),
    },
    customerFeedback: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date().toISOString(),
  };

  test("PRD §08: Requesting changes on proof v1 preserves v1 as changes_requested and spawns v2 as pending_review", async () => {
    const feedback = "Please increase athlete name size and change plate background to bright yellow.";

    const { updatedCurrent, nextRevision } = processProofRevisionRequest(initialProofV1, feedback);

    // Assert v1 is preserved with status 'changes_requested' and customer note
    expect(updatedCurrent.version).toBe(1);
    expect(updatedCurrent.status).toBe("changes_requested");
    expect(updatedCurrent.customerFeedback).toBe(feedback);

    // Assert v2 is spawned with incremented version and 'pending_review' status
    expect(nextRevision.version).toBe(2);
    expect(nextRevision.status).toBe("pending_review");
    expect(nextRevision.approvedBy).toBeNull();
    expect(nextRevision.customerFeedback).toBeNull();
  });

  test("PRD §08: Approving proof v2 records approved_by, timestamp, and transitions state to APPROVED", async () => {
    const proofV2: ProofRecord = {
      ...initialProofV1,
      id: "prf-ord-test-01-v2",
      version: 2,
      status: "pending_review",
    };

    const approverEmail = "sarah@enduroclub.uk";
    const approvedResult = processProofApproval(proofV2, approverEmail);

    expect(approvedResult.version).toBe(2);
    expect(approvedResult.status).toBe("approved");
    expect(approvedResult.approvedBy).toBe(approverEmail);
    expect(approvedResult.approvedAt).toBeDefined();
    expect(new Date(approvedResult.approvedAt!).getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("PRD §08 & §11: Approval Gate strictly locks production file access before formal approval", async ({
    request,
  }) => {
    // 1. Pending review gate check
    const pendingGate = checkApprovalGate("pending_review");
    expect(pendingGate.isUnlocked).toBe(false);
    expect(pendingGate.reason).toContain("Awaiting customer proof inspection");

    // 2. Changes requested gate check
    const changesGate = checkApprovalGate("changes_requested");
    expect(changesGate.isUnlocked).toBe(false);
    expect(changesGate.reason).toContain("Customer requested artwork revisions");

    // 3. Approved gate check
    const approvedGate = checkApprovalGate("approved");
    expect(approvedGate.isUnlocked).toBe(true);

    // 4. API level: verify approve endpoint records approval and returns unlocked gate
    const approveRes = await request.post("/api/proofs/prf-ord-test-01-v2/approve", {
      data: {
        orderId: "ord-test-01",
        version: 2,
        approvedBy: "sarah@enduroclub.uk",
      },
    });

    expect(approveRes.status()).toBe(200);
    const approveJson = await approveRes.json();
    expect(approveJson.success).toBe(true);
    expect(approveJson.approvalGate.isUnlocked).toBe(true);
    expect(approveJson.status).toBe("approved");
  });

  test("PRD §08: Customer requests changes via /api/proofs/[id]/reject API endpoint", async ({
    request,
  }) => {
    const rejectRes = await request.post("/api/proofs/prf-ord-test-01-v1/reject", {
      data: {
        orderId: "ord-test-01",
        currentVersion: 1,
        feedback: "Please move the logo 5mm to the right for handlebar clearance.",
      },
    });

    expect(rejectRes.status()).toBe(200);
    const rejectJson = await rejectRes.json();
    expect(rejectJson.success).toBe(true);
    expect(rejectJson.status).toBe("changes_requested");
    expect(rejectJson.nextVersion).toBe(2);
    expect(rejectJson.approvalGate.isUnlocked).toBe(false);
  });
});
