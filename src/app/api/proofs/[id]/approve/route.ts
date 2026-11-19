import { NextRequest, NextResponse } from "next/server";
import { checkApprovalGate } from "@/modules/proofs/proof-generator";
import { safeSendNotificationEmail } from "@/modules/email/email-service";
import { getAuthUser } from "@/lib/server-auth";
import { getOrderById, updateOrderStageWithVersion } from "@/modules/orders/order-store";
import { updateProof } from "@/modules/proofs/proofs-store";
import { z } from "zod";

const ApproveProofSchema = z.object({
  approvedBy: z.string().email().optional(),
  orderId: z.string(),
  version: z.number().int().positive(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const validated = ApproveProofSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid approval payload", details: validated.error.format() },
        { status: 400 }
      );
    }

    const sessionUser = getAuthUser(req);
    const { orderId, version } = validated.data;
    const order = getOrderById(orderId);

    if (!order) {
      return NextResponse.json({ error: `Order ${orderId} not found` }, { status: 404 });
    }

    // Authorization check: User must own the order or be an admin
    if (sessionUser && sessionUser.role !== "admin") {
      const isOwner =
        order.customer_id === sessionUser.id ||
        order.customer_email?.toLowerCase() === sessionUser.email.toLowerCase();
      if (!isOwner) {
        return NextResponse.json(
          { error: "Forbidden: You do not own this order's proof" },
          { status: 403 }
        );
      }
    }

    const effectiveApproverEmail = sessionUser?.email || validated.data.approvedBy || order.customer_email || "customer@example.com";
    const effectiveApproverName = sessionUser?.full_name || order.customer_name || "Valued Customer";
    const approvedAt = new Date().toISOString();

    const gateResult = checkApprovalGate("approved");

    // Update in-memory / persistent proof store
    updateProof(id, {
      status: "approved",
      approved_by: effectiveApproverEmail,
      approved_at: approvedAt,
    });

    // Advance order proof status
    updateOrderStageWithVersion(
      orderId,
      "PRODUCTION",
      undefined,
      effectiveApproverEmail,
      `Proof v${version} approved by ${effectiveApproverEmail}`
    );

    // PRD § 13: Dispatch proof_approved email notification
    await safeSendNotificationEmail({
      to: effectiveApproverEmail,
      recipientName: effectiveApproverName,
      event: "proof_approved",
      orderId,
      orderNumber: orderId,
      version,
    });

    return NextResponse.json({
      success: true,
      proofId: id,
      orderId,
      version,
      status: "approved",
      approvedBy: effectiveApproverEmail,
      approvedAt,
      approvalGate: gateResult,
      message: `Proof v${version} for order ${orderId} successfully approved. 300 DPI production files are now UNLOCKED.`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Approval processing error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
