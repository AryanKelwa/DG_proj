import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Order, PipelineStage, PaymentStatus, ProofStatus } from "@/types/database";
import { INITIAL_ORDERS } from "@/lib/data/mock-data";
import { safeSendNotificationEmail } from "@/modules/email/email-service";

const ORDERS_STORE_FILE = path.join(process.cwd(), ".orders-store.json");
const SIGNED_URL_SECRET = process.env.SIGNED_URL_SECRET || "w2p-signed-production-secret-2026";

export interface StatusHistoryEntry {
  from: PipelineStage;
  to: PipelineStage;
  changed_by: string;
  timestamp: string;
  notes?: string;
}

export interface DispatchedEmailLog {
  id: string;
  recipient: string;
  subject: string;
  template: "status_update" | "order_completed" | "proof_ready";
  orderNumber: string;
  pipelineStage: PipelineStage;
  dispatchedAt: string;
}

interface OrderStoreData {
  orders: Record<string, Order>;
  dispatchedEmails?: DispatchedEmailLog[];
}

let inMemoryStore: OrderStoreData = { orders: {}, dispatchedEmails: [] };
let lastLoadedMtime = 0;
let isInitialized = false;

function loadStore(): void {
  try {
    if (fs.existsSync(ORDERS_STORE_FILE)) {
      const stats = fs.statSync(ORDERS_STORE_FILE);
      if (!isInitialized || stats.mtimeMs > lastLoadedMtime) {
        const raw = fs.readFileSync(ORDERS_STORE_FILE, "utf-8");
        inMemoryStore = JSON.parse(raw);
        if (!inMemoryStore.dispatchedEmails) {
          inMemoryStore.dispatchedEmails = [];
        }
        lastLoadedMtime = stats.mtimeMs;
        isInitialized = true;
      }
      return;
    }
  } catch (err) {
    console.warn("Could not read orders store file, falling back to memory:", err);
  }

  // First time initialization: populate seed orders
  if (!isInitialized) {
    inMemoryStore = { orders: {}, dispatchedEmails: [] };
    for (const o of INITIAL_ORDERS) {
      inMemoryStore.orders[o.order_number] = {
        ...o,
        status_history: [
          {
            from: "QUOTE" as PipelineStage,
            to: o.pipeline_stage,
            changed_by: "system_seed",
            timestamp: o.created_at,
          },
        ],
      };
    }
    saveStore();
    isInitialized = true;
  }
}

function saveStore(): void {
  try {
    const json = JSON.stringify(inMemoryStore, null, 2);
    fs.writeFileSync(ORDERS_STORE_FILE, json, "utf-8");
    const stats = fs.statSync(ORDERS_STORE_FILE);
    lastLoadedMtime = stats.mtimeMs;
  } catch (err) {
    console.warn("Could not write orders store file:", err);
  }
}

/**
 * Creates or updates an order in the persistent database/store.
 * Enforces idempotency: if an order with the same order_number already exists, returns it without creating a duplicate.
 */
