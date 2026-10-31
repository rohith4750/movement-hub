import { create } from "zustand";
import { getItem, removeItem, setItem } from "./storage";

export interface SessionUser {
  id: string;
  name: string;
  role: string;
  phone?: string;
  email?: string | null;
  branchId: string | null;
  patientId: string | null;
  therapistId: string | null;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

type Status = "loading" | "signedOut" | "signedIn";

interface AuthState {
  status: Status;
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  hydrate: () => Promise<void>;
  signIn: (s: Session) => Promise<void>;
  signOut: () => Promise<void>;
}

// Keys: alphanumerics, ".", "-", "_" only (SecureStore rule). Stored separately to stay small.
const K_ACCESS = "mh.access";
const K_REFRESH = "mh.refresh";
const K_USER = "mh.user";

export const useAuth = create<AuthState>((set) => ({
  status: "loading",
  accessToken: null,
  refreshToken: null,
  user: null,

  hydrate: async () => {
    const [accessToken, refreshToken, userJson] = await Promise.all([getItem(K_ACCESS), getItem(K_REFRESH), getItem(K_USER)]);
    let user: SessionUser | null = null;
    try {
      user = userJson ? (JSON.parse(userJson) as SessionUser) : null;
    } catch {
      user = null;
    }
    // Staff app: any non-patient account with a stored session.
    if (accessToken && refreshToken && user && user.role !== "PATIENT") set({ status: "signedIn", accessToken, refreshToken, user });
    else set({ status: "signedOut", accessToken: null, refreshToken: null, user: null });
  },

  signIn: async ({ accessToken, refreshToken, user }) => {
    await Promise.all([setItem(K_ACCESS, accessToken), setItem(K_REFRESH, refreshToken), setItem(K_USER, JSON.stringify(user))]);
    set({ status: "signedIn", accessToken, refreshToken, user });
  },

  signOut: async () => {
    await Promise.all([removeItem(K_ACCESS), removeItem(K_REFRESH), removeItem(K_USER)]);
    set({ status: "signedOut", accessToken: null, refreshToken: null, user: null });
  },
}));

export type Role = "SUPER_ADMIN" | "ADMIN" | "RECEPTIONIST" | "PHYSIOTHERAPIST" | "ACCOUNTANT";

/**
 * Same rule as the API: Super Admin can do everything, and physiotherapists also run the
 * front desk and billing (Movement Hub has no receptionist / accountant).
 */
const ALSO_ACTS_AS: Partial<Record<Role, Role[]>> = { PHYSIOTHERAPIST: ["RECEPTIONIST", "ACCOUNTANT"] };

export const hasRole = (user: SessionUser | null | undefined, ...roles: Role[]) =>
  !!user && (user.role === "SUPER_ADMIN" || roles.includes(user.role as Role) || (ALSO_ACTS_AS[user.role as Role] ?? []).some((r) => roles.includes(r)));

export const useHasRole = (...roles: Role[]) => useAuth((s) => hasRole(s.user, ...roles));
