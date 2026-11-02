export type AppointmentType = "INITIAL_CONSULTATION" | "FOLLOW_UP_CONSULTATION" | "THERAPY_SESSION" | "HOME_VISIT";

export interface Appointment {
  id: string;
  appointmentNo: string;
  type: AppointmentType;
  status: string;
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
  todayAppointments: number;
  pendingAppointments: number;
  completedSessionsToday: number;
  availableTherapists: number;
  revenueToday: number | null;
  revenueMonth: number | null;
  therapistUtilization: { therapistId: string; name: string; colorTag: string | null; onLeave: boolean; booked: number; total: number; percent: number }[];
}

export interface PatientListItem {
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
}

export interface PatientDetail {
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
  specializations: string[];
  slots: { slotId: string; startAt: string; endAt: string }[];
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