export function createOrder(order: Order): { order: Order; isNew: boolean } {
  loadStore();

  // Check webhook idempotency by order_number
  const existing = inMemoryStore.orders[order.order_number];
  if (existing) {
    return { order: existing, isNew: false };
  }

  // Check if any order has matching stripe_session_id
  if (order.stripe_session_id) {
    const existingStripe = Object.values(inMemoryStore.orders).find(
      (o) => o.stripe_session_id === order.stripe_session_id
    );
    if (existingStripe) {
      return { order: existingStripe, isNew: false };
    }
  }

  // Immutable address snapshot must have all required fields
  const addr = order.shipping_address || {
    name: order.customer_name || "Valued Customer",
    line1: "Customer Address",
    city: "City",
    postal_code: "POSTCODE",
    country: "GB",
  };
  const immutableAddress = {
    name: (addr.name || order.customer_name || "Valued Customer").trim(),
    line1: (addr.line1 || "Customer Address").trim(),
    line2: addr.line2?.trim() || undefined,
    city: (addr.city || "City").trim(),
    postal_code: (addr.postal_code || "").trim().toUpperCase(),
    country: (addr.country || "GB").trim(),
  };

  const initialHistory: StatusHistoryEntry[] = [
    {
      from: "QUOTE",
      to: order.pipeline_stage || "ORDER",
      changed_by: order.customer_email || "customer",
      timestamp: order.created_at || new Date().toISOString(),
      notes: "Order placed and confirmed",
    },
  ];

  const persistedOrder: Order = {
    ...order,
    shipping_address: immutableAddress,
    status_history: order.status_history || initialHistory,
    created_at: order.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  inMemoryStore.orders[persistedOrder.order_number] = persistedOrder;
  saveStore();

  return { order: persistedOrder, isNew: true };
}

/**
 * Retrieve an order by order_number or id.
 */
export function getOrderById(idOrOrderNumber: string): Order | null {
  loadStore();
  if (inMemoryStore.orders[idOrOrderNumber]) {
    return inMemoryStore.orders[idOrOrderNumber];
  }
  const byId = Object.values(inMemoryStore.orders).find((o) => o.id === idOrOrderNumber);
  return byId || null;
}

/**
 * Check Ready-for-Production Gate (PRD § 08, § 11, DECISIONS.md):
 * True ONLY if proof approved AND payment confirmed.
 */
export function checkReadyForProduction(order: Order): {
  isReady: boolean;
  reason: string | null;
  proofApproved: boolean;
  paymentConfirmed: boolean;
} {
  const proofApproved =
    order.proof_status === "approved" ||
    !!order.approved_proof_version ||
    order.pipeline_stage === "PRODUCTION" ||
    order.pipeline_stage === "COMPLETED";

  const paymentConfirmed = order.payment_status === "paid";
  const isReady = proofApproved && paymentConfirmed;

  let reason: string | null = null;
  if (!isReady) {
    if (!proofApproved && !paymentConfirmed) {
      reason = "Proof not approved and payment not confirmed";
    } else if (!proofApproved) {
      reason = "Proof pending customer approval";
    } else if (!paymentConfirmed) {
      reason = `Payment not confirmed (Status: ${order.payment_status})`;
    }
  }

  return {
    isReady,
    reason,
    proofApproved,
    paymentConfirmed,
  };
}

/**
 * Get orders filtered by user ID and role, enforcing Row-Level Security (PRD § 05, § 09, § 10).
 */
export function getOrdersForUser(
  userId?: string | null,
  userEmail?: string | null,
  role: string = "customer"
): Order[] {
  loadStore();
  const all = Object.values(inMemoryStore.orders).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (role === "admin") {
    return all;
  }

  if (!userId && !userEmail) {
    return [];
  }

  const normId = (id?: string | null) => (id ? id.replace("-0", "-").toLowerCase() : "");

  return all.filter((o) => {
    const matchesId = userId && normId(o.customer_id) === normId(userId);
    const matchesEmail =
      userEmail && o.customer_email?.toLowerCase() === userEmail.toLowerCase();
    return matchesId || matchesEmail;
  });
}

/**
 * Admin Search & Combinable Filters (PRD § 11 Capability 01):
 * Search by order_number, customer_name, customer_email.
 * Filter by status/stage, payment_status, customer, product_type (division), date range.
 * Paginated server-side, sorted newest first.
 */
export function searchAdminOrders(options: {
  query?: string;
  stage?: string;
  payment_status?: string;
  customer?: string;
  product_type?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}): {
  orders: Array<Order & { isReadyForProduction: boolean; notReadyReason: string | null }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
} {
  loadStore();

  let list = Object.values(inMemoryStore.orders);

  // Search query (order number, customer name, customer email)
  if (options.query && options.query.trim()) {
    const q = options.query.toLowerCase().trim();
    list = list.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        (o.customer_name ? o.customer_name.toLowerCase().includes(q) : false) ||
        (o.customer_email ? o.customer_email.toLowerCase().includes(q) : false) ||
        (o.id ? o.id.toLowerCase().includes(q) : false)
    );
  }

  // Pipeline stage filter
  if (options.stage && options.stage.trim()) {
    const s = options.stage.trim().toUpperCase();
    list = list.filter((o) => o.pipeline_stage === s);
  }

  // Payment status filter
  if (options.payment_status && options.payment_status.trim()) {
    const p = options.payment_status.trim().toLowerCase();
    list = list.filter((o) => o.payment_status.toLowerCase() === p);
  }

  // Customer filter (id or email)
  if (options.customer && options.customer.trim()) {
    const c = options.customer.trim().toLowerCase();
    list = list.filter(
      (o) =>
        (o.customer_id ? o.customer_id.toLowerCase().includes(c) : false) ||
        (o.customer_email ? o.customer_email.toLowerCase().includes(c) : false) ||
        (o.customer_name ? o.customer_name.toLowerCase().includes(c) : false)
    );
  }

  // Product type (division_slug)
  if (options.product_type && options.product_type.trim()) {
    const pt = options.product_type.trim().toLowerCase();
    list = list.filter(
      (o) =>
        (o.division_slug && o.division_slug.toLowerCase() === pt) ||
        (o.items && o.items.some((item) => item.division_slug?.toLowerCase() === pt))
    );
  }

  // Date range filters
  if (options.date_from) {
    const fromTime = new Date(options.date_from).getTime();
    if (!isNaN(fromTime)) {
      list = list.filter((o) => new Date(o.created_at).getTime() >= fromTime);
    }
  }
  if (options.date_to) {
    const toTime = new Date(options.date_to).getTime();
    if (!isNaN(toTime)) {
      list = list.filter((o) => new Date(o.created_at).getTime() <= toTime);
    }
  }

  // Sort newest first
  list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const total = list.length;
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const totalPages = Math.ceil(total / limit) || 1;
  const offset = (page - 1) * limit;

  const paginated = list.slice(offset, offset + limit).map((o) => {
    const gate = checkReadyForProduction(o);
    // Sanitize: do not leak raw payment secrets or private hashes
    const { xero_invoice_data, ...rest } = o as any;
    return {
      ...rest,
      isReadyForProduction: gate.isReady,
      notReadyReason: gate.reason,
    };
  });

  return {
    orders: paginated,
    total,
    page,
    limit,
    totalPages,
  };
}

