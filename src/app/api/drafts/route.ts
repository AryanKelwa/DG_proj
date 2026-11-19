import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDraft, calculateDraftPrice } from "@/modules/drafts/draft-store";

const CreateDraftSchema = z.object({
  productId: z.string(),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  materialId: z.string(),
  quantity: z.number().int().positive(),
  orientation: z.enum(["portrait", "landscape", "square"]).optional(),
  customerId: z.string().nullable().optional(),
  customerEmail: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = CreateDraftSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid draft configuration", details: validated.error.format() },
        { status: 400 }
      );
    }

    const draft = await createDraft(validated.data);
    const pricing = await calculateDraftPrice(draft);

    return NextResponse.json({ draft, pricing }, { status: 201 });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to create draft";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
