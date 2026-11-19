import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server-auth";
import { getSavedDesignsForUser, saveDesign } from "@/modules/designs/saved-designs-store";
import { SavedDesign } from "@/types/database";

export async function GET(req: NextRequest) {
  try {
    const sessionUser = await getAuthUser(req);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Valid session required to view saved designs" },
        { status: 401 }
      );
    }

    const designs = await getSavedDesignsForUser(sessionUser.id, sessionUser.role);
    return NextResponse.json({ designs });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to retrieve saved designs";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sessionUser = await getAuthUser(req);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Valid session required to save a design" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const newDesign: SavedDesign = {
      id: body.id || `des-${Date.now()}`,
      customer_id: sessionUser.id,
      product_id: body.productId || "custom-die-cut-vinyl",
      product_name: body.productName || "Custom Die-Cut Vinyl Stickers",
      name: body.name || "Untitled Design",
      width_mm: body.widthMm || 75,
      height_mm: body.heightMm || 75,
      material: body.material || "gloss-white",
      canvas_state: body.canvasState || {},
      preview_url: body.previewUrl || "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const saved = await saveDesign(newDesign);
    return NextResponse.json({ design: saved }, { status: 201 });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to save design";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
