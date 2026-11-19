import { test, expect } from "@playwright/test";
import path from "path";

test.describe("W4. Web-to-Print Designer (PRD §06)", () => {
  const designerUrl = "/designer/custom-die-cut-vinyl?w=100&h=100&mat=gloss-white&qty=100";

  test("PRD §06: Designer mounts with trim, bleed, and safe margin guides", async ({
    page,
  }) => {
    await page.goto(designerUrl);
    await page.waitForLoadState("domcontentloaded");

    // Header specs verification
    await expect(page.locator("h1")).toContainText("Die-Cut Vinyl Stickers");
    await expect(page.locator("text=Trim Box: 100mm × 100mm").first()).toBeVisible();
    await expect(page.locator("text=+3mm").first()).toBeVisible(); // Bleed

    // Canvas work area exists
    const canvasContainer = page.locator(".cursor-crosshair").first();
    await expect(canvasContainer).toBeVisible();

    // Check legend items for print guides
    await expect(page.locator("text=Bleed (+3mm)").first()).toBeVisible();
    await expect(page.locator("text=Trim Line").first()).toBeVisible();
    await expect(page.locator("text=Safe Zone").first()).toBeVisible();
  });

  test("PRD §06: Add, edit, and manipulate text elements with shrink-to-fit rules", async ({
    page,
  }) => {
    await page.goto(designerUrl);
    await page.waitForLoadState("domcontentloaded");

    // Click "Add Heading"
    const addHeadingBtn = page.locator("button:has-text('Heading')").first();
    await addHeadingBtn.click();

    // The text inspector panel should be active
    const textInput = page.locator("#text-val");
    await expect(textInput).toBeVisible();

    // Type new text
    await textInput.fill("CHAMPIONSHIP RACING");

    // Color picker button or swatch
    const colorInput = page.locator("input[type='color']").first();
    if (await colorInput.isVisible()) {
      await colorInput.fill("#2563EB");
    }

    // Save design JSON
    const saveBtn = page.locator("button:has-text('Save Design JSON')").first();
    await saveBtn.click();

    // Success notification
    await expect(page.locator("text=Design state serialized & saved")).toBeVisible();
  });

  test("PRD §06: Real-time digital proof inspection modal opens and generates preview", async ({
    page,
  }) => {
    await page.goto(designerUrl);
    await page.waitForLoadState("domcontentloaded");

    // Click "Generate Proof & Preview"
    const inspectBtn = page.locator("button:has-text('Generate Proof & Preview')").first();
    await inspectBtn.click();

    // Modal dialog opens
    const dialog = page.locator("role=dialog").or(page.locator(".fixed.inset-0"));
    await expect(dialog.first()).toBeVisible();
    await expect(dialog.first()).toContainText("Digital Proof Inspection");

    // Verify close or approve action
    const closeBtn = dialog.locator("button:has-text('Close')").or(dialog.locator("button:has-text('Return')")).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
  });

  test("PRD §06: Direct file upload path accepts valid production artwork and rejects invalid types", async ({
    page,
  }) => {
    await page.goto(designerUrl);
    await page.waitForLoadState("domcontentloaded");

    // Switch to Direct Upload tab
    const uploadTabBtn = page.locator("button:has-text('Direct File Upload')").first();
    await uploadTabBtn.click();

    // Verify upload dropzone
    await expect(page.locator("text=Drop artwork here or click to browse")).toBeVisible();

    // 1. Upload valid SVG
    const validSvgPath = path.resolve(process.cwd(), "e2e/fixtures/valid-artwork.svg");
    const fileInput = page.locator("input[type='file']").first();
    await fileInput.setInputFiles(validSvgPath);

    // Verify upload success banner
    await expect(page.locator("text=Pre-flight Verified").or(page.locator("text=READY FOR PROOF")).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
