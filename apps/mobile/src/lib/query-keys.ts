/**
 * Every TanStack Query key in the app comes from here, so screens that show the same data share
 * one cache entry, and refresh groups (lib/refresh.ts) can target data by its first key part.
 *
 * Rule: the FIRST element is the "root" (what kind of data). Refresh groups match on it, so a
 * new key must start with a root listed in lib/refresh.ts.
 */
type Params = Record<string, unknown>;

export const qk = {
  me: () => ["me"] as const,
  dashboard: () => ["dashboard"] as const,

  /* Front desk */
  appointments: {
    all: () => ["appointments"] as const,
    day: (date: string, therapistId?: string) => ["appointments", "day", date, therapistId ?? "all"] as const,
  },
  appointment: (id: string) => ["appointment", id] as const,
  planner: (date: string, therapistId?: string, include: string[] = []) => ["planner", date, therapistId ?? "all", include.join(",")] as const,
  calendar: (date: string) => ["calendar", "day", date] as const,
  availability: (params: Params) => ["availability", params] as const,
  availabilitySummary: (params: Params) => ["availability-summary", params] as const,
  recurringPreview: (params: Params) => ["recurring-preview", params] as const,
  homeVisits: (date: string) => ["home-visits", date] as const,

  /* Patients */
  patients: {
    all: () => ["patients"] as const,
    list: (scope: string, params: Params) => ["patients", scope, params] as const,
  },
  patient: (id: string) => ["patient", id] as const,
  patientProgress: (id: string) => ["progress", id] as const,

  /* Clinical */
  plans: {
    all: () => ["plans"] as const,
    list: (params: Params) => ["plans", "list", params] as const,
    activeFor: (patientId: string) => ["plans", "active", patientId] as const,
  },
  plan: (id: string) => ["plan", id] as const,
  progressLog: (planId: string) => ["progress-log", planId] as const,
  consultation: (id: string) => ["consultation", id] as const,
  consultationHistory: (id: string) => ["consultation", id, "history"] as const,
  previousAssessment: (patientId: string, appointmentId: string) => ["consultation", "previous", patientId, appointmentId] as const,
  sessions: { all: () => ["sessions"] as const, today: () => ["sessions", "today"] as const },
  session: (id: string) => ["session", id] as const,

  /* Finance */
  invoices: { all: () => ["invoices"] as const, list: (params: Params) => ["invoices", "list", params] as const },
  invoice: (id: string) => ["invoice", id] as const,
  invoicePreview: (body: unknown) => ["invoice-preview", body] as const,
  packages: (scope: "all" | "active") => ["packages", scope] as const,
  patientPackages: {
    all: () => ["patient-packages"] as const,
    list: (params: Params) => ["patient-packages", "list", params] as const,
    activeFor: (patientId: string) => ["patient-packages", "active", patientId] as const,
  },
  report: (name: string, params: Params = {}) => ["report", name, params] as const,

  /* Administration */
  therapists: {
    all: () => ["therapists"] as const,
    list: (opts: { homeVisit?: boolean; admin?: boolean } = {}) => ["therapists", "list", { homeVisit: !!opts.homeVisit, admin: !!opts.admin }] as const,
  },
  therapist: (id: string) => ["therapist", id] as const,
  leaves: (therapistId: string) => ["leaves", therapistId] as const,
  specializations: () => ["specializations"] as const,
  users: () => ["users"] as const,
  settings: () => ["settings"] as const,
};
