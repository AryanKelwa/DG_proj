import { NextRequest, NextResponse } from "next/server";
import { calculatePrintPrice } from "@/modules/pricing/pricing-engine";
import { getProductById } from "@/modules/catalog/catalog-store";
import { z } from "zod";

const PricingRequestSchema = z.object({
  productId: z.string(),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  materialId: z.string(),
  quantity: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = PricingRequestSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid pricing parameters", details: validated.error.format() },
        { status: 400 }
      );
    }

    const { productId, widthMm, heightMm, materialId, quantity } = validated.data;
    const product = await getProductById(productId);

    if (!product || !product.is_active) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Dimensional limits check (§ 04)
    if (widthMm < product.min_width_mm || widthMm > product.max_width_mm) {
      return NextResponse.json(
        { error: `Width must be between ${product.min_width_mm}mm and ${product.max_width_mm}mm` },
        { status: 422 }
      );
    }

    if (heightMm < product.min_height_mm || heightMm > product.max_height_mm) {
      return NextResponse.json(
        { error: `Height must be between ${product.min_height_mm}mm and ${product.max_height_mm}mm` },
        { status: 422 }
      );
    }

    const breakdown = calculatePrintPrice({
      product,
      widthMm,
      heightMm,
      materialId,
      quantity,
    });

    return NextResponse.json(breakdown);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
