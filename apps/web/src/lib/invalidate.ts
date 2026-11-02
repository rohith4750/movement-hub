import type { QueryClient } from "@tanstack/react-query";

/**
 * Groups of query keys that change together. After a save, refresh only the group it affects
 * instead of every query in the app (`qc.invalidateQueries()` with no filter).
 */
export const KEYS = {
  appointments: ["appointments", "appointment", "calendar", "schedule", "availability", "availability-summary", "sessions", "home-visits", "patient", "plans", "plan", "patient-packages", "progress", "consultation", "dashboard"],
  patients: ["patients", "patient", "patient-lite", "addresses", "appointments", "calendar", "availability", "availability-summary", "sessions", "home-visits", "plans", "invoices", "patient-packages", "dashboard"],
  packageSale: ["patient-packages", "patient", "invoices", "invoice", "plans", "plan", "dashboard"],
  billing: ["invoices", "invoice", "invoice-preview", "patient", "patient-packages", "dashboard"],
  staff: ["users", "therapists"],
  therapists: ["therapists", "users", "schedule", "availability", "availability-summary", "calendar", "appointments", "dashboard"],
} as const;

export function refresh(qc: QueryClient, ...groups: (keyof typeof KEYS)[]) {
  const roots = new Set<string>(groups.flatMap((g) => KEYS[g]));
  return qc.invalidateQueries({ predicate: (q) => roots.has(String(q.queryKey[0])) });
}
