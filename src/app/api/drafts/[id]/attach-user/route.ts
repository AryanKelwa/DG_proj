import { NextRequest, NextResponse } from "next/server";
import { attachDraftToUser } from "@/modules/drafts/draft-store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    if (!body.userId || !body.userEmail) {
      return NextResponse.json(
        { error: "userId and userEmail are required to attach draft" },
        { status: 400 }
      );
    }

    const updatedDraft = attachDraftToUser(id, body.userId, body.userEmail);
    return NextResponse.json({ success: true, draft: updatedDraft });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to attach draft to user";
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }
}
