import { dataFile } from "@/lib/data-dir";
import fs from "fs";
import { Proof } from "@/types/database";
import { getOrdersForUser } from "@/modules/orders/order-store";

const PROOFS_STORE_FILE = dataFile(".proofs-store.json");

interface ProofsStoreData {
  proofs: Record<string, Proof>;
}

let inMemoryProofs: ProofsStoreData = { proofs: {} };
let lastLoadedMtime = 0;
let isInitialized = false;

function loadStore(): void {
  try {
    if (fs.existsSync(PROOFS_STORE_FILE)) {
      const stats = fs.statSync(PROOFS_STORE_FILE);
      if (!isInitialized || stats.mtimeMs > lastLoadedMtime) {
        const raw = fs.readFileSync(PROOFS_STORE_FILE, "utf-8");
        inMemoryProofs = JSON.parse(raw);
        lastLoadedMtime = stats.mtimeMs;
        isInitialized = true;
      }
      return;
    }
  } catch (err) {
    console.warn("Could not read proofs store file, using in-memory:", err);
  }

  if (!isInitialized) {
    inMemoryProofs = { proofs: {} };
    saveStore();
    isInitialized = true;
  }
}

function saveStore(): void {
  try {
    const json = JSON.stringify(inMemoryProofs, null, 2);
    fs.writeFileSync(PROOFS_STORE_FILE, json, "utf-8");
    const stats = fs.statSync(PROOFS_STORE_FILE);
    lastLoadedMtime = stats.mtimeMs;
  } catch (err) {
    console.warn("Could not write proofs store file:", err);
  }
}

export function getProofsForUser(
  userId: string,
  userEmail?: string,
  role: string = "customer"
): Proof[] {
  loadStore();
  const all = Object.values(inMemoryProofs.proofs).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (role === "admin") {
    return all;
  }

  if (!userId && !userEmail) {
    return [];
  }

  // Get user's orders to correlate proofs strictly
  const userOrders = getOrdersForUser(userId, userEmail, "customer");
  const userOrderIds = new Set(userOrders.map((o) => o.id));
  const userOrderNumbers = new Set(userOrders.map((o) => o.order_number));

  return all.filter(
    (p) => userOrderIds.has(p.order_id) || userOrderNumbers.has(p.order_id)
  );
}

export function getProofById(id: string): Proof | null {
  loadStore();
  return inMemoryProofs.proofs[id] || null;
}

export function saveProof(proof: Proof): Proof {
  loadStore();
  inMemoryProofs.proofs[proof.id] = proof;
  saveStore();
  return proof;
}

export function updateProof(id: string, updates: Partial<Proof>): Proof | null {
  loadStore();
  const target = inMemoryProofs.proofs[id];
  if (!target) return null;

  const updated: Proof = {
    ...target,
    ...updates,
  };
  inMemoryProofs.proofs[id] = updated;
  saveStore();
  return updated;
}

export function resetProofsStore(seedProofs?: Proof[]): void {
  inMemoryProofs = { proofs: {} };
  if (seedProofs) {
    for (const p of seedProofs) {
      inMemoryProofs.proofs[p.id] = p;
    }
  }
  saveStore();
}
