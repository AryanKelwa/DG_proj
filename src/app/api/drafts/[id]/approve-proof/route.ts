import { NextRequest, NextResponse } from "next/server";
import { approveDraftProof, calculateDraftPrice } from "@/modules/drafts/draft-store";
import { safeSendNotificationEmail } from "@/modules/email/email-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let actorEmail = "customer@w2p.co.uk";
    let actorId = "usr-customer-1";

    try {
      const body = await req.json();
      if (body.actorEmail) actorEmail = body.actorEmail;
      if (body.actorId) actorId = body.actorId;
    } catch {
      // Body is optional if session header/context is used
    }

    const updatedDraft = await approveDraftProof(id, { id: actorId, email: actorEmail });
    const pricing = await calculateDraftPrice(updatedDraft);

    // PRD § 13: Customer notification email (proof_approved)
    const approvedProof = updatedDraft.proofs.find((p) => p.version === updatedDraft.proofVersion);
    await safeSendNotificationEmail({
      to: updatedDraft.customerEmail || actorEmail,
      recipientName: "Valued Customer",
      event: "proof_approved",
      orderId: updatedDraft.id,
      orderNumber: updatedDraft.id,
      version: updatedDraft.proofVersion,
      proofHash: approvedProof?.sha256Hash,
    });

    return NextResponse.json({
      success: true,
      draft: updatedDraft,
      pricing,
      message: `Proof v${updatedDraft.proofVersion} formally approved. Production files unlocked. Ready for checkout.`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to approve proof";
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }
}
