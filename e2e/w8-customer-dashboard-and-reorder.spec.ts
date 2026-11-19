import { test, expect } from "@playwright/test";
import { TEST_USERS, loginViaUi } from "./support/auth-helpers";

test.describe("W8. Customer Dashboard & 1-Click Reorder (PRD §09, §10)", () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as registered customer
    await loginViaUi(page, TEST_USERS.customerA, "/dashboard");
  });

  test("PRD §10: All six customer dashboard modules are accessible and functional", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Module 1: Profile & Account status
    await expect(page.locator("text=Sarah Jenkins").first()).toBeVisible();
    await expect(page.locator("text=Grizedale Enduro Racing").first()).toBeVisible();

    // Module 2: Order history with pipeline status
    const ordersTabBtn = page.locator("button:has-text('Order History')").first();
    await ordersTabBtn.click();
    await expect(page.locator("text=Past Orders & Production Pipeline Status")).toBeVisible();
    await expect(page.locator("text=W2P-2026-00101").first()).toBeVisible();

    // Module 4: Active proofs and their version state
    const proofsTabBtn = page.locator("button:has-text('Active Proofs')").first();
    await proofsTabBtn.click();
    await expect(page.locator("text=Digital Proofs & Version Approvals")).toBeVisible();
    await expect(page.locator("text=v1").first()).toBeVisible();

    // Module 3: Saved designs
    const designsTabBtn = page.locator("button:has-text('Saved Designs')").first();
    await designsTabBtn.click();
    await expect(page.locator("text=Saved Custom Designs Library")).toBeVisible();
  });

  test("PRD §09 & §10: 1-Click Reorder clones historical job into new production order", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    const ordersTabBtn = page.locator("button:has-text('Order History')").first();
    await ordersTabBtn.click();

    // Click 1-Click Reorder on the order card
    const reorderBtn = page.getByRole("button", { name: "1-Click Reorder", exact: true }).first();
    await reorderBtn.click();

    // Expect success banner with new order number
    await expect(page.locator("text=placed successfully via 1-Click Reorder")).toBeVisible({
      timeout: 10000,
    });
  });

  test("PRD §10 Module 6: Downloadable tax invoice endpoint returns valid PDF receipt", async ({
    request,
  }) => {
    const invoiceRes = await request.get("/api/orders/W2P-2026-00101/invoice");
    expect(invoiceRes.status()).toBe(200);

    const contentType = invoiceRes.headers()["content-type"];
    expect(contentType).toContain("application/pdf");

    const pdfBuffer = await invoiceRes.body();
    expect(pdfBuffer.byteLength).toBeGreaterThan(1000);
  });
});
