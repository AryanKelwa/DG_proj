import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server-auth";
import { getProofById } from "@/modules/proofs/proofs-store";
import { getOrderById } from "@/modules/orders/order-store";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessionUser = getAuthUser(req);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Unauthorized: Valid session required" },
        { status: 401 }
      );
    }

    const proof = getProofById(id);
    if (!proof) {
      return NextResponse.json({ error: "Proof not found" }, { status: 404 });
    }

    if (sessionUser.role !== "admin") {
      const order = getOrderById(proof.order_id);
      const isOwner =
        order &&
        (order.customer_id === sessionUser.id ||
          order.customer_email?.toLowerCase() === sessionUser.email.toLowerCase());

      if (!isOwner) {
        return NextResponse.json(
          { error: "Forbidden: You do not have permission to view this proof" },
          { status: 403 }
        );
      }
    }

    return NextResponse.json({ proof });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to load proof";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
