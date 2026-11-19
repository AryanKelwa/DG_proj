import { Page, expect } from "@playwright/test";

export const TEST_USERS = {
  customerA: {
    email: "sarah@enduroclub.uk",
    password: "customer123",
    name: "Sarah Jenkins",
    role: "customer",
    company: "Grizedale Enduro Racing",
  },
  customerB: {
    email: "customerb@example.com",
    password: "customer123",
    name: "Customer B",
    role: "customer",
    company: "Apex Biking Co",
  },
  admin: {
    email: "admin@w2p.co.in",
    password: "admin123",
    name: "Marcus Vance",
    role: "admin",
    company: "W2P Ltd",
  },
};

/**
 * Performs real UI login through the login page (/login)
 */
export async function loginViaUi(
  page: Page,
  credentials: { email: string; password: string },
  expectedDestination?: string
) {
  await page.goto("/login");
  await page.waitForLoadState("domcontentloaded");

  // Fill credentials
  await page.fill('input[type="email"]', credentials.email);
  await page.fill('input[type="password"]', credentials.password);

  // Click Submit
  await page.click('button[type="submit"]');

  if (expectedDestination) {
    await page.waitForURL(`**${expectedDestination}`, { timeout: 10000 });
  }
}

/**
 * Performs UI logout
 */
export async function logoutViaUi(page: Page) {
  const signOutButton = page.locator('button:has-text("Sign Out")').first();
  if (await signOutButton.isVisible()) {
    await signOutButton.click();
    // Logout may land on /login?redirect=..., so match the path with or without a query string.
    await page.waitForURL(/\/login(\?|$)/, { timeout: 10000 });
  }
}

/**
 * Signs in through the API and returns the Supabase access token for
 * `Authorization: Bearer` requests.
 */
export async function apiToken(
  request: import("@playwright/test").APIRequestContext,
  credentials: { email: string; password: string }
): Promise<string> {
  const res = await request.post("/api/auth/login", { data: credentials });
  if (res.status() !== 200) {
    throw new Error(`API login failed for ${credentials.email}: HTTP ${res.status()}`);
  }
  return (await res.json()).token as string;
}
