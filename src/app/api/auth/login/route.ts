import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, createSessionToken } from "@/modules/auth/users-store";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const { user, error } = validateCredentials(email, password);
    if (!user) {
      const status = error?.includes("deactivated") ? 403 : 401;
      return NextResponse.json({ error: error || "Invalid credentials." }, { status });
    }

    const token = createSessionToken(user);

    const safeUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      company_name: user.company_name,
      phone: user.phone,
      created_at: user.created_at,
    };

    const response = NextResponse.json({ success: true, user: safeUser, token });

    response.cookies.set("w2p_session", token, {
      httpOnly: true,
      secure: false, // localhost
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Login failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
