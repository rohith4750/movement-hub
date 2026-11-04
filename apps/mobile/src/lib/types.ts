export type AppointmentType = "INITIAL_CONSULTATION" | "FOLLOW_UP_CONSULTATION" | "THERAPY_SESSION" | "HOME_VISIT";
/** Booked ahead, or a patient who walked in. */
export type AppointmentSource = "SCHEDULED" | "WALK_IN";
export type PatientType = "REGULAR" | "WALK_IN";
/** NEW: no completed visit yet · REGULAR: ongoing care · OCCASIONAL: has visited, no ongoing care. */
export type PatientCategory = "NEW" | "REGULAR" | "OCCASIONAL";

export const CATEGORY_LABEL: Record<PatientCategory, string> = { NEW: "New", REGULAR: "Regular", OCCASIONAL: "Occasional" };

export interface VisitStats {
  completedVisits: number;
  lastVisitAt: string | null;
  nextVisitAt: string | null;
  category: PatientCategory;
}

export interface Appointment {
  id: string;
  appointmentNo: string;
  type: AppointmentType;
  status: string;
  source?: AppointmentSource;
  startAt: string;
  endAt: string;
  notes: string | null;
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null; phone: string };
  therapist: { id: string; colorTag: string | null; user: { name: string } };
  treatmentPlan: { id: string; title: string } | null;
  therapySession: { id: string; status: string; sessionNumber: number | null } | null;
  consultation: { id: string } | null;
  homeVisit?: { id: string; status: string } | null;
}

export interface Dashboard {
  totalPatients: number;
  newPatientsMonth: number;
  regularPatients: number;
  walkInsToday: number;
  scheduledToday: number;
  todayAppointments: number;
  pendingAppointments: number;
  completedSessionsToday: number;
  availableTherapists: number;
  revenueToday: number | null;
  revenueMonth: number | null;
  therapistUtilization: { therapistId: string; name: string; colorTag: string | null; onLeave: boolean; booked: number; total: number; percent: number }[];
}

export interface PatientListItem {
  patientType?: PatientType;
  id: string;
  patientCode: string;
  firstName: string;
  lastName: string | null;
  gender: string;
  phone: string;
  dateOfBirth?: string | null;
  packages?: { id: string; remainingSessions: number; expiryDate: string }[];
  treatmentPlans?: { id: string; title: string }[];
  primaryTherapistId?: string | null;
  primaryTherapist?: { id: string; colorTag: string | null; user: { name: string } } | null;
  visits?: VisitStats;
}

export interface PatientDetail {
  patientType?: PatientType;
  id: string;
  patientCode: string;
  firstName: string;
  lastName: string | null;
  gender: string;
  dateOfBirth: string | null;
  phone: string;
  email: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  referredBy: string | null;
  primaryTherapistId?: string | null;
  primaryTherapist?: { id: string; colorTag: string | null; user: { name: string } } | null;
  addresses: { id: string; label: string; line1: string; city: string; pincode: string; isDefault: boolean }[];
  medicalHistory: { id: string; condition: string; details: string | null; isOngoing: boolean; medications: string | null; allergies: string | null }[];
  packages: { id: string; status: string; remainingSessions: number; totalSessions: number; expiryDate: string; package: { name: string } }[];
  treatmentPlans: { id: string; title: string; status: string; prescribedSessions: number; createdAt: string }[];
  appointments: { id: string; appointmentNo: string; type: string; status: string; startAt: string; therapist: { user: { name: string } } }[];
  visits?: VisitStats;
}

export interface Therapist {
  id: string;
  colorTag: string | null;
  isAvailableForHomeVisit: boolean;
  user: { id: string; name: string };
  specializations: { specialization: { id: string; name: string } }[];
}

export type TreatmentOutcome = "GOALS_MET" | "PARTIALLY_MET" | "NOT_MET" | "DISCONTINUED";

export const OUTCOME_LABEL: Record<TreatmentOutcome, string> = {
  GOALS_MET: "Goals met",
  PARTIALLY_MET: "Partially met",
  NOT_MET: "Not met",
  DISCONTINUED: "Discontinued",
};

export interface PlanProgress {
  completedSessions: number;
  upcomingSessions: number;
  /** Visits still booked under the plan (incl. one in progress). */
  bookedVisits: number;
  remaining: number;
  percent: number;
  /** All prescribed sessions are done. */
  readyToComplete: boolean;
  /** Pain after the most recent completed session. */
  latestPain: number | null;
}

export interface TreatmentPlan {
  id: string;
  planNo: string;
  title: string;
  diagnosis: string | null;
  goals: string | null;
  status: string;
  prescribedSessions: number;
  frequencyPerWeek: number;
  sessionMinutes: number;
  instructions: string | null;
  completedAt?: string | null;
  outcome?: TreatmentOutcome | null;
  finalPainScore?: number | null;
  dischargeSummary?: string | null;
  homeProgram?: string | null;
  createdAt: string;
  therapist: { id: string; user: { name: string } };
  items: { id: string; category: string; name: string; sets: number | null; reps: number | null; durationMinutes: number | null }[];
}

