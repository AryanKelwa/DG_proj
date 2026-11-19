import { NextRequest, NextResponse } from "next/server";
import { getOrdersForUser, createOrder } from "@/modules/orders/order-store";
import { getAuthUser } from "@/lib/server-auth";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionUser = await getAuthUser(req);

    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Valid session required to view orders" },
        { status: 401 }
      );
    }

    if (sessionUser.role === "admin") {
      // Admins see every order, or one customer's orders with ?userId=<uuid>.
      const targetUserId = searchParams.get("userId");
      const orders = await getOrdersForUser(targetUserId, targetUserId ? "customer" : "admin");
      return NextResponse.json({ orders });
    }

    // Strict customer isolation: Identity derives ONLY from authenticated session
    const orders = await getOrdersForUser(sessionUser.id, "customer");
    return NextResponse.json({ orders });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to retrieve orders";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionUser = await getAuthUser(req);

    // If authenticated as customer, enforce order customer_id binds to session
    if (sessionUser && sessionUser.role === "customer") {
      body.customer_id = sessionUser.id;
      body.customer_email = sessionUser.email;
      if (sessionUser.full_name) {
        body.customer_name = sessionUser.full_name;
      }
    }

    const { order, isNew } = await createOrder(body);
    return NextResponse.json({ order, isNew }, { status: isNew ? 201 : 200 });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to create order";
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }
}
