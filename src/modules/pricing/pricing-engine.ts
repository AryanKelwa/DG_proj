import { Product, PricingTier } from "@/types/database";
import { VOLUME_DISCOUNTS } from "@/lib/data/mock-data";

export interface PricingCalculationInput {
  product: Product;
  widthMm: number;
  heightMm: number;
  materialId: string;
  quantity: number;
  customTiers?: PricingTier[];
}

export interface PricingBreakdown {
  areaSqCm: number;
  materialName: string;
  materialMultiplier: number;
  baseUnitPriceCents: number;
  areaPriceCents: number;
  rawUnitPriceCents: number;
  discountPercentage: number;
  discountedUnitPriceCents: number;
  subtotalCents: number;
  vatRatePercentage: number;
  vatAmountCents: number;
  totalGrossCents: number;
  formatted: {
    unitPrice: string;
    subtotal: string;
    vatAmount: string;
    totalGross: string;
  };
}

/**
 * Pure Pricing Engine Function (§ 05):
 * Instant per-unit pricing by product, size, and quantity with automatic volume discounts.
 */
export function calculatePrintPrice(input: PricingCalculationInput): PricingBreakdown {
  const { product, widthMm, heightMm, materialId, quantity, customTiers } = input;

  // 1. Calculate Area in Square Centimeters
  const areaSqCm = (widthMm * heightMm) / 100;

  // 2. Resolve Material Multiplier
  const selectedMaterial =
    product.allowed_materials.find((m) => m.id === materialId) ||
    product.allowed_materials[0] || {
      id: "standard",
      name: "Standard Stock",
      description: "Standard material",
      multiplier: 1.0,
    };

  const materialMultiplier = selectedMaterial.multiplier;

  // 3. Compute Area-Based Price Addition
  // Formula: base_price + (area_sq_cm * price_per_sq_cm)
  const baseUnitPriceCents = product.base_price_cents;
  const areaPriceCents = Math.round(areaSqCm * product.price_per_sq_cm_cents);
  const rawUnitPriceCents = Math.round((baseUnitPriceCents + areaPriceCents) * materialMultiplier);

  // 4. Resolve Volume Discount Tier (§ 05: applied automatically from quantity floors)
  const tiers = customTiers || (product as any).pricing_tiers || VOLUME_DISCOUNTS;
  // Sort descending by min_quantity to find highest eligible tier
  const eligibleTier = [...tiers]
    .sort((a, b) => b.min_quantity - a.min_quantity)
    .find((tier) => quantity >= tier.min_quantity);

  const discountPercentage = eligibleTier ? eligibleTier.discount_percentage : 0;
  const discountFactor = 1 - discountPercentage / 100;

  const discountedUnitPriceCents = Math.max(1, Math.round(rawUnitPriceCents * discountFactor));
  const subtotalCents = discountedUnitPriceCents * quantity;

  // 5. VAT Calculation (§ 05: 20% standard VAT)
  const vatRatePercentage = 20;
  const vatAmountCents = Math.round(subtotalCents * (vatRatePercentage / 100));
  const totalGrossCents = subtotalCents + vatAmountCents;

  const formatGBP = (cents: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(cents / 100);

  return {
    areaSqCm,
    materialName: selectedMaterial.name,
    materialMultiplier,
    baseUnitPriceCents,
    areaPriceCents,
    rawUnitPriceCents,
    discountPercentage,
    discountedUnitPriceCents,
    subtotalCents,
    vatRatePercentage,
    vatAmountCents,
    totalGrossCents,
    formatted: {
      unitPrice: formatGBP(discountedUnitPriceCents),
      subtotal: formatGBP(subtotalCents),
      vatAmount: formatGBP(vatAmountCents),
      totalGross: formatGBP(totalGrossCents),
    },
  };
}
