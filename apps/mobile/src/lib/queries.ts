import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { hasRole, useAuth } from "./auth";
import type { Appointment, Dashboard, Invoice, Me, TherapySession } from "./types";

/** Physiotherapists see their own appointments/sessions; other roles see the whole clinic. */
export const useMyTherapistId = () => useAuth((s) => (s.user?.role === "PHYSIOTHERAPIST" ? s.user.therapistId ?? undefined : undefined));

export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/reports/dashboard"), refetchInterval: 5 * 60_000 });
}

/** Appointments on a day. `mine` (default true) limits a physio to their own; false shows the whole clinic. */
export function useAppointmentsOn(date: string, mine = true) {
  const myId = useMyTherapistId();
  const therapistId = mine ? myId : undefined;
  return useQuery({
    queryKey: ["appointments", "day", date, therapistId],
    queryFn: () => api.page<Appointment>("/appointments", { date, therapistId, limit: 100 }),
    select: (r) => r.data,
  });
}

export function useTodaySessions() {
  const user = useAuth((s) => s.user);
  return useQuery({
    queryKey: ["sessions", "today"],
    queryFn: () => api.get<TherapySession[]>("/therapy-sessions/today"),
    enabled: hasRole(user, "PHYSIOTHERAPIST", "ADMIN", "RECEPTIONIST"),
    refetchInterval: 2 * 60_000,
  });
}

export function useInvoices(status?: string) {
  return useQuery({
    queryKey: ["invoices", status ?? "all"],
    queryFn: () => api.page<Invoice>("/invoices", { status, limit: 50 }),
    select: (r) => r.data,
  });
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/auth/me") });
}
