import { dataFile } from "@/lib/data-dir";
import fs from "fs";
import { SavedDesign } from "@/types/database";

const DESIGNS_STORE_FILE = dataFile(".saved-designs-store.json");

interface DesignsStoreData {
  designs: Record<string, SavedDesign>;
}

let inMemoryDesigns: DesignsStoreData = { designs: {} };
let lastLoadedMtime = 0;
let isInitialized = false;

function loadStore(): void {
  try {
    if (fs.existsSync(DESIGNS_STORE_FILE)) {
      const stats = fs.statSync(DESIGNS_STORE_FILE);
      if (!isInitialized || stats.mtimeMs > lastLoadedMtime) {
        const raw = fs.readFileSync(DESIGNS_STORE_FILE, "utf-8");
        inMemoryDesigns = JSON.parse(raw);
        lastLoadedMtime = stats.mtimeMs;
        isInitialized = true;
      }
      return;
    }
  } catch (err) {
    console.warn("Could not read saved designs store file, using in-memory:", err);
  }

  if (!isInitialized) {
    inMemoryDesigns = { designs: {} };
    saveStore();
    isInitialized = true;
  }
}

function saveStore(): void {
  try {
    const json = JSON.stringify(inMemoryDesigns, null, 2);
    fs.writeFileSync(DESIGNS_STORE_FILE, json, "utf-8");
    const stats = fs.statSync(DESIGNS_STORE_FILE);
    lastLoadedMtime = stats.mtimeMs;
  } catch (err) {
    console.warn("Could not write saved designs store file:", err);
  }
}

export function getSavedDesignsForUser(
  userId: string,
  role: string = "customer"
): SavedDesign[] {
  loadStore();
  const all = Object.values(inMemoryDesigns.designs).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (role === "admin") {
    return all;
  }

  if (!userId) {
    return [];
  }

  return all.filter((d) => d.customer_id === userId);
}

export function getSavedDesignById(id: string): SavedDesign | null {
  loadStore();
  return inMemoryDesigns.designs[id] || null;
}

export function saveDesign(design: SavedDesign): SavedDesign {
  loadStore();
  inMemoryDesigns.designs[design.id] = design;
  saveStore();
  return design;
}

export function deleteSavedDesign(id: string, userId: string): boolean {
  loadStore();
  const target = inMemoryDesigns.designs[id];
  if (!target) return false;
  if (target.customer_id !== userId) return false;

  delete inMemoryDesigns.designs[id];
  saveStore();
  return true;
}

export function resetSavedDesignsStore(seedDesigns?: SavedDesign[]): void {
  inMemoryDesigns = { designs: {} };
  if (seedDesigns) {
    for (const d of seedDesigns) {
      inMemoryDesigns.designs[d.id] = d;
    }
  }
  saveStore();
}
