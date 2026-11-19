import { dataFile } from "@/lib/data-dir";
import fs from "fs";
import { Product, PricingTier, Division } from "@/types/database";
import { PRODUCTS, DIVISIONS, VOLUME_DISCOUNTS } from "@/lib/data/mock-data";

const CATALOG_STORE_FILE = dataFile(".catalog-store.json");

export interface ExtendedProduct extends Product {
  pricing_tiers?: PricingTier[];
}

interface CatalogStoreData {
  products: Record<string, ExtendedProduct>;
  divisions: Record<string, Division>;
}

let inMemoryCatalog: CatalogStoreData = { products: {}, divisions: {} };
let lastLoadedMtime = 0;
let isInitialized = false;

function loadStore(): void {
  try {
    if (fs.existsSync(CATALOG_STORE_FILE)) {
      const stats = fs.statSync(CATALOG_STORE_FILE);
      if (!isInitialized || stats.mtimeMs > lastLoadedMtime) {
        const raw = fs.readFileSync(CATALOG_STORE_FILE, "utf-8");
        inMemoryCatalog = JSON.parse(raw);
        lastLoadedMtime = stats.mtimeMs;
        isInitialized = true;
      }
      return;
    }
  } catch (err) {
    console.warn("Could not read catalog store, using memory:", err);
  }

  if (!isInitialized) {
    const productsMap: Record<string, ExtendedProduct> = {};
    for (const p of PRODUCTS) {
      productsMap[p.id] = {
        ...p,
        pricing_tiers: [...VOLUME_DISCOUNTS],
      };
    }
    const divisionsMap: Record<string, Division> = {};
    for (const d of DIVISIONS) {
      divisionsMap[d.id] = { ...d };
    }
    inMemoryCatalog = { products: productsMap, divisions: divisionsMap };
    saveStore();
    isInitialized = true;
  }
}

function saveStore(): void {
  try {
    const json = JSON.stringify(inMemoryCatalog, null, 2);
    fs.writeFileSync(CATALOG_STORE_FILE, json, "utf-8");
    const stats = fs.statSync(CATALOG_STORE_FILE);
    lastLoadedMtime = stats.mtimeMs;
  } catch (err) {
    console.warn("Could not write catalog store file:", err);
  }
}

export function getAllProducts(): ExtendedProduct[] {
  loadStore();
  return Object.values(inMemoryCatalog.products);
}

export function getProductById(id: string): ExtendedProduct | null {
  loadStore();
  if (inMemoryCatalog.products[id]) return inMemoryCatalog.products[id];
  const bySlug = Object.values(inMemoryCatalog.products).find((p) => p.slug === id);
  return bySlug || null;
}

export function getProductBySlug(slug: string): ExtendedProduct | null {
  loadStore();
  const found = Object.values(inMemoryCatalog.products).find((p) => p.slug === slug);
  return found || null;
}

export function getAllDivisions(): Division[] {
  loadStore();
  return Object.values(inMemoryCatalog.divisions).sort((a, b) => a.order_index - b.order_index);
}

export function validatePricingTiers(tiers: PricingTier[]): { valid: boolean; error?: string } {
  if (!Array.isArray(tiers)) {
    return { valid: false, error: "Pricing tiers must be an array." };
  }

  const seenQuantities = new Set<number>();

  for (const tier of tiers) {
    if (typeof tier.min_quantity !== "number" || tier.min_quantity <= 0) {
      return { valid: false, error: "Tier min_quantity must be a positive integer greater than 0." };
    }
    if (typeof tier.discount_percentage !== "number" || tier.discount_percentage < 0 || tier.discount_percentage > 100) {
      return { valid: false, error: "Tier discount_percentage must be a number between 0 and 100." };
    }
    if (seenQuantities.has(tier.min_quantity)) {
      return { valid: false, error: `Duplicate tier floor detected for quantity ${tier.min_quantity}. Overlaps are not permitted.` };
    }
    seenQuantities.add(tier.min_quantity);
  }

  return { valid: true };
}

