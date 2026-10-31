"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role = "SUPER_ADMIN" | "ADMIN" | "RECEPTIONIST" | "PHYSIOTHERAPIST" | "ACCOUNTANT" | "PATIENT";

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  email?: string | null;
  phone?: string;
  branchId: string | null;
  therapistId: string | null;
  patientId: string | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  setSession: (s: { accessToken: string; refreshToken: string; user: SessionUser }) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: (s) => set(s),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: "movement-hub-auth" },
  ),
);

/** Same rule as the API: physiotherapists also run the front desk and billing (no receptionist / accountant). */
const ALSO_ACTS_AS: Partial<Record<Role, Role[]>> = { PHYSIOTHERAPIST: ["RECEPTIONIST", "ACCOUNTANT"] };

export const hasRole = (user: SessionUser | null, ...roles: Role[]) =>
  !!user && (user.role === "SUPER_ADMIN" || roles.includes(user.role) || (ALSO_ACTS_AS[user.role] ?? []).some((r) => roles.includes(r)));
