import { NextRequest, NextResponse } from "next/server";
import { getOrdersForUser, createOrder } from "@/modules/orders/order-store";
import { getAuthUser } from "@/lib/server-auth";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionUser = getAuthUser(req);

    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Valid session required to view orders" },
        { status: 401 }
      );
    }

    if (sessionUser.role === "admin") {
      const requestedRole = searchParams.get("role") || "admin";
      const targetUserId = searchParams.get("userId") || undefined;
      const targetUserEmail = searchParams.get("userEmail") || undefined;
      const orders = getOrdersForUser(targetUserId, targetUserEmail, requestedRole);
      return NextResponse.json({ orders });
    }

    // Strict customer isolation: Identity derives ONLY from authenticated session
    const orders = getOrdersForUser(sessionUser.id, sessionUser.email, "customer");
    return NextResponse.json({ orders });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to retrieve orders";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionUser = getAuthUser(req);

    // If authenticated as customer, enforce order customer_id binds to session
    if (sessionUser && sessionUser.role === "customer") {
      body.customer_id = sessionUser.id;
      body.customer_email = sessionUser.email;
      if (sessionUser.full_name) {
        body.customer_name = sessionUser.full_name;
      }
    }

    const { order, isNew } = createOrder(body);
    return NextResponse.json({ order, isNew }, { status: isNew ? 201 : 200 });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to create order";
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }
}
