import { dataFile } from "@/lib/data-dir";
import fs from "fs";
import crypto from "crypto";
import { EmailLogRecord } from "./types";

const EMAIL_STORE_FILE = dataFile(".email-logs-store.json");

interface EmailStoreData {
  logs: EmailLogRecord[];
}

let inMemoryStore: EmailStoreData = { logs: [] };
let lastLoadedMtime = 0;
let uniqueConstraintDisabled = false; // Mutation test toggle

function loadStore() {
  try {
    if (fs.existsSync(EMAIL_STORE_FILE)) {
      const stat = fs.statSync(EMAIL_STORE_FILE);
      if (stat.mtimeMs > lastLoadedMtime || inMemoryStore.logs.length === 0) {
        const raw = fs.readFileSync(EMAIL_STORE_FILE, "utf-8");
        inMemoryStore = JSON.parse(raw);
        lastLoadedMtime = stat.mtimeMs;
      }
    }
  } catch (err) {
    console.error("Failed to load email logs store from disk:", err);
  }
}

function persistStore() {
  try {
    fs.writeFileSync(EMAIL_STORE_FILE, JSON.stringify(inMemoryStore, null, 2), "utf-8");
    if (fs.existsSync(EMAIL_STORE_FILE)) {
      lastLoadedMtime = fs.statSync(EMAIL_STORE_FILE).mtimeMs;
    }
  } catch (err) {
    console.error("Failed to persist email logs store:", err);
  }
}

/**
 * Mutation testing flag: temporarily disables unique constraint check
 * to prove that replaying without unique constraint causes duplicate deliveries.
 */
export function setUniqueConstraintDisabled(disabled: boolean): void {
  uniqueConstraintDisabled = disabled;
}

export function isUniqueConstraintDisabled(): boolean {
  return uniqueConstraintDisabled;
}

/**
 * Checks whether an email with this idempotency key has already been successfully dispatched.
 * Exact-once guarantee backed by DB unique constraint (PRD § 13).
 */
export function hasSuccessfulSend(idempotencyKey: string): boolean {
  if (uniqueConstraintDisabled) {
    return false;
  }
  loadStore();
  return inMemoryStore.logs.some(
    (log) => log.idempotency_key === idempotencyKey && log.status === "sent"
  );
}

/**
 * Records an email dispatch attempt into the email_log table.
 * Strictly enforces UNIQUE (idempotency_key) constraint unless mutation toggle is active.
 */
export function recordEmailLog(
  entry: Omit<EmailLogRecord, "id" | "created_at">
): EmailLogRecord {
  loadStore();

  // Enforce DB UNIQUE(idempotency_key) constraint on successfully sent records
  if (!uniqueConstraintDisabled && entry.status === "sent") {
    const existingSent = inMemoryStore.logs.find(
      (l) => l.idempotency_key === entry.idempotency_key && l.status === "sent"
    );
    if (existingSent) {
      throw new Error(
        `UNIQUE constraint failed: email_log.idempotency_key (${entry.idempotency_key})`
      );
    }
  }

  const record: EmailLogRecord = {
    id: `eml-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    ...entry,
    created_at: new Date().toISOString(),
  };

  inMemoryStore.logs.push(record);
  persistStore();
  return record;
}

/**
 * Retrieves email logs filtered by orderId, recipient, or event.
 */
export function getEmailLogs(options?: {
  orderId?: string;
  recipient?: string;
  event?: string;
}): EmailLogRecord[] {
  loadStore();
  let list = [...inMemoryStore.logs];

  if (options?.orderId) {
    list = list.filter((l) => l.order_id === options.orderId);
  }
  if (options?.recipient) {
    const r = options.recipient.toLowerCase().trim();
    list = list.filter((l) => l.recipient.toLowerCase().trim() === r);
  }
  if (options?.event) {
    list = list.filter((l) => l.event === options.event);
  }

  return list;
}

/**
 * Clears email logs store (for test suite cleanup).
 */
export function resetEmailStore(): void {
  inMemoryStore = { logs: [] };
  uniqueConstraintDisabled = false;
  try {
    if (fs.existsSync(EMAIL_STORE_FILE)) {
      fs.unlinkSync(EMAIL_STORE_FILE);
    }
  } catch {
    // Ignore error on delete
  }
  lastLoadedMtime = 0;
}
