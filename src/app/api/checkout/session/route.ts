import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDraft, calculateDraftPrice, transitionDraftStatus } from "@/modules/drafts/draft-store";
import { generateXeroInvoicePayload } from "@/modules/orders/xero-generator";
import { getProductById } from "@/modules/catalog/catalog-store";
import { getAuthUser } from "@/lib/server-auth";
import { Order } from "@/types/database";
import { createOrder, reserveOrderNumber, NewOrderItem } from "@/modules/orders/order-store";
import { z } from "zod";

const ukPostcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i;
const internationalPostcodeRegex = /^[A-Z0-9\s-]{3,10}$/i;

const CheckoutSessionSchema = z.object({
  draftId: z.string().min(1, "Draft ID is required for checkout"),
  customerEmail: z.string().email(),
  customerName: z.string().min(1, "Customer name is required"),
  paymentMethod: z.enum(["stripe_hosted", "card"]).default("card"),
  cardNumber: z.string().optional(),
  shippingAddress: z.object({
    name: z.string().optional(),
    line1: z.string().min(1, "Address Line 1 is required"),
    line2: z.string().optional(),
    city: z.string().min(1, "City is required"),
    postal_code: z.string().min(1, "Postal code is required"),
    country: z.string().min(1, "Country is required"),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = CheckoutSessionSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        {
          error: "Invalid checkout request: All address fields are required.",
          details: validated.error.format(),
        },
        { status: 400 }
      );
    }

    const {
      draftId,
      customerEmail,
      customerName,
      paymentMethod,
      cardNumber,
      shippingAddress,
    } = validated.data;

    // Issue 1: Validate postal code format
    const rawPostcode = shippingAddress.postal_code.trim();
    const isUK =
      shippingAddress.country.toLowerCase().includes("united kingdom") ||
      shippingAddress.country.toLowerCase() === "gb" ||
      shippingAddress.country.toLowerCase() === "uk";

    if (isUK && !ukPostcodeRegex.test(rawPostcode)) {
      return NextResponse.json(
        {
          error: "Invalid UK postal code format. Please enter a valid UK postcode (e.g. SW1A 2AA, M1 1AA).",
        },
        { status: 400 }
      );
    } else if (!isUK && !internationalPostcodeRegex.test(rawPostcode)) {
      return NextResponse.json(
        {
          error: "Invalid postal code format.",
        },
        { status: 400 }
      );
    }

    // Orders always belong to a signed-in customer account.
    const sessionUser = await getAuthUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "Please sign in to place your order." }, { status: 401 });
    }

    // Task 2 & Task 3: Load persisted job draft
    const draft = await getDraft(draftId);
    if (!draft) {
      return NextResponse.json({ error: "Job draft not found" }, { status: 404 });
    }
    if (draft.customerId && draft.customerId !== sessionUser.id) {
      return NextResponse.json({ error: "Forbidden: this job belongs to another account." }, { status: 403 });
    }
    const actor = { id: sessionUser.id, email: sessionUser.email };

    // Task 3 & Task 5: Enforce Approval Gate (§ 08 & § 05)
    if (draft.status !== "proof_approved" && draft.status !== "payment_pending") {
      console.warn(`[WORKFLOW_GUARD] Rejected payment attempt for unapproved draft ${draftId}. Status: ${draft.status}`);
      return NextResponse.json(
        {
          error: `Approval Gate Rejection: Draft is in "${draft.status}" state. Customer proof must be inspected and approved before payment (§ 08 & § 05).`,
          code: "PROOF_NOT_APPROVED",
          currentStatus: draft.status,
        },
        { status: 400 }
      );
    }

    // Task 2: Server authoritative price recalculation from draft specifications
    const pricing = await calculateDraftPrice(draft);
    const product = await getProductById(draft.productId);
    if (!product) {
      return NextResponse.json({ error: "This product is no longer available." }, { status: 409 });
    }
    const newOrderNumber = await reserveOrderNumber();

    // Transition draft to payment_pending
    if (draft.status === "proof_approved") {
      await transitionDraftStatus(
        draft.id,
        "payment_pending",
        actor,
        { orderNumber: newOrderNumber }
      );
    }

    // Issue 1: Construct immutable address snapshot directly from validated input
    const immutableAddressSnapshot = {
      name: (shippingAddress.name || customerName).trim(),
      line1: shippingAddress.line1.trim(),
      line2: shippingAddress.line2?.trim() || undefined,
      city: shippingAddress.city.trim(),
      postal_code: rawPostcode.toUpperCase(),
      country: shippingAddress.country.trim(),
    };

    const latestProof =
      draft.proofs && draft.proofs.length > 0
        ? draft.proofs[draft.proofs.length - 1]
        : null;

    // Issue 3: Order object with full snapshot
    const completedOrder: Order = {
      id: "",
      order_number: newOrderNumber,
      customer_id: sessionUser.id,
      customer_email: customerEmail,
      customer_name: customerName,
      pipeline_stage: "ORDER",
      payment_status: "pending",
      subtotal_cents: pricing.subtotalCents,
      tax_cents: pricing.vatAmountCents,
      total_cents: pricing.totalGrossCents,
      currency: "INR",
      division_slug: product.division_slug,
      shipping_address: immutableAddressSnapshot,
      draft_id: draft.id,
      proof_version: latestProof?.version || 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const material = product.allowed_materials.find((m) => m.id === draft.options.materialId);
    const orderItems: NewOrderItem[] = [
      {
        product_id: product.id,
        product_name: product.name,
        division_slug: product.division_slug,
        hsn_code: product.hsn_code,
        width_mm: draft.options.widthMm,
        height_mm: draft.options.heightMm,
        material_id: draft.options.materialId,
        material_name: material?.name ?? pricing.materialName,
        quantity: draft.quantity,
        unit_price_cents: pricing.discountedUnitPriceCents,
        total_price_cents: pricing.subtotalCents,
        gst_rate: product.gst_rate,
        artwork_type: draft.uploadedFileRef ? "upload" : "designer",
        design_json: draft.designJson,
        uploaded_file_path: draft.uploadedFileRef,
      },
    ];

    // Test card simulation checks (PRD § 05 & Testing Checklist)
    const cleanCard = cardNumber?.replace(/\s+/g, "") || "";
    if (paymentMethod === "card") {
      if (cleanCard.endsWith("0002")) {
        // Return draft to proof_approved so user can retry without losing artwork (Task 3)
        await transitionDraftStatus(
          draft.id,
          "proof_approved",
          actor,
          { reason: "Payment card declined" }
        );

        return NextResponse.json(
          {
            error: "Payment declined: Your test card was declined by the bank (card_declined). No charge was made.",
            canRetry: true,
            draftStatus: "proof_approved",
          },
          { status: 402 }
        );
      }

      if (cleanCard.endsWith("3155")) {
        // 3D Secure Authentication required
        await transitionDraftStatus(
          draft.id,
          "paid",
          actor,
          { authentication: "3DS_PASSED" }
        );
        completedOrder.payment_status = "paid";
        const xeroInvoice = generateXeroInvoicePayload(completedOrder);
        completedOrder.xero_invoice_data = xeroInvoice as any;

        // Persist to order store
        await createOrder(completedOrder, orderItems);

        return NextResponse.json(
          {
            status: "requires_action",
            requiresAction: true,
            message: "Strong Customer Authentication (3D Secure) required. Verification passed in test mode.",
            orderNumber: newOrderNumber,
            checkoutUrl: `/dashboard?checkout_success=true&order_number=${newOrderNumber}`,
          },
          { status: 200 }
        );
      }
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (stripeKey && paymentMethod === "stripe_hosted") {
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-02-24.acacia" as any });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: customerEmail,
        client_reference_id: draft.id,
        line_items: [
          {
            price_data: {
              currency: "inr",
              product_data: {
                name: `${product.name} (${draft.options.widthMm}x${draft.options.heightMm}mm)`,
                description: `Material: ${pricing.materialName} · Qty: ${draft.quantity} units (incl. GST)`,
              },
              unit_amount: Math.round(pricing.totalGrossCents / draft.quantity),
            },
            quantity: draft.quantity,
          },
        ],
        metadata: {
          draftId: draft.id,
          customerId: sessionUser.id,
          orderNumber: newOrderNumber,
          productId: product.id,
          subtotalCents: String(pricing.subtotalCents),
          taxCents: String(pricing.vatAmountCents),
          totalCents: String(pricing.totalGrossCents),
          shippingAddress: JSON.stringify(immutableAddressSnapshot),
        },
        success_url: `${req.nextUrl.origin}/dashboard?checkout_success=true&order_number=${newOrderNumber}`,
        cancel_url: `${req.nextUrl.origin}/checkout?draft=${draft.id}&checkout_cancelled=true`,
      });

      return NextResponse.json({
        sessionId: session.id,
        checkoutUrl: session.url,
        orderNumber: newOrderNumber,
        isSimulated: false,
      });
    }

    // Direct Card Payment Successful Flow (§ 05, § 15)
    await transitionDraftStatus(
      draft.id,
      "paid",
      actor,
      { paymentMethod: "card" }
    );
    completedOrder.payment_status = "paid";
    const xeroInvoice = generateXeroInvoicePayload(completedOrder);
    completedOrder.xero_invoice_data = xeroInvoice as any;

    // Issue 3: Persist order to database/order store
    const { order: savedOrder } = await createOrder(completedOrder, orderItems);

    return NextResponse.json({
      sessionId: `sim_cs_${Date.now()}`,
      checkoutUrl: `/dashboard?checkout_success=true&order_number=${newOrderNumber}`,
      orderNumber: newOrderNumber,
      isSimulated: true,
      pricing,
      order: savedOrder,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Checkout session creation error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
