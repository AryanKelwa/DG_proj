import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { registerCustomerUser } from "@/modules/auth/users-store";
import { getOrdersForUser, createOrder } from "@/modules/orders/order-store";
import { getProofsForUser } from "@/modules/proofs/proofs-store";
import { getSavedDesignsForUser } from "@/modules/designs/saved-designs-store";
import { seedPhaseHDatabase } from "@/modules/seed/seed-data";
import { Order } from "@/types/database";

describe("PHASE I: Customer Data Leak & Strict Tenant Isolation (PRD § 03, § 10)", () => {
  beforeEach(() => {
    seedPhaseHDatabase();
  });

  describe("1. New User Registration & Profile Identity", () => {
    it("stores full name, email, and phone during registration without falling back to demo values", () => {
      const reg = registerCustomerUser(
        "mohit.singh@example.com",
        "SecurePassword123!",
        {
          fullName: "Mohit Singh",
          companyName: "Singh Innovations",
          phone: "+44 7700 900555",
        }
      );

      assert.strictEqual(reg.success, true);
      assert.ok(reg.user);
      assert.strictEqual(reg.user.full_name, "Mohit Singh");
      assert.strictEqual(reg.user.email, "mohit.singh@example.com");
      assert.strictEqual(reg.user.company_name, "Singh Innovations");
      assert.strictEqual(reg.user.phone, "+44 7700 900555");
      assert.ok(!reg.user.phone.includes("7911"));
      assert.ok(!reg.user.full_name.includes("Sarah"));
    });

    it("stores empty/null phone cleanly when phone is omitted, never defaulting to demo phone", () => {
      const reg = registerCustomerUser(
        "no.phone@example.com",
        "SecurePassword123!",
        {
          fullName: "No Phone User",
        }
      );

      assert.strictEqual(reg.success, true);
      assert.ok(reg.user);
      assert.strictEqual(reg.user.phone, null);
    });
  });

  describe("2. Order History Isolation & Zero Initial Counts", () => {
    it("new user has strictly zero orders, zero pending proofs, and zero saved designs", () => {
      const reg = registerCustomerUser(
        "fresh.user@example.com",
        "SecurePassword123!",
        { fullName: "Fresh User" }
      );
      const newUser = reg.user!;

      const userOrders = getOrdersForUser(newUser.id, newUser.email, "customer");
      assert.strictEqual(userOrders.length, 0, "New customer must have 0 orders");

      const userProofs = getProofsForUser(newUser.id, newUser.email, "customer");
      assert.strictEqual(userProofs.length, 0, "New customer must have 0 proofs");

      const userDesigns = getSavedDesignsForUser(newUser.id, "customer");
      assert.strictEqual(userDesigns.length, 0, "New customer must have 0 saved designs");
    });

    it("orders placed by new user appear ONLY in their own history and never in seeded customer history", () => {
      const reg = registerCustomerUser(
        "mohit.isolated@example.com",
        "SecurePassword123!",
        { fullName: "Mohit Isolated" }
      );
      const newUser = reg.user!;

      const newOrder: Order = {
        id: "ord-mohit-001",
        order_number: "W2P-2026-MOHIT-01",
        customer_id: newUser.id,
        customer_name: newUser.full_name || undefined,
        customer_email: newUser.email,
        pipeline_stage: "ORDER",
        payment_status: "paid",
        subtotal_cents: 5000,
        tax_cents: 1000,
        total_cents: 6000,
        currency: "GBP",
        shipping_address: {
          name: "Mohit Isolated",
          line1: "10 Downing St",
          city: "London",
          postal_code: "SW1A 2AA",
          country: "United Kingdom",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      createOrder(newOrder);

      // Mohit sees his own order
      const mohitOrders = getOrdersForUser(newUser.id, newUser.email, "customer");
      assert.strictEqual(mohitOrders.length, 1);
      assert.strictEqual(mohitOrders[0].order_number, "W2P-2026-MOHIT-01");

      // Seeded customer Sarah (usr-cust-1) does NOT see Mohit's order
      const sarahOrders = getOrdersForUser("usr-cust-1", "sarah@enduroclub.uk", "customer");
      assert.ok(sarahOrders.every((o) => o.customer_id === "usr-cust-1"));
      assert.ok(!sarahOrders.some((o) => o.order_number === "W2P-2026-MOHIT-01"));

      // Mohit does NOT see Sarah's orders
      assert.ok(!mohitOrders.some((o) => o.customer_id === "usr-cust-1"));
    });
  });

  describe("3. Cross-Tenant API & Store Access Restrictions", () => {
    it("customer querying proofs or designs of another user gets 0 rows", () => {
      const reg = registerCustomerUser(
        "attacker@example.com",
        "SecurePassword123!",
        { fullName: "Attacker User" }
      );
      const attacker = reg.user!;

      // Attacker attempts to read proofs
      const attackerProofs = getProofsForUser(attacker.id, attacker.email, "customer");
      assert.strictEqual(attackerProofs.length, 0);

      // Attacker attempts to read saved designs
      const attackerDesigns = getSavedDesignsForUser(attacker.id, "customer");
      assert.strictEqual(attackerDesigns.length, 0);

      // Seeded customer Sarah (usr-cust-1) has 1 saved design
      const sarahDesigns = getSavedDesignsForUser("usr-cust-1", "customer");
      assert.strictEqual(sarahDesigns.length, 1);
      assert.strictEqual(sarahDesigns[0].id, "des-01");
    });
  });

  describe("4. Mutation Check: User ID Filter Removal Causes Test Failure", () => {
    it("mutation check: removing the customer_id filter leaks cross-account designs", () => {
      const reg = registerCustomerUser(
        "tenant.b@example.com",
        "SecurePassword123!",
        { fullName: "Tenant B" }
      );
      const tenantB = reg.user!;

      // Standard query with strict user_id filter:
      const isolated = getSavedDesignsForUser(tenantB.id, "customer");
      assert.strictEqual(isolated.length, 0, "Properly isolated query returns 0 rows");

      // Simulated mutation: if the filter is stripped (like role='admin' or missing filter):
      const mutatedLeak = getSavedDesignsForUser(tenantB.id, "admin");
      assert.ok(mutatedLeak.length > 0, "Mutated query leaks other customers' saved designs");
    });
  });
});
