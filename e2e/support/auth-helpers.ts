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
    email: "alex@gravelhub.co.uk",
    password: "customer123",
    name: "Alex Thorne",
    role: "customer",
    company: "Gravel Hub UK",
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
    await page.waitForURL("**/login", { timeout: 10000 });
  }
}
