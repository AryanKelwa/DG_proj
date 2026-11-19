import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAdminRoute = pathname.startsWith("/production");
  const isAdminApiRoute = pathname.startsWith("/api/admin");

  if (isAdminRoute || isAdminApiRoute) {
    const sessionCookie = req.cookies.get("w2p_session")?.value;
    const authHeader = req.headers.get("authorization");

    const hasToken = !!sessionCookie || (!!authHeader && authHeader.toLowerCase().startsWith("bearer "));

    if (!hasToken) {
      if (isAdminApiRoute) {
        return NextResponse.json(
          { error: "Unauthorized: Valid admin session token required" },
          { status: 401 }
        );
      }
      // Redirect unauthenticated visitor to login
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/production/:path*", "/api/admin/:path*"],
};
