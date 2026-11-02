export interface Patient {
  id: string;
  patientCode: string;
  firstName: string;
  lastName: string | null;
  gender: "MALE" | "FEMALE" | "OTHER";
  dateOfBirth: string | null;
  phone: string;
  email: string | null;
  referredBy: string | null;
  consentGiven: boolean;
  createdAt: string;
  packages?: { id: string; remainingSessions: number; expiryDate: string }[];
  treatmentPlans?: { id: string; title: string }[];
  primaryTherapistId?: string | null;
  primaryTherapist?: { id: string; colorTag: string | null; user: { name: string } } | null;
}

export interface Therapist {
  id: string;
  qualification: string;
  experienceYears: number;
  colorTag: string | null;
  isAvailableForHomeVisit: boolean;
  isActive: boolean;
  user: { id: string; name: string; email: string | null; phone: string; hasPin?: boolean };
  specializations: { specialization: { id: string; name: string } }[];
}

export interface Appointment {
  id: string;
  appointmentNo: string;
  type: string;
  status: string;
  startAt: string;
  endAt: string;
  notes: string | null;
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null; phone: string };
  therapist: { id: string; colorTag: string | null; user: { name: string } };
  treatmentPlan: { id: string; title: string } | null;
  therapySession: { id: string; status: string; sessionNumber: number | null } | null;
  consultation: { id: string } | null;
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
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null };
  therapist: { id: string; user: { name: string } };
  items: { id: string; category: string; name: string; sets: number | null; reps: number | null; durationMinutes: number | null }[];
  patientPackages: { id: string; remainingSessions: number; status: string; expiryDate: string }[];
}

export interface PackageDef {
  id: string;
  name: string;
  tier: string;
  description: string | null;
  sessionCount: number;
  validityDays: number;
  price: string;
  includesHomeVisit: boolean;
  isActive: boolean;
}

export interface PatientPackage {
  id: string;
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  pricePaid: string;
  startDate: string;
  expiryDate: string;
  status: string;
  package: PackageDef;
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null };
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
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null };
}

export interface Slot {
  slotId: string;
  startAt: string;
  endAt: string;
}

export interface AvailabilityRow {
  therapistId: string;
  therapistName: string;
  colorTag: string | null;
  specializations: string[];
  slots: Slot[];
}
