import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, StoredUser, getUserById } from "@/modules/auth/users-store";

export function getSessionTokenFromRequest(req: NextRequest): string | null {
  // 1. Check HTTP-only cookie
  const cookieToken = req.cookies.get("w2p_session")?.value;
  if (cookieToken) return cookieToken;

  // 2. Check Authorization Header: Bearer <token>
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.substring(7).trim();
  }

  // 3. Fallback to custom header
  const customHeader = req.headers.get("x-w2p-session");
  if (customHeader) return customHeader.trim();

  return null;
}

export function getAuthUser(req: NextRequest): StoredUser | null {
  const token = getSessionTokenFromRequest(req);
  if (!token) return null;
  return verifySessionToken(token);
}

export function requireAdmin(req: NextRequest): {
  authorized: boolean;
  user?: StoredUser;
  response?: NextResponse;
} {
  const user = getAuthUser(req);

  if (!user) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Unauthorized: Valid session required" },
        { status: 401 }
      ),
    };
  }

  if (user.role !== "admin") {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Forbidden: Admin privileges required" },
        { status: 403 }
      ),
    };
  }

  return { authorized: true, user };
}

export function requireAuth(req: NextRequest): {
  authorized: boolean;
  user?: StoredUser;
  response?: NextResponse;
} {
  const user = getAuthUser(req);

  if (!user) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Unauthorized: Valid session required" },
        { status: 401 }
      ),
    };
  }

  return { authorized: true, user };
}