export interface PlanDetail extends TreatmentPlan {
  progress: PlanProgress;
  therapySessions: { id: string; sessionNumber: number | null; status: string; painBefore: number | null; painAfter: number | null; completedAt: string | null }[];
}

export interface TherapySession {
  id: string;
  sessionNumber: number | null;
  status: string;
  painBefore: number | null;
  painAfter: number | null;
  notes: string | null;
  homeAdvice: string | null;
  progressRating: number | null;
  coverReason: string | null;
  coveredByName: string | null;
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null };
  therapist: { id: string; user: { name: string } };
  appointment: { id: string; appointmentNo: string; startAt: string; endAt: string; status: string };
  treatmentPlan: { title: string; prescribedSessions: number; items: { id: string; category: string; name: string; sets: number | null; reps: number | null; durationMinutes: number | null }[] } | null;
  patientPackage: { id: string; remainingSessions: number; package: { name: string } } | null;
  exercises: { id: string; name: string; sets: number | null; reps: number | null; durationMinutes: number | null }[];
}

export interface PatientPackage {
  id: string;
  remainingSessions: number;
  status: string;
  package: { name: string };
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  dueAmount: string;
  issuedAt: string | null;
  createdAt: string;
  patient?: { id: string; patientCode: string; firstName: string; lastName: string | null };
  /** The physio this bill belongs to (they collect it; it counts in their collections). */
  therapistId?: string | null;
  therapist?: { id: string; user: { name: string } } | null;
}

export interface InvoiceDetail extends Invoice {
  subtotal: string;
  discountAmount: string;
  discountReason: string | null;
  taxableAmount: string;
  gstPercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  items: { id: string; description: string; quantity: number; unitPrice: string; amount: string }[];
  payments: { id: string; receiptNo: string; method: string; amount: string; status: string; paidAt: string | null }[];
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null; phone: string };
}

export interface AvailabilityRow {
  therapistId: string;
  therapistName: string;
  colorTag: string | null;
  onLeave?: boolean;
  specializations: string[];
  slots: { slotId: string; startAt: string; endAt: string }[];
  /** Booked or blocked times, for the Available / Booked / Unavailable legend. */
  taken?: { startAt: string; endAt: string; status: "BOOKED" | "BLOCKED" }[];
  counts?: { free: number; booked: number; blocked: number };
}

export interface Me {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  role: string;
  therapist: { id: string; colorTag: string | null } | null;
}

export type ProgressStatus = "IMPROVED" | "SAME" | "WORSE";

export const PROGRESS_STATUS_LABEL: Record<ProgressStatus, string> = { IMPROVED: "Improved", SAME: "Same", WORSE: "Worse" };

/** One day of a plan's progress. Days without an entry carry the last recorded values forward. */
export interface ProgressDay {
  date: string; // YYYY-MM-DD
  painScore: number | null;
  status: ProgressStatus | null;
  notes: string | null;
  carriedForward: boolean;
  /** Date of the entry these values come from. */
  recordedOn: string | null;
  entryId: string | null;
}

export interface ProgressLog {
  days: ProgressDay[]; // newest first
  entries: number;
  editable: boolean;
}

/* ─────────────── Day planner ─────────────── */

export interface PlannerTherapist {
  id: string;
  name: string;
  colorTag: string | null;
  homeVisits: boolean;
  onLeave: boolean;
  slots: { total: number; free: number; booked: number; blocked: number };
  full: boolean;
}

export interface PlannerSlot {
  id: string;
  therapistId: string;
  startAt: string;
  endAt: string;
  status: "AVAILABLE" | "BOOKED" | "BLOCKED";
}

export interface PlannerAppointment {
  id: string;
  appointmentNo: string;
  type: AppointmentType;
  status: string;
  source: AppointmentSource;
  startAt: string;
  endAt: string;
  therapistId: string;
  /** Booked with a physio who is away that day: move it to someone who is working. */
  needsMove?: boolean;
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null; phone: string };
  treatmentPlan: { id: string; title: string; planNo: string } | null;
}

/** A patient in ongoing care who still needs a visit on the planned day. */
export interface PlannerCandidate {
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null; phone: string };
  category: PatientCategory;
  lastVisitAt: string | null;
  completedVisits: number;
  plan: { id: string; planNo: string; title: string; frequencyPerWeek: number; prescribedSessions: number; sessionsBooked: number; full: boolean } | null;
  package: { id: string; name: string; remaining: number; expiryDate: string } | null;
  type: "THERAPY_SESSION" | "FOLLOW_UP_CONSULTATION" | "INITIAL_CONSULTATION";
  therapistId: string | null;
  therapistOnLeave: boolean;
  usualTime: string | null;
  suggestedSlotId: string | null;
  suggestedIsUsual: boolean;
  /** The patient's usual physio, and whether they are away that day (another physio covers). */
  regularTherapistId: string | null;
  regularTherapistName: string | null;
  regularAway: boolean;
  regularAwayReason: "ON_LEAVE" | "NOT_WORKING" | null;
  /** Planned with someone other than the regular physio. */
  covering: boolean;
}

