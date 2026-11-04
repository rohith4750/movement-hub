import { useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";
import { onEdit } from "./form-activity";

/**
 * After a save, refresh exactly the data it can change — by GROUP, never by hand-picked keys.
 * Each group lists the query roots (first key part, see lib/query-keys.ts) that depend on it.
 * Only queries currently on screen refetch immediately; the rest are marked stale and refetch
 * when next shown, so this stays cheap.
 */
const GROUPS = {
  /** Booking, rescheduling, cancelling, status changes, walk-ins, the day planner. */
  appointments: ["appointments", "appointment", "planner", "calendar", "availability", "availability-summary", "sessions", "session", "home-visits", "patient", "patients", "plans", "plan", "patient-packages", "dashboard", "report"],
  /** Registering or editing a patient. */
  patients: ["patients", "patient", "progress", "planner", "appointments", "appointment", "dashboard"],
  /** Consultations, treatment plans, therapy sessions, daily progress. */
  clinical: ["consultation", "plans", "plan", "progress-log", "progress", "patient", "patients", "sessions", "session", "appointment", "appointments", "planner", "patient-packages", "dashboard"],
  /** Invoices, payments, refunds. */
  billing: ["invoices", "invoice", "invoice-preview", "patient", "patient-packages", "dashboard", "report"],
  /** Package catalogue and patient packages. */
  packages: ["packages", "patient-packages", "patient", "invoices", "planner", "dashboard"],
  /** Physio schedules, slots, leave. */
  schedule: ["calendar", "availability", "availability-summary", "planner", "therapist", "therapists", "leaves", "appointments", "dashboard"],
  /** Staff accounts, PINs. */
  staff: ["users", "therapists", "therapist"],
  /** Clinic settings (fees, hours). */
  settings: ["settings", "dashboard", "invoice-preview"],
} as const;

export type RefreshGroup = keyof typeof GROUPS;

export function refresh(qc: QueryClient, ...groups: RefreshGroup[]) {
  const roots = new Set<string>(groups.flatMap((g) => GROUPS[g]));
  return qc.invalidateQueries({ predicate: (q) => roots.has(String(q.queryKey[0])) });
}

/** Drop a cache entry that no longer exists (e.g. after a delete) so nothing refetches it. */
export function forget(qc: QueryClient, key: QueryKey) {
  qc.removeQueries({ queryKey: key, exact: true });
}

export function useRefresh() {
  const qc = useQueryClient();
  return (...groups: RefreshGroup[]) => refresh(qc, ...groups);
}

/**
 * useMutation with the app's conventions: on success it refreshes the given groups (in the
 * background, so navigation isn't delayed), then runs `onSuccess`. Errors stay on `.error`
 * for the screen's ErrorBox.
 */
export function useAction<TData = unknown, TVars = void>(
  fn: (vars: TVars) => Promise<TData>,
  opts: { refresh?: RefreshGroup[]; onSuccess?: (data: TData, vars: TVars) => void; onError?: (e: Error, vars: TVars) => void } = {},
) {
  const qc = useQueryClient();
  const m = useMutation<TData, Error, TVars>({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      if (opts.refresh?.length) void refresh(qc, ...opts.refresh);
      opts.onSuccess?.(data, vars);
    },
    onError: opts.onError,
  });
  // While an error is showing, the first edit to any field on the screen clears it.
  const hasError = m.isError;
  const reset = m.reset;
  useEffect(() => (hasError ? onEdit(reset) : undefined), [hasError, reset]);
  return m;
}
