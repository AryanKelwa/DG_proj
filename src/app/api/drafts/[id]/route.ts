import { NextRequest, NextResponse } from "next/server";
import { getDraft, updateDraft, calculateDraftPrice } from "@/modules/drafts/draft-store";
import { getAuthUser } from "@/lib/server-auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const draft = getDraft(id);

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const sessionUser = getAuthUser(req);
    // If draft belongs to a specific customer, enforce customer ownership
    if (draft.customerId && sessionUser && sessionUser.role !== "admin") {
      if (draft.customerId !== sessionUser.id) {
        return NextResponse.json(
          { error: "Forbidden: You do not have permission to view this draft" },
          { status: 403 }
        );
      }
    }

    const pricing = calculateDraftPrice(draft);

    return NextResponse.json({ draft, pricing });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to load draft";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const draft = getDraft(id);
    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const sessionUser = getAuthUser(req);
    if (draft.customerId && sessionUser && sessionUser.role !== "admin") {
      if (draft.customerId !== sessionUser.id) {
        return NextResponse.json(
          { error: "Forbidden: You do not have permission to update this draft" },
          { status: 403 }
        );
      }
    }

    const actor = {
      id: sessionUser?.id || body.actorId || "customer-session",
      email: sessionUser?.email || body.actorEmail || "customer@w2p.co.uk",
    };

    const updated = updateDraft(id, body.updates || {}, actor, body.action || "DRAFT_UPDATED");
    const pricing = calculateDraftPrice(updated);

    return NextResponse.json({ draft: updated, pricing });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to update draft";
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }
}
