# Database & Job Draft Schema Specification

**Platform:** W2P (Web-to-Print Platform)  
**Standard:** Digital Heroes PRD (Level 2 - March 2026 Edition)  
**Authority:** Single Source of Truth for Job Specifications & Workflow Lifecycle (§ 04, § 06, § 08)

---

## 1. Overview & Single Source of Truth Principle

In accordance with PRD § 04, § 06, and § 08, job parameters (dimensions, materials, volume tier, price) must never be transmitted between pages as loose URL query parameters. All application surfaces operate solely on a immutable **Job Draft** ID. The server authoritatively recomputes pricing and validates stage transitions at every phase.

---

## 2. Job Draft Model (`JobDraft`)

```typescript
export type DraftStatus =
  | "configured"
  | "artwork_ready"
  | "proof_pending"
  | "proof_approved"
  | "payment_pending"
  | "paid";

export interface DraftOptions {
  widthMm: number;
  heightMm: number;
  materialId: string;
  orientation?: "portrait" | "landscape" | "square";
  bleedMm: number;
  safetyMarginMm: number;
}

export interface DraftProofRecord {
  version: number;
  renderedUrl: string;
  sha256Hash: string;
  createdAt: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  feedback?: string | null;
}

export interface DraftAuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorEmail: string;
  fromStatus: DraftStatus;
  toStatus: DraftStatus;
  action: string;
  details?: Record<string, unknown>;
}

export interface JobDraft {
  id: string; // e.g. "dft_1795071234_abc12"
  productId: string; // PRD catalog identifier
  productSlug: string; // e.g. "custom-die-cut-vinyl"
  productName: string;
  divisionSlug: DivisionSlug;
  options: DraftOptions;
  quantity: number;
  designJson: Record<string, unknown> | null;
  uploadedFileRef: string | null;
  csvFileRef: string | null;
  proofVersion: number;
  proofs: DraftProofRecord[];
  status: DraftStatus;
  customerId: string | null; // null for anonymous guests
  customerEmail: string | null;
  orderId: string | null; // Set when converted to ERP Order
  auditLog: DraftAuditLogEntry[];
  createdAt: string;
  updatedAt: string;
}
```

---

## 3. State Machine & Transition Rules (§ 01, § 03, § 05, § 06, § 08)

The customer journey enforces a strict sequential progression:

```
configured ──> artwork_ready ──> proof_pending ──> proof_approved ──> payment_pending ──> paid
                                      ▲                   │
                                      └─── (changes req) ─┘
```

| Current Status | Permitted Next Statuses | Trigger / Gate | Rejection Behavior |
| :--- | :--- | :--- | :--- |
| `configured` | `artwork_ready` | Design saved or artwork uploaded | Direct jump to checkout rejected (400) |
| `artwork_ready` | `proof_pending`, `configured` | Proof preview generated | Direct jump to payment rejected (400) |
| `proof_pending` | `proof_approved`, `proof_pending` | Customer formal inspection & approval, or Revision requested (v+1) | Cannot jump to payment without approval |
| `proof_approved` | `payment_pending`, `proof_pending` | Checkout session creation initiated | Checkout only accessible here |
| `payment_pending` | `paid`, `proof_approved` | Webhook verification or card charge; failure returns to `proof_approved` | Reverts on payment decline |
| `paid` | (terminal) | Order confirmed, invoice issued, jobs dispatched to workshop | Immutable state |

---

## 4. Anonymous Guest Configuration & Session Attachment (§ 03)

1. A guest visitor configures dimensions, material, and volume in the **Instant Calculator** (`/calculator`) without authentication.
2. Clicking **"Continue to In-Browser Designer"** generates a draft in `configured` state and stores `w2p_guest_draft_id` in `localStorage` or session cookie.
3. If the visitor is not logged in, they are redirected to `/login?redirect=/designer/${draftId}`.
4. Upon successful login or registration, the backend invokes `POST /api/drafts/[id]/attach-user` to bind `customerId` and `customerEmail`.
5. The user is redirected back to `/designer/${draftId}` with their configured draft intact.

---

## 5. Server-Side Proof Verification & SHA-256 Hashing (§ 08)

When a customer inspects and approves a proof:
1. The server renders the proof SVG/PDF with strict dimensional callouts, trim boxes, and `"W2P PROOF · v{n}"` watermarks.
2. A cryptographic SHA-256 digest (`crypto.createHash('sha256')`) is computed from the proof file bytes.
3. The proof record is stored immutably with `version`, `sha256Hash`, `approvedBy` (customer email), and `approvedAt` (ISO timestamp).
4. The draft transitions to `proof_approved`, unlocking the high-resolution 300 DPI production files in the back-office console.

