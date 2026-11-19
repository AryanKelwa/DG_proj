import { NextRequest, NextResponse } from "next/server";
import { checkApprovalGate } from "@/modules/proofs/proof-generator";
import { safeSendNotificationEmail } from "@/modules/email/email-service";
import { getAuthUser } from "@/lib/server-auth";
import { getOrderById, updateOrderStageWithVersion } from "@/modules/orders/order-store";
import { updateProof } from "@/modules/proofs/proofs-store";
import { z } from "zod";

const RejectProofSchema = z.object({
  feedback: z.string().min(3),
  orderId: z.string(),
  currentVersion: z.number().int().positive(),
  customerEmail: z.string().email().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const validated = RejectProofSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid change request payload", details: validated.error.format() },
        { status: 400 }
      );
    }

    const sessionUser = await getAuthUser(req);
    const { feedback, orderId, currentVersion, customerEmail } = validated.data;
    const order = await getOrderById(orderId);

    if (!order) {
      return NextResponse.json({ error: `Order ${orderId} not found` }, { status: 404 });
    }

    // Authorization check: User must own the order or be an admin
    if (sessionUser && sessionUser.role !== "admin") {
      const isOwner =
        order.customer_id === sessionUser.id;
      if (!isOwner) {
        return NextResponse.json(
          { error: "Forbidden: You do not own this order's proof" },
          { status: 403 }
        );
      }
    }

    const nextVersion = currentVersion + 1;
    const effectiveEmail = sessionUser?.email || customerEmail || order.customer_email || "customer@example.com";
    const effectiveName = sessionUser?.full_name || order.customer_name || "Valued Customer";

    const gateResult = checkApprovalGate("changes_requested");

    // Update proof record in store
    await updateProof(id, {
      status: "changes_requested",
      customer_feedback: feedback,
    });

    await updateOrderStageWithVersion(
      orderId,
      "PROOF",
      undefined,
      effectiveEmail,
      `Customer requested changes: ${feedback}`
    );

    // PRD § 13: Dispatch change_requested email notification
    await safeSendNotificationEmail({
      to: effectiveEmail,
      recipientName: effectiveName,
      event: "change_requested",
      orderId,
      orderNumber: orderId,
      version: currentVersion,
      feedback,
    });

    return NextResponse.json({
      success: true,
      proofId: id,
      orderId,
      status: "changes_requested",
      feedback,
      nextVersion,
      approvalGate: gateResult,
      message: `Revision request for order ${orderId} logged. Staff notified to produce proof v${nextVersion}. Production files remain LOCKED.`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Revision processing error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
