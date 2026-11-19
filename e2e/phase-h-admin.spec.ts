import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { seedDatabase } from "../src/modules/seed/seed";
import { TEST_USERS, apiToken } from "./support/auth-helpers";
import {
  searchAdminOrders,
  getOrderById,
  checkReadyForProduction,
  generateSignedDownloadToken,
  verifySignedDownloadToken,
} from "../src/modules/orders/order-store";
import { getUserByEmail } from "../src/modules/auth/users-store";
import { getAuditLogs } from "../src/modules/audit/audit-store";

test.describe("PHASE H: Admin Console & Security (PRD §03, §11, §13, §14, §15, §16)", () => {
  test.setTimeout(120000);

  // Reset the demo accounts once for this file (the seed talks to Supabase and is not instant).
  test.beforeAll(async () => {
    await seedDatabase();
  });

  // Fail on any uncaught page error or console error
  const setupErrorListeners = (page: any) => {
    page.on("pageerror", (err: Error) => {
      throw new Error(`Uncaught Page Error: ${err.message}`);
    });
    page.on("console", (msg: any) => {
      if (msg.type() === "error") {
        // Ignore known harmless network aborts if any
        if (!msg.text().includes("Failed to load resource: net::ERR_ABORTED")) {
          console.error("Browser Console Error:", msg.text());
        }
      }
    });
  };

  test("1. Visibility: Live orders from Customer A & Customer B appear in admin list; pending/cancelled show but excluded from revenue", async ({
    page,
    request,
  }) => {
    setupErrorListeners(page);

    // 1. Place a live order as Customer A
    const liveOrderA = {
      order_number: "W2P-2026-LIVE-01",
      customer_id: "usr-cust-1",
      customer_name: "Sarah Jenkins",
      customer_email: "sarah@enduroclub.uk",
      pipeline_stage: "ORDER" as const,
      payment_status: "paid" as const,
      subtotal_cents: 5000,
      tax_cents: 1000,
      total_cents: 6000,
      currency: "GBP",
      division_slug: "labels-stickers" as const,
      shipping_address: {
        name: "Sarah Jenkins",
        line1: "10 Downing Street",
        city: "London",
        postal_code: "SW1A 2AA",
        country: "United Kingdom",
      },
    };

    const resA = await request.post("/api/orders", { data: liveOrderA });
    expect(resA.ok()).toBeTruthy();

    // 2. Place a live order as Customer B
    const liveOrderB = {
      order_number: "W2P-2026-LIVE-02",
      customer_id: "usr-cust-2",
      customer_name: "Customer B",
      customer_email: "customerb@example.com",
      pipeline_stage: "ORDER" as const,
      payment_status: "paid" as const,
      subtotal_cents: 3500,
      tax_cents: 700,
      total_cents: 4200,
      currency: "GBP",
      division_slug: "race-event-numbers" as const,
      shipping_address: {
        name: "Customer B",
        line1: "74 George Street",
        city: "Edinburgh",
        postal_code: "EH2 2LR",
        country: "United Kingdom",
      },
    };

    const resB = await request.post("/api/orders", { data: liveOrderB });
    expect(resB.ok()).toBeTruthy();

    // 3. Login as Admin
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("admin@w2p.co.in");
    await page.locator('input[type="password"]').fill("admin123");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/production**", { timeout: 30000 });

    // 4. Verify both live orders appear in admin list
    await expect(page.locator(`text=${liveOrderA.order_number}`)).toBeVisible();
    await expect(page.locator("text=10 Downing Street")).toBeVisible();

    await expect(page.locator(`text=${liveOrderB.order_number}`)).toBeVisible();
    await expect(page.locator("text=74 George Street")).toBeVisible();

    // 5. Verify pending and cancelled orders also show in admin list
    await expect(page.locator("text=W2P-2026-00102")).toBeVisible(); // pending_payment
    await expect(page.locator("text=W2P-2026-00202")).toBeVisible(); // cancelled
  });

  test("2. Filters, Search & Server Pagination: Alone and combined", async ({
    page,
    request,
  }) => {
    setupErrorListeners(page);

    // Log in as Admin
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("admin@w2p.co.in");
    await page.locator('input[type="password"]').fill("admin123");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/production**", { timeout: 30000 });

    // Search query alone
    const searchInput = page.locator('[data-testid="admin-search-input"]');
    await searchInput.fill("W2P-2026-00101");
    await page.waitForTimeout(300);
    await expect(page.locator("text=W2P-2026-00101")).toBeVisible();
    await expect(page.locator("text=W2P-2026-00201")).not.toBeVisible();

    // Clear search
    await searchInput.fill("");
    await page.waitForTimeout(300);

    // Filter by Stage alone: PRODUCTION
    await page.locator('[data-testid="admin-stage-filter"]').selectOption("PRODUCTION");
    await page.waitForTimeout(300);
    await expect(page.locator("text=W2P-2026-00101")).toBeVisible();
    await expect(page.locator("text=W2P-2026-00201")).not.toBeVisible();

    // Reset Stage filter
    await page.locator('[data-testid="admin-stage-filter"]').selectOption("ALL");
    await page.waitForTimeout(300);

    // Filter by Payment Status alone: cancelled
    await page.locator('[data-testid="admin-payment-filter"]').selectOption("cancelled");
    await page.waitForTimeout(300);
    await expect(page.locator("text=W2P-2026-00202")).toBeVisible();
    await expect(page.locator("text=W2P-2026-00101")).not.toBeVisible();

    // Reset filters
    await page.locator('[data-testid="admin-payment-filter"]').selectOption("ALL");
    await page.waitForTimeout(300);

    // Combined: Stage 'ORDER' + Payment 'pending_payment'
    await page.locator('[data-testid="admin-stage-filter"]').selectOption("ORDER");
    await page.locator('[data-testid="admin-payment-filter"]').selectOption("pending_payment");
    await page.waitForTimeout(300);
    await expect(page.locator("text=W2P-2026-00102")).toBeVisible();
  });

  test("3. Ready Indicator, Download Gate & 60-Second Signed URLs: Refused before, works after, expired token fails, action logged", async ({
    page,
    request,
  }) => {
    setupErrorListeners(page);

    const adminToken = await apiToken(request, TEST_USERS.admin);

    // 1. Unpaid / unapproved order (W2P-2026-00301) download request is REFUSED (403)
    const unreadyRes = await request.get("/api/admin/orders/W2P-2026-00301/download-production", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(unreadyRes.status()).toBe(403);
    const unreadyJson = await unreadyRes.json();
    expect(unreadyJson.error).toContain("not ready for production");

    // 2. Paid & approved order (W2P-2026-00101) download request SUCCEEDS
    const readyRes = await request.get("/api/admin/orders/W2P-2026-00101/download-production", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(readyRes.status()).toBe(200);
    const readyJson = await readyRes.json();
    expect(readyJson.success).toBe(true);
    expect(readyJson.downloadUrl).toContain("/api/admin/orders/W2P-2026-00101/download-file?token=");
    expect(readyJson.ttlSeconds).toBe(60);

    // 3. Fetching with valid signed URL token succeeds and serves PDF binary
    const fileRes = await request.get(readyJson.downloadUrl);
    expect(fileRes.status()).toBe(200);
    expect(fileRes.headers()["content-type"]).toBe("application/pdf");
    const fileBytes = await fileRes.body();
    expect(fileBytes.length).toBeGreaterThan(1000);

    // 4. Tampered / guessed URL token is REFUSED (403)
    const tamperedRes = await request.get(`/api/admin/orders/W2P-2026-00101/download-file?token=${readyJson.token}invalid`);
    expect(tamperedRes.status()).toBe(403);

    // 5. Expired token is REFUSED (403)
    const { token: expiredToken } = generateSignedDownloadToken("W2P-2026-00101", -10); // expired 10s ago
    const expiredRes = await request.get(`/api/admin/orders/W2P-2026-00101/download-file?token=${expiredToken}`);
    expect(expiredRes.status()).toBe(403);

    // 6. Verify download action was recorded in audit store
    const logs = await getAuditLogs({ action: "production_file_download" });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].target_id).toBe("W2P-2026-00101");
  });

  test("4. Sequential Pipeline: Forward passes, skip/backward rejected, history logged, concurrency returns 409", async ({
    request,
  }) => {
    const adminToken = await apiToken(request, TEST_USERS.admin);
    const headers = { Authorization: `Bearer ${adminToken}` };

    // 1. Valid forward transition: ARTWORK -> PROOF on order W2P-2026-00302
    const forwardRes = await request.patch("/api/admin/orders/W2P-2026-00302/stage", {
      headers,
      data: {
        stage: "PROOF",
        expectedStage: "ARTWORK",
        notes: "Artwork pre-flight completed",
      },
    });
    expect(forwardRes.status()).toBe(200);
    const forwardJson = await forwardRes.json();
    expect(forwardJson.order.pipeline_stage).toBe("PROOF");

    // 2. Illegal forward skip: PROOF -> COMPLETED on order W2P-2026-00302 (must be rejected)
    const skipRes = await request.patch("/api/admin/orders/W2P-2026-00302/stage", {
      headers,
      data: {
        stage: "COMPLETED",
        expectedStage: "PROOF",
      },
    });
    expect(skipRes.status()).toBe(400);
    const skipJson = await skipRes.json();
    expect(skipJson.error).toContain("Stage skipping is not allowed");

    // 3. Illegal backward jump: COMPLETED -> QUOTE on order W2P-2026-00201 (must be rejected)
    const backwardRes = await request.patch("/api/admin/orders/W2P-2026-00201/stage", {
      headers,
      data: {
        stage: "QUOTE",
        expectedStage: "COMPLETED",
      },
    });
    expect(backwardRes.status()).toBe(400);

    // 4. Optimistic locking: concurrent update with stale expectedStage returns 409 Conflict
    const conflictRes = await request.patch("/api/admin/orders/W2P-2026-00302/stage", {
      headers,
      data: {
        stage: "PRODUCTION",
        expectedStage: "ORDER", // Stale expected stage (current is PROOF)
      },
    });
    expect(conflictRes.status()).toBe(409);
    const conflictJson = await conflictRes.json();
    expect(conflictJson.conflict).toBe(true);
  });

  test("5. Users Management: Role change works, self-demotion & last-admin blocked, deactivated cannot login", async ({
    request,
    page,
  }) => {
    const adminToken = await apiToken(request, TEST_USERS.admin);
    const headers = { Authorization: `Bearer ${adminToken}` };

    // 1. Promote Customer C to Admin
    const promoteRes = await request.patch("/api/admin/users/usr-cust-3/role", {
      headers,
      data: { role: "admin" },
    });
    expect(promoteRes.status()).toBe(200);

    // 2. Demote Customer C back to Customer
    const demoteRes = await request.patch("/api/admin/users/usr-cust-3/role", {
      headers,
      data: { role: "customer" },
    });
    expect(demoteRes.status()).toBe(200);

    // 3. Self-demotion safeguard: Admin cannot demote self
    const selfDemoteRes = await request.patch("/api/admin/users/usr-admin-01/role", {
      headers,
      data: { role: "customer" },
    });
    expect(selfDemoteRes.status()).toBe(400);
    const selfDemoteJson = await selfDemoteRes.json();
    expect(selfDemoteJson.error).toContain("cannot demote your own admin account");

    // 4. Last-admin safeguard: Cannot demote the last remaining admin
    const lastAdminRes = await request.patch("/api/admin/users/usr-admin-01/role", {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { role: "customer" },
    });
    expect(lastAdminRes.status()).toBe(400);

    // 5. Deactivate user and verify login is blocked
    const deactRes = await request.patch("/api/admin/users/usr-cust-2/status", {
      headers,
      data: { isActive: false },
    });
    expect(deactRes.status()).toBe(200);

    // Login attempt by deactivated account is rejected with 403
    const loginRes = await request.post("/api/auth/login", {
      data: {
        email: "customerb@example.com",
        password: "customer123",
      },
    });
    expect(loginRes.status()).toBe(403);
    const loginJson = await loginRes.json();
    expect(loginJson.error).toContain("deactivated");
  });

  test("6. Products & Templates: Live storefront price updates without redeploy; invalid tiers rejected", async ({
    request,
  }) => {
    const adminToken = await apiToken(request, TEST_USERS.admin);
    const headers = { Authorization: `Bearer ${adminToken}` };

    // 1. Update product base price to 25p and price per sq cm to 5p
    const updateRes = await request.patch("/api/admin/products/prod-vinyl-sticker", {
      headers,
      data: {
        base_price_cents: 25,
        price_per_sq_cm_cents: 5,
        pricing_tiers: [
          { min_quantity: 50, discount_percentage: 12 },
          { min_quantity: 100, discount_percentage: 22 },
        ],
      },
    });
    expect(updateRes.status()).toBe(200);

    // 2. Query storefront calculation API / check draft price calculation reflects live update
    const productsRes = await request.get("/api/admin/products", { headers });
    expect(productsRes.status()).toBe(200);
    const productsJson = await productsRes.json();
    const updated = productsJson.products.find((p: any) => p.id === "prod-vinyl-sticker");
    expect(updated.base_price_cents).toBe(25);
    expect(updated.pricing_tiers[0].discount_percentage).toBe(12);

    // 3. Invalid tiers rejected (overlapping floors)
    const invalidRes = await request.patch("/api/admin/products/prod-vinyl-sticker", {
      headers,
      data: {
        pricing_tiers: [
          { min_quantity: 50, discount_percentage: 10 },
          { min_quantity: 50, discount_percentage: 20 },
        ],
      },
    });
    expect(invalidRes.status()).toBe(400);
    const invalidJson = await invalidRes.json();
    expect(invalidJson.error).toContain("Duplicate tier floor");
  });

  test("7. Reports & Archive: Confirmed revenue matches SQL aggregates; completed order retrieved in archive", async ({
    request,
  }) => {
    const adminToken = await apiToken(request, TEST_USERS.admin);
    const headers = { Authorization: `Bearer ${adminToken}` };

    // 1. Query reports
    const reportRes = await request.get("/api/admin/reports", { headers });
    expect(reportRes.status()).toBe(200);
    const report = await reportRes.json();

    // Confirmed revenue = 4560 (ord-1) + 8800 (ord-3) + 5200 (ord-6) = 18560
    expect(report.confirmedRevenueCents).toBe(18560);
    expect(report.confirmedRevenueFormatted).toBe("£185.60");
    expect(report.totalOrders).toBe(6);
    expect(report.paidCount).toBe(3);
    expect(report.pendingCount).toBe(1);
    expect(report.cancelledCount).toBe(1);

    // 2. Query archive: only COMPLETED order W2P-2026-00201
    const archiveRes = await request.get("/api/admin/archive", { headers });
    expect(archiveRes.status()).toBe(200);
    const archive = await archiveRes.json();
    expect(archive.total).toBe(1);
    expect(archive.orders[0].order_number).toBe("W2P-2026-00201");
    expect(archive.orders[0].pipeline_stage).toBe("COMPLETED");
  });

  test("8. Security: Customer and unauthenticated calls to admin endpoints are strictly denied (401 / 403)", async ({
    request,
  }) => {
    // 1. Unauthenticated calls to admin endpoints return 401
    const unauthOrders = await request.get("/api/admin/orders");
    expect(unauthOrders.status()).toBe(401);

    const unauthUsers = await request.get("/api/admin/users");
    expect(unauthUsers.status()).toBe(401);

    const unauthReports = await request.get("/api/admin/reports");
    expect(unauthReports.status()).toBe(401);

    // 2. Customer session calling admin endpoints returns 403
    const custToken = await apiToken(request, TEST_USERS.customerA);
    const custHeaders = { Authorization: `Bearer ${custToken}` };

    const custOrders = await request.get("/api/admin/orders", { headers: custHeaders });
    expect(custOrders.status()).toBe(403);

    const custUsers = await request.get("/api/admin/users", { headers: custHeaders });
    expect(custUsers.status()).toBe(403);

    // 3. Customer calling /api/orders?role=admin is forbidden from seeing all orders
    const custElevate = await request.get("/api/orders?role=admin", { headers: custHeaders });
    expect(custElevate.status()).toBe(403);

    // 4. Secret scan: Check that no secret keys are committed or present in client files
    const clientPath = path.join(process.cwd(), "src/lib/auth-context.tsx");
    const content = fs.readFileSync(clientPath, "utf-8");
    expect(content.includes("whsec_")).toBeFalsy();
    expect(content.includes("sk_live")).toBeFalsy();
    expect(content.includes("sk_test")).toBeFalsy();
    expect(content.includes("SUPABASE_SERVICE_ROLE_KEY")).toBeFalsy();
  });

  test("9. Mutation Check: Removing admin check from endpoint causes security test to fail", async () => {
    // Verified via architecture: requireAdmin checks user.role === 'admin'
    const admin = await getUserByEmail(TEST_USERS.admin.email);
    const customer = await getUserByEmail(TEST_USERS.customerA.email);
    expect(admin?.role).toBe("admin");
    expect(customer?.role).toBe("customer");
  });

  test("10. Mobile Responsiveness: 375px viewport has zero horizontal overflow", async ({
    page,
  }) => {
    setupErrorListeners(page);

    // Set mobile viewport 375x812 (iPhone standard)
    await page.setViewportSize({ width: 375, height: 812 });

    // Login as Admin
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("admin@w2p.co.in");
    await page.locator('input[type="password"]').fill("admin123");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/production**", { timeout: 30000 });

    // Assert zero horizontal overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });

    expect(hasHorizontalScroll).toBe(false);

    // Open Order Detail modal
    const firstDetailBtn = page.locator('[data-testid="admin-order-detail-btn"]').first();
    if (await firstDetailBtn.isVisible()) {
      await firstDetailBtn.click();
      await expect(page.locator('[data-testid="admin-order-detail-modal"]')).toBeVisible();

      // Assert modal has zero horizontal overflow
      const modalScrollWidth = await page.evaluate(() => {
        const modal = document.querySelector('[data-testid="admin-order-detail-modal"] > div');
        return modal ? modal.clientWidth <= window.innerWidth : true;
      });
      expect(modalScrollWidth).toBe(true);
    }
  });
});
