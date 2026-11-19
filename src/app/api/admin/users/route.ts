import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server-auth";
import { getAllUsers } from "@/modules/auth/users-store";
import { getOrdersForUser } from "@/modules/orders/order-store";

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.authorized) {
    return auth.response!;
  }

  try {
    const users = getAllUsers();
    const safeUsers = users.map((u) => {
      const userOrders = getOrdersForUser(u.id, u.email, "customer");
      return {
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        company_name: u.company_name,
        phone: u.phone,
        isActive: u.isActive !== false,
        orderCount: userOrders.length,
        created_at: u.created_at,
      };
    });

    return NextResponse.json({ users: safeUsers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to retrieve users";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
