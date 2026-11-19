import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server-auth";

export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    if (!user) {
      return NextResponse.json({ user: null, role: "visitor" });
    }

    const safeUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      company_name: user.company_name,
      phone: user.phone,
      created_at: user.created_at,
    };

    return NextResponse.json({ user: safeUser, role: user.role });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Session error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
