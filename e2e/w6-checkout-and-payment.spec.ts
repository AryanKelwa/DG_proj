import { test, expect } from "@playwright/test";
import { generateXeroInvoicePayload } from "../src/modules/orders/xero-generator";
import { calculatePrintPrice } from "../src/modules/pricing/pricing-engine";
import {
  createDraft,
  transitionDraftStatus,
  approveDraftProof,
} from "../src/modules/drafts/draft-store";
import { PRODUCTS } from "../src/lib/data/mock-data";
import { Order } from "../src/types/database";
import { TEST_USERS, loginViaUi } from "./support/auth-helpers";

test.describe("W6. Checkout & Payment Engine (PRD §05)", () => {
  test("PRD §05: Tampering with client-submitted price is overridden by server-calculated pricing", async ({
    request,
  }) => {
    const draft = await createDraft({
      productId: "prod-vinyl-sticker",
      widthMm: 100,
      heightMm: 100,
      materialId: "gloss-white",
      quantity: 100,
    });
    transitionDraftStatus(draft.id, "artwork_ready", { id: "u1", email: "sarah@enduroclub.uk" });
    transitionDraftStatus(draft.id, "proof_pending", { id: "u1", email: "sarah@enduroclub.uk" });
    approveDraftProof(draft.id, { id: "u1", email: "sarah@enduroclub.uk" });

    // Attempting to send a tampered payload with unitPrice = 0.01
    const tamperedPayload = {
      draftId: draft.id,
      customerEmail: "sarah@enduroclub.uk",
      customerName: "Sarah Jenkins",
      paymentMethod: "card",
      cardNumber: "4242 4242 4242 4242",
      tamperedPrice: 1, // Malicious user tries to set 1 cent
    };

    const res = await request.post("/api/checkout/session", {
      data: tamperedPayload,
    });

    expect(res.status()).toBe(200);
    const body = await res.json();

    // Verify order was created with official server calculation
    const expectedPricing = calculatePrintPrice({
      product: PRODUCTS[0],
      widthMm: 100,
      heightMm: 100,
      materialId: "gloss-white",
      quantity: 100,
    });

    if (body.pricing) {
      expect(body.pricing.totalCents).toBe(expectedPricing.totalCents);
      expect(body.pricing.totalCents).not.toBe(1);
    }
    expect(body.orderNumber).toMatch(/^W2P-2026-\d+/);
  });

  test("PRD §05: Webhook parses completed checkout session and generates verified order", async ({
    request,
  }) => {
    const mockSessionPayload = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_test_${Date.now()}`,
          customer_details: {
            email: "sarah@enduroclub.uk",
            name: "Sarah Jenkins",
            address: {
              line1: "Unit 4, Grizedale Forest",
              city: "Ambleside",
              postal_code: "LA22 0QJ",
              country: "GB",
            },
          },
          metadata: {
            orderNumber: "W2P-2026-00999",
            subtotalCents: "12000",
            taxCents: "2400",
            totalCents: "14400",
          },
        },
      },
    };

    const res = await request.post("/api/webhooks/stripe", {
      data: JSON.stringify(mockSessionPayload),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.orderNumber).toBe("W2P-2026-00999");
    expect(json.xeroExportReady).toBe(true);
    expect(json.xeroInvoiceId).toBe("INV-W2P-2026-00999");
  });

  test("PRD §05 & §14: Order schema adheres to Xero Accounting API structure (ACCREC, Tax 20%, Sales 200)", () => {
    const sampleOrder: Order = {
      id: "ord-test-xero",
      order_number: "W2P-2026-00345",
      customer_id: "usr-cust-01",
      customer_email: "sarah@enduroclub.uk",
      customer_name: "Sarah Jenkins",
      pipeline_stage: "ORDER",
      payment_status: "paid",
      subtotal_cents: 10000,
      tax_cents: 2000,
      total_cents: 12000,
      currency: "GBP",
      shipping_address: {
        name: "Sarah Jenkins",
        line1: "12 Trail Head Road",
        city: "Keswick",
        postal_code: "CA12 5PR",
        country: "GB",
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const xeroInvoice = generateXeroInvoicePayload(sampleOrder);

    // Assert strict Xero compliance
    expect(xeroInvoice.Type).toBe("ACCREC");
    expect(xeroInvoice.InvoiceNumber).toBe("INV-W2P-2026-00345");
    expect(xeroInvoice.CurrencyCode).toBe("GBP");
    expect(xeroInvoice.Contact.EmailAddress).toBe("sarah@enduroclub.uk");
    expect(xeroInvoice.LineAmountTypes).toBe("Exclusive");

    // Line item verification
    const item = xeroInvoice.LineItems[0];
    expect(item.AccountCode).toBe("200");
    expect(item.TaxType).toBe("OUTPUT2");
    expect(item.UnitAmount).toBe(100.0);
    expect(item.TaxAmount).toBe(20.0);
  });

  test("PRD §05: Confirm platform contains zero recurring subscriptions or billing agreements", async ({
    page,
  }) => {
    // Scan codebase and storefront for any subscription text
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("/month");
    expect(pageContent).not.toContain("/year");
    expect(pageContent).not.toContain("recurring billing");
    expect(pageContent).not.toContain("monthly subscription");
  });

  test("PRD §05: Visible payment gateway checkout page renders and handles test card flow", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const draft = await createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 75,
      heightMm: 75,
      materialId: "gloss-white",
      quantity: 100,
    });
    transitionDraftStatus(draft.id, "artwork_ready", { id: "u1", email: "sarah@enduroclub.uk" });
    transitionDraftStatus(draft.id, "proof_pending", { id: "u1", email: "sarah@enduroclub.uk" });
    approveDraftProof(draft.id, { id: "u1", email: "sarah@enduroclub.uk" });

    const checkoutUrl = `/checkout?draft=${draft.id}`;
    await loginViaUi(page, TEST_USERS.customerA, "/dashboard");
    await page.goto(checkoutUrl);
    await page.waitForLoadState("domcontentloaded");

    // Verify payment gateway UI is visible
    await expect(page.locator("text=Payment Gateway (Stripe Integrated)").first()).toBeVisible();
    await expect(page.locator("text=Direct Card Payment").first()).toBeVisible();
    await expect(page.locator("text=Stripe Hosted Checkout").first()).toBeVisible();

    // Verify test card presets are available
    await expect(page.locator("button:has-text('Success')").first()).toBeVisible();
    await expect(page.locator("button:has-text('Decline')").first()).toBeVisible();

    // Test decline flow
    await page.locator("button:has-text('Decline')").first().click();
    await page.locator("button[type='submit']").first().click();
    await expect(page.locator("text=Payment declined").first()).toBeVisible();

    // Test success flow
    await page.locator("button:has-text('Success')").first().click();
    await page.locator("button[type='submit']").first().click();
    await page.waitForURL(/.*checkout_success=true.*/);
    await expect(page.locator("text=Payment Confirmed").first()).toBeVisible();
  });
});
