import fs from "fs";
import path from "path";

export interface AdminAuditEntry {
  id: string;
  admin_id: string;
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
  created_at: string;
}

const AUDIT_STORE_FILE = path.join(process.cwd(), ".audit-store.json");

interface AuditStoreData {
  logs: AdminAuditEntry[];
}

let inMemoryAudit: AuditStoreData = { logs: [] };
let lastLoadedMtime = 0;
let isInitialized = false;

function loadStore(): void {
  try {
    if (fs.existsSync(AUDIT_STORE_FILE)) {
      const stats = fs.statSync(AUDIT_STORE_FILE);
      if (!isInitialized || stats.mtimeMs > lastLoadedMtime) {
        const raw = fs.readFileSync(AUDIT_STORE_FILE, "utf-8");
        inMemoryAudit = JSON.parse(raw);
        lastLoadedMtime = stats.mtimeMs;
        isInitialized = true;
      }
      return;
    }
  } catch (err) {
    console.warn("Could not read audit store, using memory:", err);
  }

  if (!isInitialized) {
    inMemoryAudit = { logs: [] };
    saveStore();
    isInitialized = true;
  }
}

function saveStore(): void {
  try {
    const json = JSON.stringify(inMemoryAudit, null, 2);
    fs.writeFileSync(AUDIT_STORE_FILE, json, "utf-8");
    const stats = fs.statSync(AUDIT_STORE_FILE);
    lastLoadedMtime = stats.mtimeMs;
  } catch (err) {
    console.warn("Could not write audit store file:", err);
  }
}

export function logAdminAction(
  admin_id: string,
  admin_email: string,
  action: AdminAuditEntry["action"],
  target_type: AdminAuditEntry["target_type"],
  target_id: string,
  details: Record<string, unknown> = {}
): AdminAuditEntry {
  loadStore();

  const entry: AdminAuditEntry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    admin_id,
    admin_email,
    action,
    target_type,
    target_id,
    details,
    created_at: new Date().toISOString(),
  };

  inMemoryAudit.logs.unshift(entry);
  saveStore();
  return entry;
}

export function getAuditLogs(options?: {
  target_type?: string;
  target_id?: string;
  action?: string;
  limit?: number;
}): AdminAuditEntry[] {
  loadStore();
  let filtered = [...inMemoryAudit.logs];

  if (options?.target_type) {
    filtered = filtered.filter((l) => l.target_type === options.target_type);
  }
  if (options?.target_id) {
    filtered = filtered.filter((l) => l.target_id === options.target_id);
  }
  if (options?.action) {
    filtered = filtered.filter((l) => l.action === options.action);
  }

  if (options?.limit) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}

export function resetAuditStore(): void {
  inMemoryAudit = { logs: [] };
  saveStore();
}
