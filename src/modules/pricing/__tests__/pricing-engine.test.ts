import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculatePrintPrice } from "../pricing-engine";
import { PRODUCTS } from "@/lib/data/mock-data";

describe("Pricing Engine Unit Tests (§ 05 & Testing Checklist)", () => {
  const stickerProduct = PRODUCTS.find((p) => p.id === "prod-vinyl-sticker")!;

  it("calculates minimum dimension boundary (25mm x 25mm)", () => {
    const result = calculatePrintPrice({
      product: stickerProduct,
      widthMm: 25,
      heightMm: 25,
      materialId: "gloss-white",
      quantity: 1,
    });

    // Area: (25 * 25) / 100 = 6.25 sq cm
    assert.equal(result.areaSqCm, 6.25);
    assert.equal(result.discountPercentage, 0);
    assert.ok(result.discountedUnitPriceCents > 0);
    assert.equal(result.subtotalCents, result.discountedUnitPriceCents * 1);
    assert.equal(result.totalGrossCents, result.subtotalCents + result.vatAmountCents);
  });

  it("calculates maximum dimension boundary (350mm x 350mm)", () => {
    const result = calculatePrintPrice({
      product: stickerProduct,
      widthMm: 350,
      heightMm: 350,
      materialId: "gloss-white",
      quantity: 10,
    });

    // Area: (350 * 350) / 100 = 1225 sq cm
    assert.equal(result.areaSqCm, 1225);
    assert.ok(result.rawUnitPriceCents > stickerProduct.base_price_cents);
  });

  describe("Volume Discount Threshold Boundaries (§ 05)", () => {
    it("boundary at qty 49: exactly 0% discount", () => {
      const result = calculatePrintPrice({
        product: stickerProduct,
        widthMm: 75,
        heightMm: 75,
        materialId: "gloss-white",
        quantity: 49,
      });
      assert.equal(result.discountPercentage, 0);
    });

    it("boundary at qty 50: exactly 10% discount floor reached", () => {
      const result = calculatePrintPrice({
        product: stickerProduct,
        widthMm: 75,
        heightMm: 75,
        materialId: "gloss-white",
        quantity: 50,
      });
      assert.equal(result.discountPercentage, 10);
      const expectedDiscounted = Math.round(result.rawUnitPriceCents * 0.9);
      assert.equal(result.discountedUnitPriceCents, expectedDiscounted);
    });

    it("boundary at qty 99: stays at 10% discount", () => {
      const result = calculatePrintPrice({
        product: stickerProduct,
        widthMm: 75,
        heightMm: 75,
        materialId: "gloss-white",
        quantity: 99,
      });
      assert.equal(result.discountPercentage, 10);
    });

    it("boundary at qty 100: exactly 20% discount floor reached", () => {
      const result = calculatePrintPrice({
        product: stickerProduct,
        widthMm: 75,
        heightMm: 75,
        materialId: "gloss-white",
        quantity: 100,
      });
      assert.equal(result.discountPercentage, 20);
      const expectedDiscounted = Math.round(result.rawUnitPriceCents * 0.8);
      assert.equal(result.discountedUnitPriceCents, expectedDiscounted);
    });

    it("boundary at qty 250: exactly 30% discount floor reached", () => {
      const result = calculatePrintPrice({
        product: stickerProduct,
        widthMm: 75,
        heightMm: 75,
        materialId: "gloss-white",
        quantity: 250,
      });
      assert.equal(result.discountPercentage, 30);
    });

    it("boundary at qty 500: exactly 40% discount floor reached", () => {
      const result = calculatePrintPrice({
        product: stickerProduct,
        widthMm: 75,
        heightMm: 75,
        materialId: "gloss-white",
        quantity: 500,
      });
      assert.equal(result.discountPercentage, 40);
    });

    it("boundary at qty 1000+: top 50% discount floor reached", () => {
      const result = calculatePrintPrice({
        product: stickerProduct,
        widthMm: 75,
        heightMm: 75,
        materialId: "gloss-white",
        quantity: 1200,
      });
      assert.equal(result.discountPercentage, 50);
    });
  });

  describe("Material Multipliers & VAT Accuracy", () => {
    it("applies premium holographic material multiplier (1.45x)", () => {
      const standard = calculatePrintPrice({
        product: stickerProduct,
        widthMm: 75,
        heightMm: 75,
        materialId: "gloss-white",
        quantity: 100,
      });

      const holographic = calculatePrintPrice({
        product: stickerProduct,
        widthMm: 75,
        heightMm: 75,
        materialId: "holographic",
        quantity: 100,
      });

      assert.equal(holographic.materialMultiplier, 1.45);
      assert.ok(holographic.discountedUnitPriceCents > standard.discountedUnitPriceCents);
    });

    it("calculates 20% VAT transparently with matching gross total", () => {
      const result = calculatePrintPrice({
        product: stickerProduct,
        widthMm: 100,
        heightMm: 100,
        materialId: "gloss-white",
        quantity: 100,
      });

      const expectedVat = Math.round(result.subtotalCents * 0.2);
      assert.equal(result.vatAmountCents, expectedVat);
      assert.equal(result.totalGrossCents, result.subtotalCents + result.vatAmountCents);
      assert.ok(result.formatted.totalGross.includes("£"));
    });
  });
});
