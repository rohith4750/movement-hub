import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { hasRole, useAuth } from "./auth";
import { qk } from "./query-keys";
import type {
  Appointment,
  Consultation,
  ConsultationHistoryEntry,
  Dashboard,
  DateRange,
  FinanceAnalytics,
  Invoice,
  Me,
  MonthlyRow,
  OperationsAnalytics,
  OutcomeAnalytics,
  PatientAnalytics,
  PatientDetail,
  PlannerDay,
  Therapist,
  TherapySession,
  TreatmentPlan,
  TreatmentPrice,
} from "./types";

/**
 * Shared read hooks. A screen that needs data another screen also shows uses the hook here, so
 * both share one cache entry (same key, same fetch, same refresh rules — see lib/refresh.ts).
 */

/** Physiotherapists see their own appointments/sessions; other roles see the whole clinic. */
export const useMyTherapistId = () => useAuth((s) => (s.user?.role === "PHYSIOTHERAPIST" ? s.user.therapistId ?? undefined : undefined));

export function useMe() {
  return useQuery({ queryKey: qk.me(), queryFn: () => api.get<Me>("/auth/me") });
}

export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard(), queryFn: () => api.get<Dashboard>("/reports/dashboard"), refetchInterval: 5 * 60_000 });
}

/* ─────────────── Front desk ─────────────── */

/** Appointments on a day. Defaults to whole clinic; `mine = true` limits a physio to their own. */
export function useAppointmentsOn(date: string, mine = false) {
  const myId = useMyTherapistId();
  const therapistId = mine ? myId : undefined;
  return useQuery({
    queryKey: qk.appointments.day(date, therapistId),
    queryFn: () => api.page<Appointment>("/appointments", { date, therapistId, limit: 100 }),
    select: (r) => r.data,
  });
}

export function useAppointment(id: string | undefined) {
  return useQuery({ queryKey: qk.appointment(id ?? ""), queryFn: () => api.get<Appointment>(`/appointments/${id}`), enabled: !!id });
}

/** The day planner for a date (tomorrow by default on the screen). */
/** `include`: patients the front desk added by hand, planned even if not in ongoing care. */
export function usePlanner(date: string, therapistId?: string, include: string[] = []) {
  return useQuery({
    queryKey: qk.planner(date, therapistId, include),
    queryFn: () => api.get<PlannerDay>("/planner", { date, therapistId, include: include.join(",") }),
    // Several people plan at once (three physios + front desk): keep it fresh while it's open.
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

export function useTodaySessions() {
  const user = useAuth((s) => s.user);
  return useQuery({
    queryKey: qk.sessions.today(),
    queryFn: () => api.get<TherapySession[]>("/therapy-sessions/today"),
    enabled: hasRole(user, "PHYSIOTHERAPIST", "ADMIN", "RECEPTIONIST"),
    refetchInterval: 2 * 60_000,
  });
}

/* ─────────────── Patients & clinical ─────────────── */

export function usePatient(id: string | undefined) {
  return useQuery({ queryKey: qk.patient(id ?? ""), queryFn: () => api.get<PatientDetail>(`/patients/${id}`), enabled: !!id });
}

export function useActivePlans(patientId: string | undefined) {
  return useQuery({
    queryKey: qk.plans.activeFor(patientId ?? ""),
    queryFn: () => api.page<TreatmentPlan>("/treatment-plans", { patientId, status: "ACTIVE" }),
    select: (r) => r.data,
    enabled: !!patientId,
  });
}

export function useConsultation(id: string | undefined) {
  return useQuery({ queryKey: qk.consultation(id ?? ""), queryFn: () => api.get<Consultation>(`/consultations/${id}`), enabled: !!id });
}

export function useConsultationHistory(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.consultationHistory(id ?? ""),
    queryFn: () => api.get<ConsultationHistoryEntry[]>(`/consultations/${id}/history`),
    enabled: !!id && enabled,
  });
}

/** The patient's most recent finished consultation other than this visit's, for comparison. */
export function usePreviousAssessment(patientId: string | undefined, appointmentId: string) {
  return useQuery({
    queryKey: qk.previousAssessment(patientId ?? "", appointmentId),
    queryFn: () => api.page<Consultation>("/consultations", { patientId, status: "FINAL", excludeAppointmentId: appointmentId, limit: 1 }),
    select: (r) => r.data[0] ?? null,
    enabled: !!patientId,
    staleTime: 5 * 60_000,
  });
}

/* ─────────────── Staff ─────────────── */

/** Active physiotherapists (optionally only those who do home visits). Shared by every picker. */
export function useTherapists(opts: { homeVisit?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.therapists.list({ homeVisit: opts.homeVisit }),
    queryFn: () => api.get<Therapist[]>("/therapists", { homeVisit: opts.homeVisit || undefined }),
    enabled: opts.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}

/* ─────────────── Finance & reports ─────────────── */

export function useInvoices(status?: string) {
  return useQuery({
    queryKey: qk.invoices.list({ status: status ?? "all" }),
    queryFn: () => api.page<Invoice>("/invoices", { status, limit: 50 }),
    select: (r) => r.data,
  });
}

/** The clinic's price per treatment category, used when billing. Rarely changes. */
export function useTreatmentPrices(enabled = true) {
  return useQuery({ queryKey: qk.treatmentPrices(), queryFn: () => api.get<TreatmentPrice[]>("/settings/treatment-prices"), enabled, staleTime: 10 * 60_000 });
}

export function useMonthlyReport(months = 6, enabled = true) {
  return useQuery({ queryKey: qk.report("monthly", { months }), queryFn: () => api.get<MonthlyRow[]>("/reports/monthly", { months }), enabled, staleTime: 10 * 60_000 });
}

/* Analytics tabs of the Reports screen (admin; finance also accountant). Slow-moving, so cached for a few minutes. */
export function usePatientAnalytics(range: DateRange, enabled = true) {
  return useQuery({ queryKey: qk.report("a-patients", { ...range }), queryFn: () => api.get<PatientAnalytics>("/reports/patients", { ...range }), enabled, staleTime: 5 * 60_000 });
}
export function useOutcomeAnalytics(range: DateRange, enabled = true) {
  return useQuery({ queryKey: qk.report("a-outcomes", { ...range }), queryFn: () => api.get<OutcomeAnalytics>("/reports/outcomes", { ...range }), enabled, staleTime: 5 * 60_000 });
}
export function useOperationsAnalytics(range: DateRange, enabled = true) {
  return useQuery({ queryKey: qk.report("a-operations", { ...range }), queryFn: () => api.get<OperationsAnalytics>("/reports/operations", { ...range }), enabled, staleTime: 5 * 60_000 });
}
export function useFinanceAnalytics(range: DateRange, therapistId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.report("a-finance", { ...range, therapistId: therapistId ?? "all" }),
    queryFn: () => api.get<FinanceAnalytics>("/reports/finance", { ...range, therapistId }),
    enabled,
    staleTime: 5 * 60_000,
  });
}
