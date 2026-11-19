import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server-auth";
import {
  getOrderById,
  checkReadyForProduction,
  generateSignedDownloadToken,
} from "@/modules/orders/order-store";
import { logAdminAction } from "@/modules/audit/audit-store";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if (!auth.authorized) {
    return auth.response!;
  }

  try {
    const { id } = await params;
    const order = await getOrderById(id);

    if (!order) {
      return NextResponse.json({ error: `Order '${id}' not found` }, { status: 404 });
    }

    const gate = checkReadyForProduction(order);
    if (!gate.isReady) {
      return NextResponse.json(
        {
          error: "Order is not ready for production.",
          reason: gate.reason,
          proofApproved: gate.proofApproved,
          paymentConfirmed: gate.paymentConfirmed,
        },
        { status: 403 }
      );
    }

    // Generate short-lived signed download token (60 seconds)
    const { token, expires } = generateSignedDownloadToken(order.order_number, 60);

    // Log admin download action
    await logAdminAction(
      auth.user!.id,
      auth.user!.email,
      "production_file_download",
      "order",
      order.order_number,
      {
        expiresAt: expires,
        proofVersion: order.proof_version || 1,
      }
    );

    const downloadUrl = `/api/admin/orders/${order.order_number}/download-file?token=${token}`;

    return NextResponse.json({
      success: true,
      orderNumber: order.order_number,
      downloadUrl,
      token,
      expiresAt: expires,
      ttlSeconds: 60,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to generate download link";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
