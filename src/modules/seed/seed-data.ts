import { dataFile } from "../../lib/data-dir";
import fs from "fs";
import { Order, Proof, SavedDesign } from "@/types/database";
import { resetUsersStore, StoredUser } from "@/modules/auth/users-store";
import { resetCatalogStore } from "@/modules/catalog/catalog-store";
import { resetAuditStore } from "@/modules/audit/audit-store";
import { resetProofsStore } from "@/modules/proofs/proofs-store";
import { resetSavedDesignsStore } from "@/modules/designs/saved-designs-store";
import { resetDraftsStore } from "@/modules/drafts/draft-store";
import { resetEmailStore } from "@/modules/email/email-store";
import { clearCapturedEmails } from "@/modules/email/email-provider";

const ORDERS_STORE_FILE = dataFile(".orders-store.json");

export const SEED_CUSTOMERS = [
  {
    id: "usr-cust-1",
    email: "sarah@enduroclub.uk",
    name: "Sarah Jenkins",
    role: "customer" as const,
  },
  {
    id: "usr-cust-2",
    email: "customerb@example.com",
    name: "Customer B",
    role: "customer" as const,
  },
  {
    id: "usr-cust-3",
    email: "customerc@example.com",
    name: "Customer C",
    role: "customer" as const,
  },
];

export const SEED_ADMIN = {
  id: "usr-admin-01",
  email: "admin@w2p.co.in",
  name: "Marcus Vance (Production Head)",
  role: "admin" as const,
};

export const SEED_USERS_MAP: Record<string, StoredUser> = {
  "admin@w2p.co.in": {
    id: "usr-admin-01",
    email: "admin@w2p.co.in",
    full_name: "Marcus Vance (Production Head)",
    role: "admin",
    company_name: "W2P Ltd",
    phone: "+44 800 555 0199",
    isActive: true,
    created_at: "2026-03-01T08:00:00.000Z",
    passwordHash: "admin123",
  },
  "sarah@enduroclub.uk": {
    id: "usr-cust-1",
    email: "sarah@enduroclub.uk",
    full_name: "Sarah Jenkins",
    role: "customer",
    company_name: "Grizedale Enduro Racing",
    phone: "+44 7911 123456",
    isActive: true,
    created_at: "2026-03-01T09:00:00.000Z",
    passwordHash: "customer123",
  },
  "customerb@example.com": {
    id: "usr-cust-2",
    email: "customerb@example.com",
    full_name: "Customer B",
    role: "customer",
    company_name: "Apex Biking Co",
    phone: "+44 7911 222333",
    isActive: true,
    created_at: "2026-03-02T10:00:00.000Z",
    passwordHash: "customer123",
  },
  "customerc@example.com": {
    id: "usr-cust-3",
    email: "customerc@example.com",
    full_name: "Customer C",
    role: "customer",
    company_name: "Lakeside Events",
    phone: "+44 7911 444555",
    isActive: true,
    created_at: "2026-03-02T11:00:00.000Z",
    passwordHash: "customer123",
  },
};

