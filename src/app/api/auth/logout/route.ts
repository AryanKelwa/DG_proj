import { NextRequest, NextResponse } from "next/server";
import { revokeSessionToken } from "@/modules/auth/users-store";
import { getSessionTokenFromRequest } from "@/lib/server-auth";

export async function POST(req: NextRequest) {
  try {
    const token = getSessionTokenFromRequest(req);
    if (token) {
      revokeSessionToken(token);
    }

    const response = NextResponse.json({ success: true, message: "Logged out successfully" });
    response.cookies.delete("w2p_session");
    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Logout error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
