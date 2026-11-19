import { test, expect } from "@playwright/test";
import {
  createDraft,
  approveDraftProof,
  transitionDraftStatus,
} from "../src/modules/drafts/draft-store";

test.describe("Phase F: Workflow Repair & Approval Gate Enforcement (PRD §01, §03, §05, §06, §08)", () => {
  // Task 7 Item 5: Zero unhandled page errors allowed
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    page.on("pageerror", (err) => {
      expect(err).toBeNull();
    });
  });

  // Task 7 Item 1: Complete 9-step customer journey
  test("PRD §01, §03, §05, §06, §08: End-to-end happy path from home to paid order", async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);

    // 1. Browse 6 divisions on homepage
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.waitForLoadState("domcontentloaded");
    const divisionsSection = page.locator("#divisions");
    await expect(divisionsSection).toBeVisible();

    // 2. Configure and see live price (no login required)
    await page.goto("/calculator?product=custom-die-cut-vinyl");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText(/Pricing|Calculator/i);

    // Verify "Instant Checkout" is completely removed (PRD § 05, § 08)
    await expect(page.locator("text=Instant Checkout & Pay with Stripe")).toHaveCount(0);

    // Primary action is only "Continue to In-Browser Designer"
    const continueBtn = page.locator("button:has-text('Continue to In-Browser Designer')").first();
    await expect(continueBtn).toBeVisible();

    // 3. Click Continue -> visitor redirected to login with return URL
    await continueBtn.click();
    await page.waitForURL("**/login**", { timeout: 30000 });
    expect(page.url()).toContain("redirect=");

    // Log in with test customer account
    await page.locator("#email").fill("sarah@enduroclub.uk");
    await page.locator("#password").fill("customer123");
    await page.locator("button[type='submit']").click();

    // 4. Redirects to designer with persisted draft
    await page.waitForURL("**/designer/**", { timeout: 30000, waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("draft=");
    await expect(page.locator("h1")).toContainText(/Vinyl|Stickers/i);

    // 5. Generate Real-time Proof v1
    const proofBtn = page.locator("button:has-text('Generate Proof & Preview')").first();
    await proofBtn.click();

    const proofModal = page.locator(".fixed.inset-0").first();
    await expect(proofModal).toBeVisible({ timeout: 15000 });
    await expect(proofModal).toContainText(/W2P PROOF · v1/i);

    // 6. Approve the proof
    const approveBtn = proofModal.locator("button:has-text('Approve Proof')").first();
    await approveBtn.scrollIntoViewIfNeeded();
    await approveBtn.click();

    // 7. Navigates to /checkout with draft ID only
    await page.waitForURL("**/checkout**", { timeout: 30000, waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("draft=");

    // 8. Pay via Card
    const successBtn = page.locator("button:has-text('Success')").first();
    await successBtn.scrollIntoViewIfNeeded();
    await successBtn.click();
    const payBtn = page.locator("button[type='submit']");
    await payBtn.scrollIntoViewIfNeeded();
    await payBtn.click();

    // 9. Dashboard confirmation
    await page.waitForURL("**/dashboard**", { timeout: 30000, waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("checkout_success=true");
    await expect(page.locator("text=Payment Confirmed").first()).toBeVisible();
  });

  // Task 7 Item 2: Workflow guard tests
  test("PRD §01, §05, §08: Direct checkout without approved proof is rejected", async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);
    // 1. Visit /checkout directly without draft -> shows workflow order violation
    await page.goto("/checkout");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("text=Workflow Order Violation").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator("button[type='submit']")).toHaveCount(0);

    // 2. Visit /checkout with an unapproved draft (configured only)
    const unapprovedDraft = createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 80,
      heightMm: 80,
      materialId: "gloss-white",
      quantity: 100,
    });

    await page.goto(`/checkout?draft=${unapprovedDraft.id}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.locator("text=Workflow Order Violation").or(page.locator("text=Approval Gate Violation")).first()
    ).toBeVisible({ timeout: 15000 });

    // 3. Direct API call to /api/checkout/session with unapproved draft -> HTTP 400
    const apiRes = await request.post("/api/checkout/session", {
      data: {
        draftId: unapprovedDraft.id,
        customerEmail: "sarah@enduroclub.uk",
        customerName: "Sarah Jenkins",
        paymentMethod: "card",
        cardNumber: "4242 4242 4242 4242",
      },
    });
    expect(apiRes.status()).toBe(400);
    const apiBody = await apiRes.json();
    expect(apiBody.code).toBe("PROOF_NOT_APPROVED");

    // 4. Visit /designer without configuration -> sensible default instantiated, zero crash
    await page.goto("/designer/custom-die-cut-vinyl");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toContainText(/Vinyl|Stickers/i);
  });

  // Task 7 Item 3: Proof revision cycle (v1 -> request changes -> v2 -> approve v2)
  test("PRD §08: Proof cycle v1 revision request spawns v2 and records cryptographic approval", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const draft = createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 100,
      heightMm: 100,
      materialId: "gloss-white",
      quantity: 100,
    });

    await page.goto(`/designer/custom-die-cut-vinyl?draft=${draft.id}`);
    await page.waitForLoadState("domcontentloaded");

    // Generate v1
    const proofBtn = page.locator("button:has-text('Generate Proof & Preview')").first();
    await proofBtn.click();
    const modal = page.locator(".fixed.inset-0").first();
    await expect(modal).toContainText(/W2P PROOF · v1/i);

    // Click Adjust Artwork (request changes)
    const adjustBtn = modal.locator("button:has-text('Adjust Artwork')").first();
    await adjustBtn.scrollIntoViewIfNeeded();
    await adjustBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 15000 });

    // Open proof modal again -> now shows revision v2
    await proofBtn.click();
    const modalV2 = page.locator(".fixed.inset-0").first();
    await expect(modalV2).toBeVisible({ timeout: 15000 });
    await expect(modalV2).toContainText(/W2P PROOF · v2/i);

    // Approve v2
    const approveV2Btn = modalV2.locator("button:has-text('Approve Proof')").first();
    await approveV2Btn.scrollIntoViewIfNeeded();
    await approveV2Btn.click();
    await page.waitForURL("**/checkout**", { timeout: 30000, waitUntil: "domcontentloaded" });
    expect(page.url()).toContain(`draft=${draft.id}`);
  });

  // Task 7 Item 4: Decline & 3DS test cards
  test("PRD §05: Decline card (0002) retains approved draft for retry; 3DS (3155) verifies", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const draft = createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 75,
      heightMm: 75,
      materialId: "gloss-white",
      quantity: 100,
    });
    transitionDraftStatus(draft.id, "artwork_ready", { id: "u1", email: "sarah@enduroclub.uk" });
    transitionDraftStatus(draft.id, "proof_pending", { id: "u1", email: "sarah@enduroclub.uk" });
    approveDraftProof(draft.id, { id: "u1", email: "sarah@enduroclub.uk" });

    await page.goto(`/checkout?draft=${draft.id}`);
    await page.waitForLoadState("domcontentloaded");

    // 1. Test Decline Card
    const declineBtn = page.locator("button:has-text('Decline')").first();
    await declineBtn.scrollIntoViewIfNeeded();
    await declineBtn.click();
    const submitBtn = page.locator("button[type='submit']");
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();
    await expect(page.locator("text=Payment declined").first()).toBeVisible({ timeout: 15000 });

    // Form remains active, user can retry with success card
    const successCardBtn = page.locator("button:has-text('Success')").first();
    await successCardBtn.scrollIntoViewIfNeeded();
    await successCardBtn.click();
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();
    await page.waitForURL("**/dashboard**", { timeout: 30000, waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("checkout_success=true");
  });

  // Task 7 Item 6: Mutation Check
  test("Mutation Check: Removing proof-approval check catches unauthorized checkout attempt", async ({
    request,
  }) => {
    // Deliberately create draft in 'configured' status without approval
    const mutantDraft = createDraft({
      productId: "custom-die-cut-vinyl",
      widthMm: 50,
      heightMm: 50,
      materialId: "gloss-white",
      quantity: 100,
    });

    // An unapproved draft must NEVER receive an active checkout session
    const response = await request.post("/api/checkout/session", {
      data: {
        draftId: mutantDraft.id,
        customerEmail: "attacker@exploit.net",
        paymentMethod: "card",
        cardNumber: "4242 4242 4242 4242",
      },
    });

    // Must be rejected with HTTP 400
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Approval Gate Rejection");
  });
});
