import { NextRequest, NextResponse } from "next/server";
import { getOrderById, verifySignedDownloadToken } from "@/modules/orders/order-store";
import { generateProductionPdf } from "@/modules/print-engine/pdf-generator";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    const order = await getOrderById(id);
    if (!order) {
      return NextResponse.json({ error: `Order '${id}' not found` }, { status: 404 });
    }

    if (!token || !verifySignedDownloadToken(order.order_number, token)) {
      return NextResponse.json(
        { error: "Forbidden: Invalid or expired production download token." },
        { status: 403 }
      );
    }

    // Generate high-resolution 300 DPI production PDF package
    const firstItem = order.items?.[0];
    const widthMm = firstItem?.width_mm || 75;
    const heightMm = firstItem?.height_mm || 75;

    const pdfResult = await generateProductionPdf({
      orderId: order.order_number,
      productType: order.division_slug || "labels-stickers",
      widthMm,
      heightMm,
      bleedMm: 3.0,
      customText: order.customer_name || "Production Print Run",
    });

    const headers = new Headers();
    headers.set("Content-Type", "application/pdf");
    headers.set(
      "Content-Disposition",
      `attachment; filename="${order.order_number}_Production_300DPI.pdf"`
    );
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

    return new NextResponse(Buffer.from(pdfResult.pdfBytes), {
      status: 200,
      headers,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Download error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
