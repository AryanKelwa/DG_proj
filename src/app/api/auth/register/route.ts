import { NextRequest, NextResponse } from "next/server";
import { registerCustomerUser, createSessionToken } from "@/modules/auth/users-store";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, fullName, companyName, phone } = body;

    if (!email || !password || !fullName) {
      return NextResponse.json(
        { error: "Email, password, and full name are required." },
        { status: 400 }
      );
    }

    // Server-enforced role: customer only (PRD § 03)
    const { success, user, error } = registerCustomerUser(email, password, {
      fullName,
      companyName,
      phone,
    });

    if (!success || !user) {
      return NextResponse.json({ error: error || "Registration failed." }, { status: 400 });
    }

    const token = createSessionToken(user);

    const safeUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: "customer" as const, // Strict customer role
      company_name: user.company_name,
      phone: user.phone,
      created_at: user.created_at,
    };

    const response = NextResponse.json({ success: true, user: safeUser, token }, { status: 201 });

    response.cookies.set("w2p_session", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Registration error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
