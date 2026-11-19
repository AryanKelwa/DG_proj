(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import { dataFile } from "../../../lib/data-dir";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "fs";
import {
  sendNotificationEmail,
  safeSendNotificationEmail,
} from "../email-service";
import {
  getCapturedEmails,
  clearCapturedEmails,
  simulateProviderFailure,
} from "../email-provider";
import {
  getEmailLogs,
  resetEmailStore,
  setUniqueConstraintDisabled,
} from "../email-store";
import {
  updateOrderStageWithVersion,
  createOrder,
  getOrderById,
  resetOrderStore,
} from "@/modules/orders/order-store";
import { Order } from "@/types/database";

describe("EMAIL NOTIFICATIONS (PRD § 13 & PHASE E2)", () => {
  beforeEach(() => {
    resetEmailStore();
    clearCapturedEmails();
    simulateProviderFailure(false);
    setUniqueConstraintDisabled(false);
    resetOrderStore();
  });

  describe("1. Event Registry & Accurate Content Rendering", () => {
    it("sends order_confirmed with customer's items, pricing, and address", async () => {
      const payload = {
        to: "sarah@enduroclub.uk",
        recipientName: "Sarah Jenkins",
        event: "order_confirmed" as const,
        orderId: "ord-test-001",
        orderNumber: "W2P-2026-001",
        items: [
          { name: "Pro Matte Vinyl Stickers", quantity: 250, amount: "£85.00" },
        ],
        totalFormatted: "£102.00",
        shippingAddress: {
          name: "Sarah Jenkins",
          line1: "10 Downing Street",
          city: "London",
          postal_code: "SW1A 2AA",
          country: "United Kingdom",
        },
      };

      const result = await sendNotificationEmail(payload);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, "sent");

      const captured = getCapturedEmails();
      assert.strictEqual(captured.length, 1);
      assert.ok(captured[0].subject.includes("W2P-2026-001"));
      assert.ok(captured[0].text.includes("Pro Matte Vinyl Stickers"));
      assert.ok(captured[0].text.includes("SW1A 2AA"));
      assert.ok(captured[0].html.includes("£102.00"));

      // Assert logged in email_log with provider id
      const logs = getEmailLogs({ orderId: "ord-test-001" });
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].status, "sent");
      assert.strictEqual(logs[0].recipient, "sarah@enduroclub.uk");
      assert.ok((logs[0].provider_message_id?.length ?? 0) > 0);
    });

    it("sends proof_ready with revision number and approval gate notice", async () => {
      const payload = {
        to: "sarah@enduroclub.uk",
        recipientName: "Sarah Jenkins",
        event: "proof_ready" as const,
        orderId: "ord-test-002",
        orderNumber: "W2P-2026-002",
        version: 1,
      };

      const result = await sendNotificationEmail(payload);
      assert.strictEqual(result.success, true);

      const captured = getCapturedEmails();
      assert.strictEqual(captured.length, 1);
      assert.ok(captured[0].subject.includes("Revision v1"));
      assert.ok(captured[0].text.includes("APPROVAL GATE ACTIVE") || captured[0].html.includes("APPROVAL GATE ACTIVE"));
      assert.ok(captured[0].text.includes("W2P-2026-002"));
    });

    it("sends change_requested with customer feedback notes", async () => {
      const payload = {
        to: "sarah@enduroclub.uk",
        recipientName: "Sarah Jenkins",
        event: "change_requested" as const,
        orderId: "ord-test-003",
        orderNumber: "W2P-2026-003",
        version: 1,
        feedback: "Please shift the number 42 5mm to the left and darken cyan.",
      };

      const result = await sendNotificationEmail(payload);
      assert.strictEqual(result.success, true);

      const captured = getCapturedEmails();
      assert.strictEqual(captured.length, 1);
      assert.ok(captured[0].subject.includes("Revisions Logged"));
      assert.ok(captured[0].text.includes("shift the number 42"));
      assert.ok(captured[0].html.includes("shift the number 42"));
    });

    it("sends proof_approved with SHA-256 cryptographic hash", async () => {
      const testHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const payload = {
        to: "sarah@enduroclub.uk",
        recipientName: "Sarah Jenkins",
        event: "proof_approved" as const,
        orderId: "ord-test-004",
        orderNumber: "W2P-2026-004",
        version: 2,
        proofHash: testHash,
      };

      const result = await sendNotificationEmail(payload);
      assert.strictEqual(result.success, true);

      const captured = getCapturedEmails();
      assert.strictEqual(captured.length, 1);
      assert.ok(captured[0].subject.includes("Proof Approved"));
      assert.ok(captured[0].text.includes(testHash));
      assert.ok(captured[0].text.includes("PRODUCTION ASSETS UNLOCKED") || captured[0].html.includes("PRODUCTION ASSETS UNLOCKED"));
    });

    it("sends pipeline_status_changed on intermediate production transitions", async () => {
      const payload = {
        to: "sarah@enduroclub.uk",
        recipientName: "Sarah Jenkins",
        event: "pipeline_status_changed" as const,
        orderId: "ord-test-005",
        orderNumber: "W2P-2026-005",
        stage: "PRODUCTION",
      };

      const result = await sendNotificationEmail(payload);
      assert.strictEqual(result.success, true);

      const captured = getCapturedEmails();
      assert.strictEqual(captured.length, 1);
      assert.ok(captured[0].subject.includes("is now in PRODUCTION"));
      assert.ok(captured[0].html.includes("PRODUCTION"));
    });

    it("sends order_completed when manufacturing and dispatch complete", async () => {
      const payload = {
        to: "sarah@enduroclub.uk",
        recipientName: "Sarah Jenkins",
        event: "order_completed" as const,
        orderId: "ord-test-006",
        orderNumber: "W2P-2026-006",
        shippingAddress: {
          name: "Sarah Jenkins",
          line1: "10 Downing Street",
          city: "London",
          postal_code: "SW1A 2AA",
          country: "United Kingdom",
        },
      };

      const result = await sendNotificationEmail(payload);
      assert.strictEqual(result.success, true);

      const captured = getCapturedEmails();
      assert.strictEqual(captured.length, 1);
      assert.ok(captured[0].subject.includes("Order Completed & Dispatched"));
      assert.ok(captured[0].text.includes("SW1A 2AA"));
    });
  });

  describe("2. Idempotency & Webhook Replay Deduplication", () => {
    it("replays the webhook twice and sends exactly one email to the customer", async () => {
      const webhookPayload = {
        to: "customer@enduroclub.uk",
        recipientName: "Customer A",
        event: "order_confirmed" as const,
        orderId: "ord-replay-101",
        orderNumber: "W2P-2026-REPLAY-101",
        totalFormatted: "£65.00",
      };

      // First webhook delivery
      const firstResult = await sendNotificationEmail(webhookPayload);
      assert.strictEqual(firstResult.success, true);
      assert.strictEqual(firstResult.status, "sent");

      // Verify mailbox has 1 email
      let captured = getCapturedEmails();
      assert.strictEqual(captured.length, 1);

      // Replay identical webhook event (e.g. Stripe network retry)
      const secondResult = await sendNotificationEmail(webhookPayload);
      assert.strictEqual(secondResult.success, true);
      assert.strictEqual(secondResult.status, "skipped_duplicate");

      // Verify mailbox STILL has exactly 1 email (zero duplicate sent to user)
      captured = getCapturedEmails();
      assert.strictEqual(captured.length, 1);

      // Check email_log audit table
      const logs = getEmailLogs({ orderId: "ord-replay-101" });
      assert.strictEqual(logs.length, 2);
      assert.strictEqual(logs[0].status, "sent");
      assert.strictEqual(logs[1].status, "skipped_duplicate");
    });
  });

  describe("3. Resilience & Fault Tolerance (Provider Outage & Bounced Mailbox)", () => {
    it("handles bounced@resend.dev and forced provider failure: logs error and does NOT block order progression", async () => {
      // Create a live test order in the order store
      const testOrder: Order = {
        id: "ord-resilience-001",
        order_number: "W2P-2026-RESIL-01",
        customer_id: "usr-cust-1",
        customer_email: "bounced@resend.dev",
        customer_name: "Sarah Jenkins",
        pipeline_stage: "ORDER",
        payment_status: "paid",
        subtotal_cents: 5000,
        tax_cents: 1000,
        total_cents: 6000,
        currency: "GBP",
        proof_status: "approved",
        shipping_address: {
          name: "Sarah Jenkins",
          line1: "10 Downing Street",
          city: "London",
          postal_code: "SW1A 2AA",
          country: "United Kingdom",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      createOrder(testOrder);

      // 1. Test Resend's bounced@resend.dev simulation
      const bounceResult = await safeSendNotificationEmail({
        to: "bounced@resend.dev",
        event: "order_confirmed",
        orderId: testOrder.id,
        orderNumber: testOrder.order_number,
      });

      assert.strictEqual(bounceResult.success, false);
      assert.strictEqual(bounceResult.status, "failed");
      assert.ok(bounceResult.error?.includes("bounced@resend.dev"));

      // Verify bounce failure recorded in email_log
      const bounceLogs = getEmailLogs({ orderId: testOrder.id });
      assert.strictEqual(bounceLogs.length, 1);
      assert.strictEqual(bounceLogs[0].status, "failed");

      // 2. Test Forced Provider Outage (HTTP 503 Service Unavailable)
      simulateProviderFailure(true, "Resend API connection timed out (HTTP 503)");

      const failResult = await safeSendNotificationEmail({
        to: "sarah@enduroclub.uk",
        event: "pipeline_status_changed",
        orderId: testOrder.id,
        orderNumber: testOrder.order_number,
        stage: "ARTWORK",
      });

      assert.strictEqual(failResult.success, false);
      assert.strictEqual(failResult.status, "failed");

      // 3. Business Process Test: Update order stage during email outage
      const stageUpdateResult = updateOrderStageWithVersion(
        testOrder.order_number,
        "ARTWORK",
        "ORDER",
        "admin@w2p.co.in",
        "Advancing to pre-press while email provider is down"
      );

      // Order update MUST succeed despite email provider failure (PRD § 13)
      assert.strictEqual(stageUpdateResult.success, true);
      assert.strictEqual(stageUpdateResult.order?.pipeline_stage, "ARTWORK");

      // Verify database reflects new stage
      const updatedOrder = getOrderById(testOrder.order_number);
      assert.strictEqual(updatedOrder?.pipeline_stage, "ARTWORK");
    });
  });

  describe("4. Tenant Privacy & Customer Isolation", () => {
    it("ensures Customer B never receives Customer A's order notifications or data", async () => {
      const payloadA = {
        to: "sarah@enduroclub.uk",
        recipientName: "Sarah Jenkins",
        event: "order_confirmed" as const,
        orderId: "ord-cust-a-01",
        orderNumber: "W2P-2026-SARAH-01",
        totalFormatted: "£150.00",
        items: [{ name: "Motocross Number Plates", quantity: 50, amount: "£150.00" }],
      };

      const payloadB = {
        to: "customerb@scotlandracing.co.uk",
        recipientName: "Customer B",
        event: "order_confirmed" as const,
        orderId: "ord-cust-b-02",
        orderNumber: "W2P-2026-CUSTB-02",
        totalFormatted: "£42.00",
        items: [{ name: "Event Decals", quantity: 10, amount: "£42.00" }],
      };

      await sendNotificationEmail(payloadA);
      await sendNotificationEmail(payloadB);

      const captured = getCapturedEmails();
      assert.strictEqual(captured.length, 2);

      // Inspect email intended for Customer A
      const emailsForA = captured.filter((e) => (e.originalTo || e.to) === "sarah@enduroclub.uk");
      assert.strictEqual(emailsForA.length, 1);
      assert.ok(emailsForA[0].subject.includes("W2P-2026-SARAH-01"));
      assert.ok(emailsForA[0].text.includes("Motocross Number Plates"));
      assert.ok(!emailsForA[0].text.includes("Customer B"));
      assert.ok(!emailsForA[0].text.includes("W2P-2026-CUSTB-02"));

      // Inspect email intended for Customer B
      const emailsForB = captured.filter((e) => (e.originalTo || e.to) === "customerb@scotlandracing.co.uk");
      assert.strictEqual(emailsForB.length, 1);
      assert.ok(emailsForB[0].subject.includes("W2P-2026-CUSTB-02"));
      assert.ok(emailsForB[0].text.includes("Event Decals"));
      assert.ok(!emailsForB[0].text.includes("Sarah Jenkins"));
      assert.ok(!emailsForB[0].text.includes("W2P-2026-SARAH-01"));

      // Check log store isolation
      const logsA = getEmailLogs({ recipient: "sarah@enduroclub.uk" });
      const logsB = getEmailLogs({ recipient: "customerb@scotlandracing.co.uk" });

      assert.strictEqual(logsA.length, 1);
      assert.strictEqual(logsB.length, 1);
      assert.strictEqual(logsA[0].order_id, "ord-cust-a-01");
      assert.strictEqual(logsB[0].order_id, "ord-cust-b-02");
    });
  });

  describe("5. Data Persistence Across Restart & Serverless Instances", () => {
    it("ensures order and email_log rows persist and survive in-memory purge / restart", async () => {
      // 1. Create order and send notification
      const testOrder: Order = {
        id: "ord-persist-999",
        order_number: "W2P-2026-PERSIST-999",
        customer_id: "usr-cust-999",
        customer_email: "sarah@enduroclub.uk",
        customer_name: "Sarah Jenkins",
        pipeline_stage: "ORDER",
        payment_status: "paid",
        subtotal_cents: 8000,
        tax_cents: 1600,
        total_cents: 9600,
        currency: "GBP",
        shipping_address: {
          name: "Sarah Jenkins",
          line1: "10 Downing Street",
          city: "London",
          postal_code: "SW1A 2AA",
          country: "United Kingdom",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      createOrder(testOrder);

      const emailResult = await sendNotificationEmail({
        to: "sarah@enduroclub.uk",
        recipientName: "Sarah Jenkins",
        event: "order_confirmed",
        orderId: testOrder.id,
        orderNumber: testOrder.order_number,
        totalFormatted: "£96.00",
      });
      assert.strictEqual(emailResult.success, true);

      // 2. Simulate server restart: read fresh from persisted disk files
      const orderFile = dataFile(".orders-store.json");
      const emailFile = dataFile(".email-logs-store.json");

      assert.ok(fs.existsSync(orderFile), ".orders-store.json must exist");
      assert.ok(fs.existsSync(emailFile), ".email-logs-store.json must exist");

      const orderData = JSON.parse(fs.readFileSync(orderFile, "utf-8"));
      const emailData = JSON.parse(fs.readFileSync(emailFile, "utf-8"));

      // Verify order survived restart
      assert.ok(orderData.orders["W2P-2026-PERSIST-999"]);
      assert.strictEqual(orderData.orders["W2P-2026-PERSIST-999"].total_cents, 9600);

      // Verify email_log survived restart
      const foundLog = emailData.logs.find(
        (l: any) => l.order_id === "ord-persist-999" && l.event === "order_confirmed"
      );
      assert.ok(foundLog, "Email log record must persist across restarts");
      assert.strictEqual(foundLog.status, "sent");
    });
  });

  describe("6. Sandbox Redirection & Missing Key Handling", () => {
    it("redirects to EMAIL_SANDBOX_RECIPIENT when EMAIL_FROM is onboarding@resend.dev", async () => {
      process.env.EMAIL_FROM = "onboarding@resend.dev";
      process.env.EMAIL_SANDBOX_RECIPIENT = "mohitsingh22.ai@gmail.com";

      const payload = {
        to: "any-customer@random-domain.com",
        recipientName: "Customer X",
        event: "order_confirmed" as const,
        orderId: "ord-sandbox-01",
        orderNumber: "W2P-2026-SB-01",
      };

      const result = await sendNotificationEmail(payload);
      assert.strictEqual(result.success, true);

      const captured = getCapturedEmails();
      const last = captured[captured.length - 1];
      assert.strictEqual(last.to, "mohitsingh22.ai@gmail.com");
      assert.strictEqual(last.originalTo, "any-customer@random-domain.com");
      assert.ok(last.subject.startsWith("[Sandbox to: any-customer@random-domain.com]"));

      // Verify email_log records original intended recipient
      const logs = getEmailLogs({ orderId: "ord-sandbox-01" });
      assert.strictEqual(logs[0].recipient, "any-customer@random-domain.com");
      assert.strictEqual(logs[0].metadata?.is_sandbox_redirect, true);
    });

    it("records as failed and never sent when API key is missing in production mode", async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origApiKey = process.env.RESEND_API_KEY;
      const origProvider = process.env.EMAIL_PROVIDER;

      try {
        (process.env as Record<string, string | undefined>).NODE_ENV = "production";
        process.env.EMAIL_PROVIDER = "resend";
        delete process.env.RESEND_API_KEY;

        const result = await safeSendNotificationEmail({
          to: "sarah@enduroclub.uk",
          event: "order_confirmed",
          orderId: "ord-missing-key-01",
          orderNumber: "W2P-2026-NOKEY-01",
        });

        // Must be marked failed, NEVER sent
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.status, "failed");
        assert.ok(result.error?.includes("RESEND_API_KEY"));

        const logs = getEmailLogs({ orderId: "ord-missing-key-01" });
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(logs[0].status, "failed");
      } finally {
        (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
        if (origApiKey) process.env.RESEND_API_KEY = origApiKey;
        if (origProvider) process.env.EMAIL_PROVIDER = origProvider;
      }
    });
  });

  describe("7. Mutation Check: Disabling Unique Constraint Causes Replay Failure", () => {
    it("confirms replay test fails when unique constraint is removed, and passes when restored", async () => {
      const webhookPayload = {
        to: "sarah@enduroclub.uk",
        event: "order_confirmed" as const,
        orderId: "ord-mutation-replay",
        orderNumber: "W2P-2026-MUTATION-01",
      };

      // 1. With UNIQUE constraint active: first sends, second skips
      const res1 = await sendNotificationEmail(webhookPayload);
      assert.strictEqual(res1.status, "sent");

      const res2 = await sendNotificationEmail(webhookPayload);
      assert.strictEqual(res2.status, "skipped_duplicate");

      // Captured mail count is 1
      assert.strictEqual(getCapturedEmails().length, 1);

      // 2. MUTATION: Disable UNIQUE constraint / dedup check
      setUniqueConstraintDisabled(true);

      // Replay again with mutation: dedup fails to catch it, sending a duplicate
      const resMutated = await sendNotificationEmail(webhookPayload);
      assert.strictEqual(resMutated.status, "sent"); // Mutation allowed duplicate send!
      assert.strictEqual(getCapturedEmails().length, 2); // Proves duplicate occurred!

      // 3. RESTORE UNIQUE constraint
      setUniqueConstraintDisabled(false);
      const resRestored = await sendNotificationEmail(webhookPayload);
      assert.strictEqual(resRestored.status, "skipped_duplicate");
      assert.strictEqual(getCapturedEmails().length, 2); // No 3rd email sent!
    });
  });
});