export function updateProduct(
  id: string,
  updates: Partial<ExtendedProduct>
): { success: boolean; product?: ExtendedProduct; error?: string } {
  loadStore();

  const product = getProductById(id);
  if (!product) {
    return { success: false, error: `Product with ID '${id}' not found.` };
  }

  // Validate price parameters
  if (updates.base_price_cents !== undefined && updates.base_price_cents < 0) {
    return { success: false, error: "Base price cannot be negative." };
  }
  if (updates.price_per_sq_cm_cents !== undefined && updates.price_per_sq_cm_cents < 0) {
    return { success: false, error: "Price per sq cm cannot be negative." };
  }
  if (updates.min_width_mm !== undefined && updates.min_width_mm <= 0) {
    return { success: false, error: "Minimum width must be greater than 0 mm." };
  }
  if (updates.min_height_mm !== undefined && updates.min_height_mm <= 0) {
    return { success: false, error: "Minimum height must be greater than 0 mm." };
  }

  // Validate pricing tiers if provided
  if (updates.pricing_tiers !== undefined) {
    const tierValidation = validatePricingTiers(updates.pricing_tiers);
    if (!tierValidation.valid) {
      return { success: false, error: tierValidation.error };
    }
  }

  const updated: ExtendedProduct = {
    ...product,
    ...updates,
  };

  inMemoryCatalog.products[product.id] = updated;
  saveStore();
  return { success: true, product: updated };
}

export function createProduct(
  productData: Omit<ExtendedProduct, "id"> & { id?: string }
): { success: boolean; product?: ExtendedProduct; error?: string } {
  loadStore();

  if (!productData.slug || !productData.name) {
    return { success: false, error: "Product slug and name are required." };
  }

  if (getProductBySlug(productData.slug)) {
    return { success: false, error: `Product with slug '${productData.slug}' already exists.` };
  }

  if (productData.pricing_tiers) {
    const tierValidation = validatePricingTiers(productData.pricing_tiers);
    if (!tierValidation.valid) {
      return { success: false, error: tierValidation.error };
    }
  }

  const id = productData.id || `prod-${Date.now()}`;
  const newProduct: ExtendedProduct = {
    ...productData,
    id,
    base_price_cents: Math.max(0, productData.base_price_cents ?? 10),
    price_per_sq_cm_cents: Math.max(0, productData.price_per_sq_cm_cents ?? 1),
    min_width_mm: productData.min_width_mm ?? 20,
    max_width_mm: productData.max_width_mm ?? 1000,
    min_height_mm: productData.min_height_mm ?? 20,
    max_height_mm: productData.max_height_mm ?? 1000,
    default_width_mm: productData.default_width_mm ?? 75,
    default_height_mm: productData.default_height_mm ?? 75,
    default_bleed_mm: productData.default_bleed_mm ?? 3.0,
    default_safety_margin_mm: productData.default_safety_margin_mm ?? 3.0,
    allowed_materials: productData.allowed_materials ?? [
      { id: "standard", name: "Standard Vinyl", description: "Standard stock", multiplier: 1.0 },
    ],
    allowed_orientations: productData.allowed_orientations ?? ["portrait", "landscape", "square"],
    pricing_tiers: productData.pricing_tiers || [...VOLUME_DISCOUNTS],
    is_active: productData.is_active ?? true,
    has_variable_data: productData.has_variable_data ?? false,
  };

  inMemoryCatalog.products[id] = newProduct;
  saveStore();
  return { success: true, product: newProduct };
}

export function resetCatalogStore(): void {
  const productsMap: Record<string, ExtendedProduct> = {};
  for (const p of PRODUCTS) {
    productsMap[p.id] = {
      ...p,
      pricing_tiers: [...VOLUME_DISCOUNTS],
    };
  }
  const divisionsMap: Record<string, Division> = {};
  for (const d of DIVISIONS) {
    divisionsMap[d.id] = { ...d };
  }
  inMemoryCatalog = { products: productsMap, divisions: divisionsMap };
  saveStore();
}
