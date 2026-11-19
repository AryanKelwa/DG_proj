import { NextRequest, NextResponse } from "next/server";
import { generateProductionPdf } from "@/modules/print-engine/pdf-generator";
import { z } from "zod";

const PrintRenderRequestSchema = z.object({
  orderId: z.string().default("DH-SAMPLE-01"),
  productType: z.string().default("CustomSticker"),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  bleedMm: z.number().nonnegative().default(3.0),
  canvasState: z.any().optional(),
  customText: z.string().optional(),
  customNumber: z.string().optional(),
  subTitle: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = PrintRenderRequestSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid print generation payload", details: validated.error.format() },
        { status: 400 }
      );
    }

    const result = await generateProductionPdf(validated.data);

    // Return production PDF binary stream
    return new NextResponse(Buffer.from(result.pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "X-W2P-DPI": "300",
        "X-W2P-Bleed-MM": String(result.bleedMm),
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Print engine generation error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
