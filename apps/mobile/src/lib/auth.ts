import { create } from "zustand";
import { removeItem } from "./storage";

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

// Older app versions saved the session on the device. The app now asks for the PIN on every
// launch, so the session lives in memory only and any saved copy is wiped at startup.
const LEGACY_KEYS = ["mh.access", "mh.refresh", "mh.user"];

export const useAuth = create<AuthState>((set) => ({
  status: "loading",
  accessToken: null,
  refreshToken: null,
  user: null,

  hydrate: async () => {
    await Promise.all(LEGACY_KEYS.map(removeItem));
    set({ status: "signedOut", accessToken: null, refreshToken: null, user: null });
  },

  signIn: async ({ accessToken, refreshToken, user }) => {
    set({ status: "signedIn", accessToken, refreshToken, user });
  },

  signOut: async () => {
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
