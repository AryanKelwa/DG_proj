import { NextRequest, NextResponse } from "next/server";
import { mergeVariableDataCsv } from "@/modules/variable-data/csv-merger";
import { z } from "zod";

const VariableMergeRequestSchema = z.object({
  orderId: z.string().default("DH-VAR-001"),
  productType: z.string().default("RaceBibs"),
  widthMm: z.number().positive().default(210),
  heightMm: z.number().positive().default(148),
  bleedMm: z.number().nonnegative().default(3.0),
  csvContent: z.string().min(10),
  fieldMappings: z.object({
    numberCol: z.string(),
    nameCol: z.string(),
    subCol: z.string().optional(),
    barcodeCol: z.string().optional(),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = VariableMergeRequestSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid CSV merge request", details: validated.error.format() },
        { status: 400 }
      );
    }

    const result = await mergeVariableDataCsv(validated.data);

    // Return the multi-page compiled PDF
    return new NextResponse(Buffer.from(result.pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "X-W2P-Total-Rows": String(result.totalRows),
        "X-W2P-Processed": String(result.processedRows),
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Variable merge server error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