---

## 6. Persisted Order Schema & Immutable Address Snapshot (PRD § 05, § 09, § 10)

```typescript
export interface OrderShippingAddressSnapshot {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  postal_code: string;
  country: string;
}

export interface Order {
  id: string; // e.g. "ord-1795079999"
  order_number: string; // e.g. "W2P-2026-00455" (Unique)
  customer_id: string; // UUID or test ID
  customer_name?: string;
  customer_email?: string;
  pipeline_stage: PipelineStage; // "QUOTE" | "ORDER" | "ARTWORK" | "PROOF" | "PRODUCTION" | "COMPLETED"
  payment_status: PaymentStatus; // "pending" | "paid" | "failed" | "refunded"
  subtotal_cents: number;
  tax_cents: number; // 20% VAT
  total_cents: number;
  currency: "GBP";
  shipping_address: OrderShippingAddressSnapshot; // Immutable JSONB snapshot
  draft_id?: string;
  proof_version?: number;
  stripe_session_id?: string;
  xero_invoice_data?: Record<string, unknown>;
  notes?: string;
  created_at: string;
  updated_at: string;
}
```

### Inviolable Rules for Order Data
1. **Persistence:** Orders are written authoritatively to the server database (`.orders-store.json` & Supabase `public.orders`). Orders are never held solely in client-side React state, localStorage, or cookies, and are never lost on logout, browser close, or server restart.
2. **Immutable Address Snapshot:** The delivery address entered during checkout is frozen on the order as an immutable snapshot. It is never overwritten by subsequent profile modifications or default fallbacks.
3. **Multi-Tenant Row-Level Security:** Queries to `/api/orders` filter strictly by `customer_id` and customer email. Customer A can never view or access Customer B's orders. Staff/Admin roles have full operational visibility for the production queue.
4. **Webhook Idempotency:** Webhook replay events are checked against `order_number` and `stripe_session_id`. Duplicate events return `duplicate: true` and never spawn duplicate order rows.

---

## 7. Admin Audit Log Schema & Three-Layer Authorization (PRD § 03, § 11, § 15)

```typescript
export interface AdminAuditEntry {
  id: string; // "aud-{timestamp}-{hash}"
  admin_id: string; // Authenticated user ID
  admin_email: string;
  action:
    | "pipeline_stage_change"
    | "production_file_download"
    | "user_role_change"
    | "user_status_change"
    | "product_template_edit"
    | "order_archive";
  target_type: "order" | "user" | "product";
  target_id: string;
  details: Record<string, unknown>;
  created_at: string; // ISO 8601
}
```

### Three-Layer Security Model
1. **Layer 1: Next.js Middleware (`src/middleware.ts`):** Intercepts `/production` and `/api/admin/*`, verifying valid session tokens before request routing.
2. **Layer 2: Server API Route Verification (`src/lib/server-auth.ts`):** Verifies authenticated user profile in the persistent store; enforces `role === 'admin'`. Returns 401 for missing session, 403 for non-admin customer accounts. Never trusts client-supplied query parameters or request body roles.
3. **Layer 3: Database Row-Level Security & Server Data Layer:** Admin queries execute strictly in server routes with zero service-role keys bundled into client assets.

---

## 8. Transactional Email Log Schema (PRD § 13)

```typescript
export type EmailEvent =
  | "order_confirmed"
  | "proof_ready"
  | "change_requested"
  | "proof_approved"
  | "pipeline_status_changed"
  | "order_completed";

export interface EmailLogRecord {
  id: string; // "eml-{timestamp}-{hash}"
  idempotency_key: string; // "email:{orderNumber}:{event}:{stageOrVersion}" (UNIQUE)
  order_id: string;
  event: EmailEvent;
  recipient: string;
  recipient_name: string;
  subject: string;
  body_text: string;
  body_html: string;
  status: "sent" | "failed" | "skipped_duplicate";
  provider: string; // "resend" | "mailpit" | "test_capture"
  provider_message_id?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  created_at: string; // ISO 8601
}
```

### Guarantees
1. **Exact-Once Dispatch:** Deterministic idempotency keys prevent duplicate transmissions on webhook replays.
2. **Graceful Fault Tolerance:** Provider exceptions are caught and logged with `status: "failed"`, ensuring business processes (orders, approvals, transitions) never fail due to email outages.
3. **Tenant Isolation:** Email templates strictly serialize the target customer's order specifications.



