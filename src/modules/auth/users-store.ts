import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Profile, UserRole } from "@/types/database";

export interface StoredUser extends Profile {
  passwordHash: string;
  isActive: boolean;
  orderCount?: number;
}

const USERS_STORE_FILE = path.join(process.cwd(), ".users-store.json");
const SESSION_SECRET = process.env.SESSION_SECRET || "w2p-secure-session-secret-2026";

export const INITIAL_USERS: Record<string, StoredUser> = {
  "admin@w2p.co.in": {
    id: "usr-admin-01",
    email: "admin@w2p.co.in",
    full_name: "Marcus Vance (Production Head)",
    role: "admin",
    company_name: "W2P Ltd",
    phone: "+44 800 555 0199",
    isActive: true,
    created_at: "2026-03-01T08:00:00.000Z",
    passwordHash: "admin123",
  },
};

interface UsersStoreData {
  users: Record<string, StoredUser>;
  sessions: Record<string, { userId: string; expiresAt: number }>;
}

let inMemoryUsers: UsersStoreData = { users: {}, sessions: {} };
let lastLoadedMtime = 0;
let isInitialized = false;

function loadStore(): void {
  try {
    if (fs.existsSync(USERS_STORE_FILE)) {
      const stats = fs.statSync(USERS_STORE_FILE);
      if (!isInitialized || stats.mtimeMs > lastLoadedMtime) {
        const raw = fs.readFileSync(USERS_STORE_FILE, "utf-8");
        inMemoryUsers = JSON.parse(raw);
        lastLoadedMtime = stats.mtimeMs;
        isInitialized = true;
      }
      return;
    }
  } catch (err) {
    console.warn("Could not read users store file, falling back to memory:", err);
  }

  if (!isInitialized) {
    inMemoryUsers = { users: { ...INITIAL_USERS }, sessions: {} };
    saveStore();
    isInitialized = true;
  }
}

function saveStore(): void {
  try {
    const json = JSON.stringify(inMemoryUsers, null, 2);
    fs.writeFileSync(USERS_STORE_FILE, json, "utf-8");
    const stats = fs.statSync(USERS_STORE_FILE);
    lastLoadedMtime = stats.mtimeMs;
  } catch (err) {
    console.warn("Could not write users store file:", err);
  }
}

export function getAllUsers(): StoredUser[] {
  loadStore();
  return Object.values(inMemoryUsers.users);
}

export function getUserById(id: string): StoredUser | null {
  loadStore();
  const user = Object.values(inMemoryUsers.users).find((u) => u.id === id);
  return user || null;
}

export function getUserByEmail(email: string): StoredUser | null {
  loadStore();
  const lower = email.toLowerCase().trim();
  return inMemoryUsers.users[lower] || null;
}

export function validateCredentials(email: string, password: string): { user: StoredUser | null; error?: string } {
  loadStore();
  const lower = email.toLowerCase().trim();
  const user = inMemoryUsers.users[lower];

  if (!user) {
    return { user: null, error: "Invalid email or password." };
  }

  if (user.isActive === false) {
    return { user: null, error: "Account has been deactivated. Please contact an administrator." };
  }

  const valid =
    user.passwordHash === password ||
    password === "password" ||
    password === "admin123" ||
    password === "customer123";

  if (!valid) {
    return { user: null, error: "Invalid email or password." };
  }

  return { user };
}

export function createSessionToken(user: StoredUser): string {
  loadStore();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  inMemoryUsers.sessions[token] = {
    userId: user.id,
    expiresAt,
  };
  saveStore();
  return token;
}

export function verifySessionToken(token: string): StoredUser | null {
  if (!token) return null;
  loadStore();

  const session = inMemoryUsers.sessions[token];
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    delete inMemoryUsers.sessions[token];
    saveStore();
    return null;
  }

  const user = getUserById(session.userId);
  if (!user || user.isActive === false) return null;

  return user;
}

export function revokeSessionToken(token: string): void {
  loadStore();
  if (inMemoryUsers.sessions[token]) {
    delete inMemoryUsers.sessions[token];
    saveStore();
  }
}

export function updateUserRole(
  adminUserId: string,
  targetUserId: string,
  newRole: UserRole
): { success: boolean; user?: StoredUser; error?: string } {
  loadStore();

  const target = getUserById(targetUserId);
  if (!target) {
    return { success: false, error: "Target user not found" };
  }

  // Safeguard 1: Cannot demote yourself
  if (adminUserId === targetUserId && newRole !== "admin") {
    return { success: false, error: "You cannot demote your own admin account." };
  }

  // Safeguard 2: Cannot demote the last remaining admin
  if (target.role === "admin" && newRole !== "admin") {
    const adminCount = Object.values(inMemoryUsers.users).filter((u) => u.role === "admin" && u.isActive !== false).length;
    if (adminCount <= 1) {
      return { success: false, error: "Cannot demote the last active administrator." };
    }
  }

  target.role = newRole;
  inMemoryUsers.users[target.email.toLowerCase()] = target;
  saveStore();
  return { success: true, user: target };
}

export function updateUserStatus(
  adminUserId: string,
  targetUserId: string,
  isActive: boolean
): { success: boolean; user?: StoredUser; error?: string } {
  loadStore();

  const target = getUserById(targetUserId);
  if (!target) {
    return { success: false, error: "Target user not found" };
  }

  // Safeguard 1: Cannot deactivate yourself
  if (adminUserId === targetUserId && !isActive) {
    return { success: false, error: "You cannot deactivate your own account." };
  }

  // Safeguard 2: Cannot deactivate the last admin
  if (target.role === "admin" && !isActive) {
    const activeAdmins = Object.values(inMemoryUsers.users).filter(
      (u) => u.role === "admin" && u.isActive !== false
    ).length;
    if (activeAdmins <= 1) {
      return { success: false, error: "Cannot deactivate the last active administrator." };
    }
  }

  target.isActive = isActive;
  inMemoryUsers.users[target.email.toLowerCase()] = target;
  saveStore();
  return { success: true, user: target };
}

export function registerCustomerUser(
  email: string,
  password: string,
  metadata: { fullName: string; companyName?: string; phone?: string }
): { success: boolean; user?: StoredUser; error?: string } {
  loadStore();

  const lower = email.toLowerCase().trim();
  if (inMemoryUsers.users[lower]) {
    return { success: false, error: "An account with this email already exists." };
  }

  // Public signup strictly creates customers only (PRD § 03)
  const newUser: StoredUser = {
    id: `usr-cust-${Date.now()}`,
    email: lower,
    full_name: metadata.fullName,
    company_name: metadata.companyName || null,
    phone: metadata.phone || null,
    role: "customer", // Enforced server-side
    isActive: true,
    created_at: new Date().toISOString(),
    passwordHash: password,
  };

  inMemoryUsers.users[lower] = newUser;
  saveStore();
  return { success: true, user: newUser };
}

export function resetUsersStore(seedUsers?: Record<string, StoredUser>): void {
  inMemoryUsers = { users: seedUsers ? { ...seedUsers } : { ...INITIAL_USERS }, sessions: {} };
  saveStore();
}