export const SEED_PROOFS: Proof[] = [
  {
    id: "prf-101",
    order_item_id: "item-001",
    order_id: "W2P-2026-00101",
    version_number: 1,
    status: "pending_review",
    watermarked_preview_url: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=600&q=75",
    created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
  {
    id: "prf-102",
    order_item_id: "item-002",
    order_id: "W2P-2026-00102",
    version_number: 2,
    status: "approved",
    watermarked_preview_url: "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=600&q=75",
    approved_by: "usr-cust-2",
    approved_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
];

export const SEED_DESIGNS: SavedDesign[] = [
  {
    id: "des-01",
    customer_id: "usr-cust-1",
    product_id: "custom-die-cut-vinyl",
    product_name: "Custom Die-Cut Vinyl Stickers",
    name: "Enduro Club Brand Stickers",
    width_mm: 75,
    height_mm: 75,
    material: "Gloss White Vinyl",
    canvas_state: {},
    preview_url: "https://images.unsplash.com/photo-1572375992501-4b0892d50c69?auto=format&fit=crop&w=600&q=75",
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
];

export const PHASE_H_ORDERS: Record<string, Order> = {
  "W2P-2026-00101": {
    id: "ord-seed-001",
    order_number: "W2P-2026-00101",
    customer_id: "usr-cust-1",
    customer_name: "Sarah Jenkins",
    customer_email: "sarah@enduroclub.uk",
    pipeline_stage: "PRODUCTION",
    payment_status: "paid",
    subtotal_cents: 3800,
    tax_cents: 760,
    total_cents: 4560,
    currency: "GBP",
    division_slug: "labels-stickers",
    proof_status: "approved",
    approved_proof_version: 1,
    shipping_address: {
      name: "Sarah Jenkins",
      line1: "221B Baker Street",
      city: "London",
      postal_code: "NW1 6XE",
      country: "United Kingdom",
    },
    items: [
      {
        id: "item-001",
        order_id: "ord-seed-001",
        product_id: "prod-vinyl-sticker",
        product_name: "Custom Die-Cut Vinyl Stickers",
        division_slug: "labels-stickers",
        width_mm: 75,
        height_mm: 75,
        material: "Gloss White Vinyl",
        quantity: 100,
        unit_price_cents: 38,
        total_price_cents: 3800,
        artwork_type: "in_browser_designer",
        created_at: "2026-03-01T10:00:00.000Z",
      },
    ],
    status_history: [
      { from: "QUOTE", to: "ORDER", changed_by: "sarah@enduroclub.uk", timestamp: "2026-03-01T10:00:00.000Z" },
      { from: "ORDER", to: "ARTWORK", changed_by: "admin@w2p.co.in", timestamp: "2026-03-01T10:15:00.000Z" },
      { from: "ARTWORK", to: "PROOF", changed_by: "admin@w2p.co.in", timestamp: "2026-03-01T10:30:00.000Z" },
      { from: "PROOF", to: "PRODUCTION", changed_by: "admin@w2p.co.in", timestamp: "2026-03-01T11:00:00.000Z" },
    ],
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T11:00:00.000Z",
  },
  "W2P-2026-00102": {
    id: "ord-seed-002",
    order_number: "W2P-2026-00102",
    customer_id: "usr-cust-1",
    customer_name: "Sarah Jenkins",
    customer_email: "sarah@enduroclub.uk",
    pipeline_stage: "ORDER",
    payment_status: "pending_payment",
    subtotal_cents: 2400,
    tax_cents: 480,
    total_cents: 2880,
    currency: "GBP",
    division_slug: "labels-stickers",
    proof_status: "approved",
    approved_proof_version: 1,
    shipping_address: {
      name: "Sarah Jenkins",
      line1: "221B Baker Street",
      city: "London",
      postal_code: "NW1 6XE",
      country: "United Kingdom",
    },
    items: [
      {
        id: "item-002",
        order_id: "ord-seed-002",
        product_id: "prod-vinyl-sticker",
        product_name: "Custom Die-Cut Vinyl Stickers",
        division_slug: "labels-stickers",
        width_mm: 50,
        height_mm: 50,
        material: "Matte White Vinyl",
        quantity: 50,
        unit_price_cents: 48,
        total_price_cents: 2400,
        artwork_type: "in_browser_designer",
        created_at: "2026-03-02T11:00:00.000Z",
      },
    ],
    status_history: [
      { from: "QUOTE", to: "ORDER", changed_by: "sarah@enduroclub.uk", timestamp: "2026-03-02T11:00:00.000Z" },
    ],
    created_at: "2026-03-02T11:00:00.000Z",
    updated_at: "2026-03-02T11:00:00.000Z",
  },
  "W2P-2026-00201": {
    id: "ord-seed-003",
    order_number: "W2P-2026-00201",
    customer_id: "usr-cust-2",
    customer_name: "Customer B",
    customer_email: "customerb@example.com",
    pipeline_stage: "COMPLETED",
    payment_status: "paid",
    subtotal_cents: 7333,
    tax_cents: 1467,
    total_cents: 8800,
    currency: "GBP",
    division_slug: "race-event-numbers",
    proof_status: "approved",
    approved_proof_version: 1,
    shipping_address: {
      name: "Customer B",
      line1: "15 Royal Mile",
      city: "Edinburgh",
      postal_code: "EH1 2PB",
      country: "United Kingdom",
    },
    items: [
      {
        id: "item-003",
        order_id: "ord-seed-003",
        product_id: "tyvek-race-bibs",
        product_name: "Tyvek Race Bibs (Variable Data)",
        division_slug: "race-event-numbers",
        width_mm: 210,
        height_mm: 148,
        material: "DuPont Tyvek 54gsm",
        quantity: 200,
        unit_price_cents: 36,
        total_price_cents: 7333,
        artwork_type: "in_browser_designer",
        created_at: "2026-03-03T09:00:00.000Z",
      },
    ],
    status_history: [
      { from: "QUOTE", to: "ORDER", changed_by: "customerb@example.com", timestamp: "2026-03-03T09:00:00.000Z" },
      { from: "ORDER", to: "ARTWORK", changed_by: "admin@w2p.co.in", timestamp: "2026-03-03T09:30:00.000Z" },
      { from: "ARTWORK", to: "PROOF", changed_by: "admin@w2p.co.in", timestamp: "2026-03-03T10:00:00.000Z" },
      { from: "PROOF", to: "PRODUCTION", changed_by: "admin@w2p.co.in", timestamp: "2026-03-03T11:00:00.000Z" },
      { from: "PRODUCTION", to: "COMPLETED", changed_by: "admin@w2p.co.in", timestamp: "2026-03-03T15:00:00.000Z" },
    ],
    created_at: "2026-03-03T09:00:00.000Z",
    updated_at: "2026-03-03T15:00:00.000Z",
  },
  "W2P-2026-00202": {
    id: "ord-seed-004",
    order_number: "W2P-2026-00202",
    customer_id: "usr-cust-2",
    customer_name: "Customer B",
    customer_email: "customerb@example.com",
    pipeline_stage: "QUOTE",
    payment_status: "cancelled",
    subtotal_cents: 1250,
    tax_cents: 250,
    total_cents: 1500,
    currency: "GBP",
    division_slug: "stamps",
    proof_status: "pending_review",
    shipping_address: {
      name: "Customer B",
      line1: "15 Royal Mile",
      city: "Edinburgh",
      postal_code: "EH1 2PB",
      country: "United Kingdom",
    },
    items: [],
    status_history: [
      { from: "QUOTE", to: "QUOTE", changed_by: "customerb@example.com", timestamp: "2026-03-04T12:00:00.000Z" },
    ],
    created_at: "2026-03-04T12:00:00.000Z",
    updated_at: "2026-03-04T12:00:00.000Z",
  },
  "W2P-2026-00301": {
    id: "ord-seed-005",
    order_number: "W2P-2026-00301",
    customer_id: "usr-cust-3",
    customer_name: "Customer C",
    customer_email: "customerc@example.com",
    pipeline_stage: "QUOTE",
    payment_status: "failed",
    subtotal_cents: 2667,
    tax_cents: 533,
    total_cents: 3200,
    currency: "GBP",
    division_slug: "trophies",
    proof_status: "pending_review",
    shipping_address: {
      name: "Customer C",
      line1: "42 Queen Street",
      city: "Cardiff",
      postal_code: "CF10 2HQ",
      country: "United Kingdom",
    },
    items: [],
    status_history: [
      { from: "QUOTE", to: "QUOTE", changed_by: "customerc@example.com", timestamp: "2026-03-04T14:00:00.000Z" },
    ],
    created_at: "2026-03-04T14:00:00.000Z",
    updated_at: "2026-03-04T14:00:00.000Z",
  },
  "W2P-2026-00302": {
    id: "ord-seed-006",
    order_number: "W2P-2026-00302",
    customer_id: "usr-cust-3",
    customer_name: "Customer C",
    customer_email: "customerc@example.com",
    pipeline_stage: "ARTWORK",
    payment_status: "paid",
    subtotal_cents: 4333,
    tax_cents: 867,
    total_cents: 5200,
    currency: "GBP",
    division_slug: "mtb-boards",
    proof_status: "approved",
    approved_proof_version: 1,
    shipping_address: {
      name: "Customer C",
      line1: "42 Queen Street",
      city: "Cardiff",
      postal_code: "CF10 2HQ",
      country: "United Kingdom",
    },
    items: [
      {
        id: "item-006",
        order_id: "ord-seed-006",
        product_id: "downhill-mtb-number-board",
        product_name: "Downhill & Enduro Number Boards",
        division_slug: "mtb-boards",
        width_mm: 175,
        height_mm: 155,
        material: "0.8mm Flexible Polypropylene",
        quantity: 50,
        unit_price_cents: 86,
        total_price_cents: 4333,
        artwork_type: "in_browser_designer",
        created_at: "2026-03-05T08:00:00.000Z",
      },
    ],
    status_history: [
      { from: "QUOTE", to: "ORDER", changed_by: "customerc@example.com", timestamp: "2026-03-05T08:00:00.000Z" },
      { from: "ORDER", to: "ARTWORK", changed_by: "admin@w2p.co.in", timestamp: "2026-03-05T08:30:00.000Z" },
    ],
    created_at: "2026-03-05T08:00:00.000Z",
    updated_at: "2026-03-05T08:30:00.000Z",
  },
};

export function seedPhaseHDatabase(): void {
  resetUsersStore(SEED_USERS_MAP);
  resetCatalogStore();
  resetAuditStore();
  resetProofsStore(SEED_PROOFS);
  resetSavedDesignsStore(SEED_DESIGNS);
  resetDraftsStore();
  resetEmailStore();
  clearCapturedEmails();

  const storeData = {
    orders: { ...PHASE_H_ORDERS },
    dispatchedEmails: [],
  };

  fs.writeFileSync(ORDERS_STORE_FILE, JSON.stringify(storeData, null, 2), "utf-8");
}

if (require.main === module) {
  seedPhaseHDatabase();
  console.log("Phase H database successfully seeded with Customers A, B, C and Admin.");
}