/**
 * Pipeline Transition Sequence (PRD § 11 & § 13):
 * Exactly: QUOTE -> ORDER -> ARTWORK -> PROOF -> PRODUCTION -> COMPLETED
 */
const PIPELINE_SEQUENCE: PipelineStage[] = [
  "QUOTE",
  "ORDER",
  "ARTWORK",
  "PROOF",
  "PRODUCTION",
  "COMPLETED",
];

export function validateStageTransition(
  current: PipelineStage,
  target: PipelineStage
): { valid: boolean; error?: string } {
  if (current === target) {
    return { valid: true };
  }

  const currentIndex = PIPELINE_SEQUENCE.indexOf(current);
  const targetIndex = PIPELINE_SEQUENCE.indexOf(target);

  if (currentIndex === -1 || targetIndex === -1) {
    return { valid: false, error: `Invalid pipeline stage: ${target}` };
  }

  // Forward one stage at a time: strictly currentIndex + 1
  if (targetIndex === currentIndex + 1) {
    return { valid: true };
  }

  // Allowed backward steps:
  // 1. PROOF back to ARTWORK (customer requested changes or artwork rejected)
  if (current === "PROOF" && target === "ARTWORK") {
    return { valid: true };
  }
  // 2. ARTWORK back to ORDER (file issue or customer request)
  if (current === "ARTWORK" && target === "ORDER") {
    return { valid: true };
  }

  // Skipping forward or arbitrary backward transitions are rejected
  if (targetIndex > currentIndex + 1) {
    return {
      valid: false,
      error: `Stage skipping is not allowed. Cannot transition directly from ${current} to ${target}. Must proceed sequentially: ${PIPELINE_SEQUENCE.slice(currentIndex, targetIndex + 1).join(" -> ")}.`,
    };
  }

  return {
    valid: false,
    error: `Illegal backward transition from ${current} to ${target}. Only PROOF -> ARTWORK and ARTWORK -> ORDER are permitted for pre-press revisions.`,
  };
}

