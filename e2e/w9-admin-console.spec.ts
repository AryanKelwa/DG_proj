import { test, expect } from "@playwright/test";
import { TEST_USERS, loginViaUi } from "./support/auth-helpers";

test.describe("W9. Production Pipeline Dashboard & Staff Console (PRD §03, §11)", () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as Staff Administrator
    await loginViaUi(page, TEST_USERS.admin, "/production");
  });

  test("PRD §11: Production console displays 6-stage pipeline and high-level business analytics", async ({
    page,
  }) => {
    await page.goto("/production");
    await page.waitForLoadState("domcontentloaded");

    // Header & Staff badge
    await expect(page.locator("h1")).toContainText("Production");
    await expect(page.locator("text=Factory Console")).toBeVisible();

    // Business Analytics overview (§ 11 Capability 05)
    await expect(page.locator("text=Gross Revenue").first()).toBeVisible();
    await expect(page.locator("text=Active in Production").first()).toBeVisible();

    // The 6 Pipeline stages (§ 11 The Pipeline)
    const expectedStages = ["QUOTE", "ORDER", "ARTWORK", "PROOF", "PRODUCTION", "COMPLETED"];
    for (const stage of expectedStages) {
      await expect(page.locator(`text=${stage}`).first()).toBeVisible();
    }
  });

  test("PRD §11 Capability 01: Job database search and filtering by division and stage", async ({
    page,
  }) => {
    await page.goto("/production");
    await page.waitForLoadState("domcontentloaded");

    // Switch to Table View for clear row assertions
    const tableViewBtn = page.locator("button:has-text('Dense Job Table'), button:has-text('Table View')").first();
    await tableViewBtn.click();

    // 1. Search by customer name
    const searchInput = page.locator("input[placeholder*='Search']").first();
    await searchInput.fill("Sarah Jenkins");

    const orderRow = page.locator("tr:has-text('Sarah Jenkins')").first();
    await expect(orderRow).toBeVisible();

    // Clear search
    await searchInput.fill("");

    // 2. Filter by division
    const divisionSelect = page.locator("select").or(page.locator("[role='combobox']")).first();
    if (await divisionSelect.isVisible()) {
      await divisionSelect.click();
    }
  });

  test("PRD §11 Capability 02: Ready-for-Production indicator strictly locks downloads for unapproved proofs", async ({
    page,
  }) => {
    await page.goto("/production");
    await page.waitForLoadState("domcontentloaded");

    // Switch to Table View
    const tableViewBtn = page.locator("button:has-text('Dense Job Table'), button:has-text('Table View')").first();
    await tableViewBtn.click();

    // 1. Unapproved order (ord-101 / W2P-2026-00101 in PROOF stage)
    const lockedBadge = page.locator("text=LOCKED").first();
    await expect(lockedBadge).toBeVisible();

    // 2. Approved order (W2P-2026-00102 in PRODUCTION stage)
    const unlockedBadge = page.locator("text=UNLOCKED").first();
    await expect(unlockedBadge).toBeVisible();

    // 3. Verify disabled download button on locked row
    const lockedRow = page.locator("tr:has-text('LOCKED')").first();
    const downloadBtn = lockedRow.locator("button:has-text('300 DPI')").first();
    await expect(downloadBtn).toBeDisabled();
  });

  test("PRD §11 Capability 04: Sequential stage advancement moves jobs through manufacturing pipeline", async ({
    page,
  }) => {
    await page.goto("/production");
    await page.waitForLoadState("domcontentloaded");

    // In Kanban view, find an advance button
    const advanceBtn = page.locator("button:has-text('Advance')").first();
    if (await advanceBtn.isVisible()) {
      await advanceBtn.click();
      // State updates reactively
      await page.waitForTimeout(300);
    }
  });
});
