import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  searchAdminOrders,
  checkReadyForProduction,
  validateStageTransition,
  updateOrderStageWithVersion,
  generateSignedDownloadToken,
  verifySignedDownloadToken,
  getAdminReportsData,
  getArchivedOrders,
} from "@/modules/orders/order-store";
import {
  getUserById,
  validateCredentials,
  createSessionToken,
  verifySessionToken,
  updateUserRole,
  updateUserStatus,
  registerCustomerUser,
} from "@/modules/auth/users-store";
import {
  getProductBySlug,
  updateProduct,
} from "@/modules/catalog/catalog-store";
import { logAdminAction, getAuditLogs, resetAuditStore } from "@/modules/audit/audit-store";
import { seedPhaseHDatabase, PHASE_H_ORDERS } from "@/modules/seed/seed-data";

describe("PHASE H: Admin Capabilities & Security Tests (PRD § 03, § 11, § 13, § 14, § 15)", () => {
  beforeEach(() => {
    seedPhaseHDatabase();
  });

  describe("Stage 2: Admin Visibility & Three-Layer Authorization", () => {
    it("Admin sees every order placed by every customer account", () => {
      const result = searchAdminOrders({});
      assert.strictEqual(result.total, 6);
      assert.strictEqual(result.orders.length, 6);

      // Verify orders from Customer A, B, C are present
      const customerIds = new Set(result.orders.map((o) => o.customer_id));
      assert.ok(customerIds.has("usr-cust-1"));
      assert.ok(customerIds.has("usr-cust-2"));
      assert.ok(customerIds.has("usr-cust-3"));

      // Verify payment statuses exist and are visible
      const paymentStatuses = result.orders.map((o) => o.payment_status);
      assert.ok(paymentStatuses.includes("paid"));
      assert.ok(paymentStatuses.includes("pending_payment"));
      assert.ok(paymentStatuses.includes("cancelled"));
      assert.ok(paymentStatuses.includes("failed"));
    });

    it("Session verification strictly derives role on server from users store", () => {
      const admin = getUserById("usr-admin-01");
      assert.ok(admin);
      assert.strictEqual(admin?.role, "admin");

      const token = createSessionToken(admin!);
      const verified = verifySessionToken(token);
      assert.ok(verified);
      assert.strictEqual(verified?.role, "admin");

      const customer = getUserById("usr-cust-1");
      const custToken = createSessionToken(customer!);
      const custVerified = verifySessionToken(custToken);
      assert.strictEqual(custVerified?.role, "customer");
    });

    it("Admin list sanitizes response and strips private credentials/secrets", () => {
      const result = searchAdminOrders({});
      for (const order of result.orders) {
        assert.strictEqual((order as any).stripe_secret_key, undefined);
        assert.strictEqual((order as any).passwordHash, undefined);
        assert.strictEqual((order as any).xero_invoice_data, undefined);
      }
    });

    it("Logs every admin action to audit store", () => {
      resetAuditStore();
      logAdminAction("usr-admin-01", "admin@w2p.co.in", "pipeline_stage_change", "order", "W2P-2026-00101", {
        from: "ORDER",
        to: "ARTWORK",
      });

      const logs = getAuditLogs();
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].action, "pipeline_stage_change");
      assert.strictEqual(logs[0].target_id, "W2P-2026-00101");
      assert.strictEqual(logs[0].admin_email, "admin@w2p.co.in");
    });
  });

  describe("Stage 3: Admin Search, Combinable Filters & Pagination", () => {
    it("Filters orders by search query alone", () => {
      const res = searchAdminOrders({ query: "Sarah" });
      assert.strictEqual(res.total, 2);
      assert.ok(res.orders.every((o) => o.customer_name?.includes("Sarah")));
    });

    it("Filters orders by pipeline stage alone", () => {
      const res = searchAdminOrders({ stage: "PRODUCTION" });
      assert.strictEqual(res.total, 1);
      assert.strictEqual(res.orders[0].order_number, "W2P-2026-00101");
    });

    it("Filters orders by payment status alone", () => {
      const res = searchAdminOrders({ payment_status: "paid" });
      assert.strictEqual(res.total, 3);
      assert.ok(res.orders.every((o) => o.payment_status === "paid"));
    });

    it("Combines multiple filters: stage, payment status, division", () => {
      const res = searchAdminOrders({
        stage: "PRODUCTION",
        payment_status: "paid",
        product_type: "labels-stickers",
      });
      assert.strictEqual(res.total, 1);
      assert.strictEqual(res.orders[0].order_number, "W2P-2026-00101");
    });

    it("Paginates results server-side with correct totalPages", () => {
      const page1 = searchAdminOrders({ limit: 2, page: 1 });
      assert.strictEqual(page1.orders.length, 2);
      assert.strictEqual(page1.totalPages, 3);
      assert.strictEqual(page1.total, 6);

      const page2 = searchAdminOrders({ limit: 2, page: 2 });
      assert.strictEqual(page2.orders.length, 2);
      assert.notStrictEqual(page1.orders[0].order_number, page2.orders[0].order_number);
    });
  });

  describe("Stage 3: Ready-for-Production Gate & 60-Second Signed Download URLs", () => {
    it("Evaluates ready-for-production strictly: true iff proof approved AND payment confirmed", () => {
      // 1. Paid & Approved -> Ready
      const order1 = PHASE_H_ORDERS["W2P-2026-00101"];
      const gate1 = checkReadyForProduction(order1);
      assert.strictEqual(gate1.isReady, true);
      assert.strictEqual(gate1.reason, null);

      // 2. Unpaid & Approved -> Not Ready
      const order2 = PHASE_H_ORDERS["W2P-2026-00102"];
      const gate2 = checkReadyForProduction(order2);
      assert.strictEqual(gate2.isReady, false);
      assert.ok(gate2.reason?.includes("Payment not confirmed"));

      // 3. Unpaid & Unapproved -> Not Ready
      const order5 = PHASE_H_ORDERS["W2P-2026-00301"];
      const gate5 = checkReadyForProduction(order5);
      assert.strictEqual(gate5.isReady, false);
      assert.ok(gate5.reason?.includes("Proof not approved and payment not confirmed"));
    });

    it("Generates valid HMAC signed URL token with 60-second TTL", () => {
      const { token, expires } = generateSignedDownloadToken("W2P-2026-00101", 60);
      assert.ok(token);
      assert.ok(expires > Math.floor(Date.now() / 1000));

      // Verifies correctly
      const isValid = verifySignedDownloadToken("W2P-2026-00101", token);
      assert.strictEqual(isValid, true);

      // Fails for wrong order number
      const wrongOrder = verifySignedDownloadToken("W2P-2026-99999", token);
      assert.strictEqual(wrongOrder, false);

      // Fails for tampered token
      const tampered = verifySignedDownloadToken("W2P-2026-00101", token + "bad");
      assert.strictEqual(tampered, false);
    });

    it("Expired signed token is rejected", () => {
      // Generate token that already expired 5 seconds ago
      const { token } = generateSignedDownloadToken("W2P-2026-00101", -5);
      const isValid = verifySignedDownloadToken("W2P-2026-00101", token);
      assert.strictEqual(isValid, false);
    });
  });

  describe("Stage 3: Sequential Pipeline Transitions & Optimistic Locking", () => {
    it("Validates sequential forward transitions (forward 1 step only)", () => {
      assert.strictEqual(validateStageTransition("QUOTE", "ORDER").valid, true);
      assert.strictEqual(validateStageTransition("ORDER", "ARTWORK").valid, true);
      assert.strictEqual(validateStageTransition("ARTWORK", "PROOF").valid, true);
      assert.strictEqual(validateStageTransition("PROOF", "PRODUCTION").valid, true);
      assert.strictEqual(validateStageTransition("PRODUCTION", "COMPLETED").valid, true);
    });

    it("Rejects stage skipping forward", () => {
      const skip1 = validateStageTransition("QUOTE", "PRODUCTION");
      assert.strictEqual(skip1.valid, false);
      assert.ok(skip1.error?.includes("Stage skipping is not allowed"));

      const skip2 = validateStageTransition("ORDER", "COMPLETED");
      assert.strictEqual(skip2.valid, false);
    });

    it("Allows pre-press revision backward steps (PROOF -> ARTWORK, ARTWORK -> ORDER)", () => {
      assert.strictEqual(validateStageTransition("PROOF", "ARTWORK").valid, true);
      assert.strictEqual(validateStageTransition("ARTWORK", "ORDER").valid, true);
    });

    it("Rejects arbitrary backward jumps (e.g. COMPLETED -> QUOTE)", () => {
      const res = validateStageTransition("COMPLETED", "QUOTE");
      assert.strictEqual(res.valid, false);
      assert.ok(res.error?.includes("Illegal backward transition"));
    });

    it("Optimistic locking rejects stale status updates with 409 conflict", () => {
      // Order W2P-2026-00101 is currently in PRODUCTION
      const res = updateOrderStageWithVersion(
        "W2P-2026-00101",
        "COMPLETED",
        "ORDER", // Stale expected stage
        "admin@w2p.co.in"
      );

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.conflict, true);
      assert.ok(res.error?.includes("Stale order stage conflict"));
    });

    it("Records status history entry and logs customer notification email on transition", () => {
      const res = updateOrderStageWithVersion(
        "W2P-2026-00101",
        "COMPLETED",
        "PRODUCTION", // Correct current stage
        "admin@w2p.co.in",
        "Manufactured and dispatched via DPD"
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.order?.pipeline_stage, "COMPLETED");
      assert.strictEqual(res.emailSent, true);

      // Check status history
      const history = res.order?.status_history;
      assert.ok(history);
      const lastEntry = history[history.length - 1];
      assert.strictEqual(lastEntry.from, "PRODUCTION");
      assert.strictEqual(lastEntry.to, "COMPLETED");
      assert.strictEqual(lastEntry.changed_by, "admin@w2p.co.in");
    });
  });

  describe("Stage 3: User Management Safeguards (PRD § 03, § 11)", () => {
    it("Cannot demote own admin account", () => {
      const res = updateUserRole("usr-admin-01", "usr-admin-01", "customer");
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes("cannot demote your own admin account"));
    });

    it("Cannot deactivate own account", () => {
      const res = updateUserStatus("usr-admin-01", "usr-admin-01", false);
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes("cannot deactivate your own account"));
    });

    it("Cannot demote or deactivate the last remaining admin", () => {
      // There is only 1 admin in seed data (usr-admin-01)
      const resRole = updateUserRole("some-other-id", "usr-admin-01", "customer");
      assert.strictEqual(resRole.success, false);
      assert.ok(resRole.error?.includes("Cannot demote the last active administrator"));

      const resStatus = updateUserStatus("some-other-id", "usr-admin-01", false);
      assert.strictEqual(resStatus.success, false);
      assert.ok(resStatus.error?.includes("Cannot deactivate the last active administrator"));
    });

    it("Public customer signup strictly assigns role 'customer'", () => {
      const res = registerCustomerUser("newbuyer@example.com", "mypassword123", {
        fullName: "New Buyer",
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.user?.role, "customer");

      // Verify credentials validate and deactivate prevents login
      const creds = validateCredentials("newbuyer@example.com", "mypassword123");
      assert.ok(creds.user);

      // Deactivate account
      updateUserStatus("usr-admin-01", res.user!.id, false);
      const deactCreds = validateCredentials("newbuyer@example.com", "mypassword123");
      assert.strictEqual(deactCreds.user, null);
      assert.ok(deactCreds.error?.includes("deactivated"));
    });
  });

  describe("Stage 3: Parameter-Driven Products & Instant Pricing Tiers (PRD § 03, § 14)", () => {
    it("Edits product pricing tiers and reflects live without redeploy", () => {
      const prod = getProductBySlug("custom-die-cut-vinyl");
      assert.ok(prod);

      const updatedTiers = [
        { min_quantity: 50, discount_percentage: 15 },
        { min_quantity: 100, discount_percentage: 25 },
        { min_quantity: 500, discount_percentage: 45 },
      ];

      const res = updateProduct(prod!.id, {
        base_price_cents: 22,
        pricing_tiers: updatedTiers,
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.product?.base_price_cents, 22);
      assert.strictEqual(res.product?.pricing_tiers?.length, 3);

      // Fetch freshly from catalog store
      const fresh = getProductBySlug("custom-die-cut-vinyl");
      assert.strictEqual(fresh?.base_price_cents, 22);
      assert.strictEqual(fresh?.pricing_tiers?.[0].discount_percentage, 15);
    });

    it("Rejects invalid pricing tiers (overlapping floors, negative discounts)", () => {
      const prod = getProductBySlug("custom-die-cut-vinyl");
      assert.ok(prod);

      // Overlapping floors (duplicate 50)
      const duplicateFloors = [
        { min_quantity: 50, discount_percentage: 10 },
        { min_quantity: 50, discount_percentage: 20 },
      ];
      const resDup = updateProduct(prod!.id, { pricing_tiers: duplicateFloors });
      assert.strictEqual(resDup.success, false);
      assert.ok(resDup.error?.includes("Duplicate tier floor"));

      // Negative discount
      const negDiscount = [{ min_quantity: 50, discount_percentage: -5 }];
      const resNeg = updateProduct(prod!.id, { pricing_tiers: negDiscount });
      assert.strictEqual(resNeg.success, false);
      assert.ok(resNeg.error?.includes("between 0 and 100"));
    });
  });

  describe("Stage 3: Reports & Revenue Calculation (PRD § 11 Capability 05)", () => {
    it("Computes revenue strictly on confirmed payments ('paid') and excludes pending/cancelled", () => {
      const data = getAdminReportsData();

      // Seed orders:
      // W2P-2026-00101: paid 4560
      // W2P-2026-00102: pending_payment 2880 (EXCLUDED from revenue)
      // W2P-2026-00201: paid 8800
      // W2P-2026-00202: cancelled 1500 (EXCLUDED from revenue)
      // W2P-2026-00301: failed 3200 (EXCLUDED from revenue)
      // W2P-2026-00302: paid 5200
      // Confirmed Revenue: 4560 + 8800 + 5200 = 18560 cents (£185.60)
      assert.strictEqual(data.confirmedRevenueCents, 18560);
      assert.strictEqual(data.totalOrders, 6);
      assert.strictEqual(data.paidCount, 3);
      assert.strictEqual(data.pendingCount, 1);
      assert.strictEqual(data.cancelledCount, 1);
      assert.strictEqual(data.failedCount, 1);
      assert.strictEqual(data.currency, "GBP");
    });
  });

  describe("Stage 3: Archive View (PRD § 11 Capability 04)", () => {
    it("Retrieves completed orders for repeat and event orders", () => {
      const archive = getArchivedOrders({});
      assert.strictEqual(archive.total, 1);
      assert.strictEqual(archive.orders[0].order_number, "W2P-2026-00201");
      assert.strictEqual(archive.orders[0].pipeline_stage, "COMPLETED");
    });
  });
});