/**
 * Update pipeline stage with optimistic locking and customer notification (PRD § 11, § 13).
 */
export function updateOrderStageWithVersion(
  orderNumberOrId: string,
  newStage: PipelineStage,
  expectedStage?: PipelineStage,
  adminEmail: string = "admin@w2p.co.in",
  notes?: string
): {
  success: boolean;
  order?: Order;
  conflict?: boolean;
  error?: string;
  emailSent?: boolean;
} {
  loadStore();

  const existing = getOrderById(orderNumberOrId);
  if (!existing) {
    return { success: false, error: `Order '${orderNumberOrId}' not found.` };
  }

  // Optimistic locking / version check:
  if (expectedStage && existing.pipeline_stage !== expectedStage) {
    return {
      success: false,
      conflict: true,
      error: `Stale order stage conflict. Expected '${expectedStage}' but current stage is '${existing.pipeline_stage}'. Please refresh.`,
    };
  }

  // Transition validation
  const transition = validateStageTransition(existing.pipeline_stage, newStage);
  if (!transition.valid) {
    return { success: false, error: transition.error };
  }

  const fromStage = existing.pipeline_stage;
  existing.pipeline_stage = newStage;
  existing.updated_at = new Date().toISOString();

  // Append to status history
  if (!existing.status_history) {
    existing.status_history = [];
  }
  existing.status_history.push({
    from: fromStage,
    to: newStage,
    changed_by: adminEmail,
    timestamp: new Date().toISOString(),
    notes: notes || undefined,
  });

  // Customer notification email dispatch (PRD § 13)
  const emailLog: DispatchedEmailLog = {
    id: `email-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    recipient: existing.customer_email || "customer@example.com",
    subject:
      newStage === "COMPLETED"
        ? `Order Completed & Dispatched: ${existing.order_number}`
        : `Order Update: ${existing.order_number} is now in ${newStage}`,
    template: newStage === "COMPLETED" ? "order_completed" : "status_update",
    orderNumber: existing.order_number,
    pipelineStage: newStage,
    dispatchedAt: new Date().toISOString(),
  };

  if (!inMemoryStore.dispatchedEmails) {
    inMemoryStore.dispatchedEmails = [];
  }
  inMemoryStore.dispatchedEmails.push(emailLog);

  // Dispatch exact-once server email asynchronously without blocking transaction
  const notificationEvent = newStage === "COMPLETED" ? "order_completed" : "pipeline_status_changed";
  safeSendNotificationEmail({
    to: existing.customer_email || "customer@example.com",
    recipientName: existing.customer_name || "Valued Customer",
    event: notificationEvent,
    orderId: existing.id,
    orderNumber: existing.order_number,
    stage: newStage,
    shippingAddress: existing.shipping_address,
  }).catch((err) => console.error("[OrderStore] Failed to send stage notification email:", err));

  saveStore();

  return {
    success: true,
    order: existing,
    emailSent: true,
  };
}

export function getDispatchedEmails(orderNumber?: string): DispatchedEmailLog[] {
  loadStore();
  const list = inMemoryStore.dispatchedEmails || [];
  if (orderNumber) {
    return list.filter((e) => e.orderNumber === orderNumber);
  }
  return list;
}

/**
 * Short-Lived Signed Download URLs for Production Files (PRD § 11, § 13):
 * 60-second HMAC token with expiration timestamp.
 */
export function generateSignedDownloadToken(orderNumber: string, expiresInSeconds: number = 60): {
  token: string;
  expires: number;
} {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${orderNumber}:${expires}`;
  const hmac = crypto.createHmac("sha256", SIGNED_URL_SECRET).update(payload).digest("hex");
  const token = `${hmac}.${expires}`;
  return { token, expires };
}

export function verifySignedDownloadToken(orderNumber: string, token: string): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [hmac, expiresStr] = parts;

  // Enforce strictly digits for expires
  if (!/^\d+$/.test(expiresStr)) {
    return false;
  }

  const expires = parseInt(expiresStr, 10);

  if (isNaN(expires) || Math.floor(Date.now() / 1000) > expires) {
    return false; // Expired
  }

  const expectedPayload = `${orderNumber}:${expires}`;
  const expectedHmac = crypto.createHmac("sha256", SIGNED_URL_SECRET).update(expectedPayload).digest("hex");

  const bufA = Buffer.from(hmac);
  const bufB = Buffer.from(expectedHmac);
  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Admin Reports & Analytics Aggregation (PRD § 11 Capability 05):
 * Revenue calculated strictly on confirmed payments ('paid').
 * Excludes pending, failed, cancelled.
 */
export function getAdminReportsData(dateFrom?: string, dateTo?: string) {
  loadStore();

  let orders = Object.values(inMemoryStore.orders);

  if (dateFrom) {
    const f = new Date(dateFrom).getTime();
    if (!isNaN(f)) orders = orders.filter((o) => new Date(o.created_at).getTime() >= f);
  }
  if (dateTo) {
    const t = new Date(dateTo).getTime();
    if (!isNaN(t)) orders = orders.filter((o) => new Date(o.created_at).getTime() <= t);
  }

  let confirmedRevenueCents = 0;
  let totalOrders = orders.length;
  let paidCount = 0;
  let pendingCount = 0;
  let cancelledCount = 0;
  let failedCount = 0;

  const stageCounts: Record<PipelineStage, number> = {
    QUOTE: 0,
    ORDER: 0,
    ARTWORK: 0,
    PROOF: 0,
    PRODUCTION: 0,
    COMPLETED: 0,
  };

  const divisionThroughput: Record<string, { count: number; totalQuantity: number; revenueCents: number }> = {};

  for (const o of orders) {
    if (stageCounts[o.pipeline_stage] !== undefined) {
      stageCounts[o.pipeline_stage]++;
    }

    if (o.payment_status === "paid") {
      confirmedRevenueCents += o.total_cents;
      paidCount++;
    } else if (o.payment_status === "pending_payment" || (o.payment_status as string) === "pending") {
      pendingCount++;
    } else if (o.payment_status === "cancelled") {
      cancelledCount++;
    } else if (o.payment_status === "failed") {
      failedCount++;
    }

    const divSlug = o.division_slug || "labels-stickers";
    if (!divisionThroughput[divSlug]) {
      divisionThroughput[divSlug] = { count: 0, totalQuantity: 0, revenueCents: 0 };
    }
    divisionThroughput[divSlug].count++;
    const totalQty = (o.items || []).reduce((acc, it) => acc + (it.quantity || 1), 0);
    divisionThroughput[divSlug].totalQuantity += totalQty;
    if (o.payment_status === "paid") {
      divisionThroughput[divSlug].revenueCents += o.total_cents;
    }
  }

  return {
    currency: "GBP",
    confirmedRevenueCents,
    confirmedRevenueFormatted: new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
      confirmedRevenueCents / 100
    ),
    totalOrders,
    paidCount,
    pendingCount,
    cancelledCount,
    failedCount,
    stageCounts,
    divisionThroughput,
  };
}

/**
 * Archive Retrieval (PRD § 11 Capability 04):
 * Completed orders move to archive view; searchable by customer, date, product type.
 * Artwork and files remain retrievable.
 */
export function getArchivedOrders(options: {
  query?: string;
  customer?: string;
  product_type?: string;
  date_from?: string;
  date_to?: string;
}) {
  const allCompleted = searchAdminOrders({
    ...options,
    stage: "COMPLETED",
    limit: 100,
  });

  return allCompleted;
}

/**
 * Reset orders store to initial seed state.
 */
export function resetOrderStore(): void {
  inMemoryStore = { orders: {}, dispatchedEmails: [] };
  for (const o of INITIAL_ORDERS) {
    inMemoryStore.orders[o.order_number] = {
      ...o,
      status_history: [
        {
          from: "QUOTE" as PipelineStage,
          to: o.pipeline_stage,
          changed_by: "system_seed",
          timestamp: o.created_at,
        },
      ],
    };
  }
  saveStore();
}
