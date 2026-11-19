import { NextRequest, NextResponse } from "next/server";
import { requestDraftProofChanges, calculateDraftPrice } from "@/modules/drafts/draft-store";
import { safeSendNotificationEmail } from "@/modules/email/email-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const feedback = body.feedback || "Customer requested revisions to artwork.";
    const actor = {
      id: body.actorId || "usr-customer-1",
      email: body.actorEmail || "customer@w2p.co.uk",
    };

    const updatedDraft = requestDraftProofChanges(id, feedback, actor);
    const pricing = calculateDraftPrice(updatedDraft);

    // PRD § 13: Customer notifications (change_requested & proof_ready for new revision)
    await safeSendNotificationEmail({
      to: updatedDraft.customerEmail || actor.email,
      recipientName: "Valued Customer",
      event: "change_requested",
      orderId: updatedDraft.id,
      orderNumber: updatedDraft.id,
      version: updatedDraft.proofVersion - 1,
      feedback,
    });

    await safeSendNotificationEmail({
      to: updatedDraft.customerEmail || actor.email,
      recipientName: "Valued Customer",
      event: "proof_ready",
      orderId: updatedDraft.id,
      orderNumber: updatedDraft.id,
      version: updatedDraft.proofVersion,
    });

    return NextResponse.json({
      success: true,
      draft: updatedDraft,
      pricing,
      message: `Changes requested. New revision v${updatedDraft.proofVersion} created in pending review status.`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to request proof changes";
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }
}
