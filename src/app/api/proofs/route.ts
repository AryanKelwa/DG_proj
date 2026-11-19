import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server-auth";
import { getProofsForUser } from "@/modules/proofs/proofs-store";

export async function GET(req: NextRequest) {
  try {
    const sessionUser = await getAuthUser(req);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Valid session required to view proofs" },
        { status: 401 }
      );
    }

    const proofs = await getProofsForUser(sessionUser.id, sessionUser.role);

    return NextResponse.json({ proofs });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to retrieve proofs";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