export interface PlannerDay {
  date: string;
  therapists: PlannerTherapist[];
  slots: PlannerSlot[];
  appointments: PlannerAppointment[];
  toPlan: PlannerCandidate[];
}

export interface PlannerBookResult {
  booked: number;
  failed: number;
  results: { patientId: string; slotId: string; ok: boolean; appointmentId?: string; appointmentNo?: string; error?: string; code?: string }[];
}

/* ─────────────── Consultations ─────────────── */

export interface Assessment {
  id: string;
  painScore: number;
  painLocation: string | null;
  painType: string | null;
  aggravatingFactors: string | null;
  relievingFactors: string | null;
  posture: string | null;
  rangeOfMotion: Record<string, string> | null;
  muscleStrength: Record<string, string> | null;
  specialTests: { name: string; result: string }[] | null;
  mobilityStatus: string | null;
  gait: string | null;
  observations: string | null;
  diagnosis: string | null;
}

export interface Consultation {
  id: string;
  appointmentId: string;
  status: "DRAFT" | "FINAL";
  finalizedAt: string | null;
  isFollowUp: boolean;
  chiefComplaint: string | null;
  symptoms: string | null;
  historyOfIllness: string | null;
  clinicalImpression: string | null;
  recommendations: string | null;
  followUpDate: string | null;
  createdAt: string;
  updatedAt: string;
  assessment: Assessment | null;
  therapist: { id: string; user: { name: string } };
  treatmentPlan: { id: string; planNo: string; title: string; status: string } | null;
}

export interface ConsultationHistoryEntry {
  id: string;
  at: string;
  by: string;
  role: string | null;
  part: "Notes" | "Assessment";
  action: "Written" | "Edited";
  fields: string[];
}

/** Sent with 409 ACTIVE_PLAN_EXISTS when activating a second plan for a patient. */
export interface ActivePlanConflict {
  planId: string;
  planNo: string;
  title: string;
  upcomingVisits: number;
}

/* ─────────────── Reports ─────────────── */

export interface MonthlyRow {
  month: string; // YYYY-MM
  visits: number;
  completed: number;
  walkIns: number;
  scheduled: number;
  noShows: number;
  newPatients: number;
}

/* ─────────────── Analytics (Reports → Patients / Outcomes / Operations / Finance) ─────────────── */

export interface DateRange {
  from: string;
  to: string;
}

export interface PatientAnalytics {
  range: DateRange;
  totalPatients: number;
  newPatients: number;
  activePatients: number;
  returningPatients: number;
  returningRate: number;
  dropOffDays: number;
  dropOffCount: number;
  dropOffCapped: boolean;
  dropOffs: { id: string; patientCode: string; firstName: string; lastName: string | null; phone: string; lastVisit: string; visits: number; daysAgo: number }[];
  referralSources: { name: string; count: number }[];
  gender: { gender: string; count: number }[];
  ageGroups: { bucket: string; count: number }[];
  patientTypes: { type: string; count: number }[];
}

export interface OutcomeAnalytics {
  range: DateRange;
  sessionsCompleted: number;
  sessionsMeasured: number;
  avgPainBefore: number | null;
  avgPainAfter: number | null;
  avgPainReduction: number | null;
  reliefRate: number;
  avgProgressRating: number | null;
  activePlans: number;
  completedPlans: number;
  outcomes: { goalsMet: number; partiallyMet: number; notMet: number; discontinued: number; notRecorded: number };
  goalsMetRate: number;
  avgPrescribedSessions: number | null;
  avgSessionsDone: number | null;
  avgFinalPain: number | null;
  byTherapist: { therapistId: string; name: string; sessions: number; avgReduction: number | null; reliefRate: number; avgRating: number | null }[];
}

export interface OperationsAnalytics {
  range: DateRange;
  totalVisits: number;
  busiestDay: string | null;
  busiestHour: number | null;
  perDay: { day: string; count: number }[];
  perHour: { hour: number; count: number }[];
  heatmap: { hours: number[]; days: string[]; cells: { day: string; hour: number; count: number }[] };
  slotFillRate: number;
  slotsBooked: number;
  slotsUnused: number;
  homeVisitShare: number;
  byType: { type: string; count: number }[];
  avgSessionMinutes: number | null;
  sessionsTimed: number;
  perTherapist: { therapistId: string; name: string; colorTag: string | null; visits: number; completed: number; noShowRate: number; cancelRate: number }[];
}

export interface FinanceAnalytics {
  range: DateRange;
  previousRange: DateRange;
  netRevenue: number;
  previousNetRevenue: number;
  changePct: number | null;
  invoicesIssued: number;
  billed: number;
  collected: number;
  stillDue: number;
  collectionRate: number;
  paymentMethods: { method: string; total: number; count: number; share: number }[];
  completedVisits: number;
  revenuePerVisit: number | null;
  payingPatients: number;
  revenuePerPatient: number | null;
  packagesSold: number;
  packageRevenue: number;
  packageSessionsRedeemed: number | null;
}
