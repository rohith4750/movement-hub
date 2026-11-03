import { prisma } from "@movement-hub/database";

/**
 * How a patient relates to the clinic, shown as a label on lists and when booking.
 * - NEW: has not completed a visit yet.
 * - REGULAR: ongoing care — has a regular physio or an active treatment plan.
 * - OCCASIONAL: has been before, but has no ongoing care (e.g. a one-off or walk-in visit).
 */
export type PatientCategory = "NEW" | "REGULAR" | "OCCASIONAL";

export interface VisitStats {
  completedVisits: number;
  lastVisitAt: Date | null;
  nextVisitAt: Date | null;
  category: PatientCategory;
}

const UPCOMING = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] as const;

export function categoryOf(completedVisits: number, ongoingCare: boolean): PatientCategory {
  if (completedVisits === 0) return "NEW";
  return ongoingCare ? "REGULAR" : "OCCASIONAL";
}

/** Visit counts for many patients in two grouped queries (no per-patient round trips). */
export async function visitStats(patients: { id: string; primaryTherapistId: string | null; activePlans: number }[]): Promise<Map<string, VisitStats>> {
  const ids = patients.map((p) => p.id);
  if (!ids.length) return new Map();
  const [done, upcoming] = await Promise.all([
    prisma.appointment.groupBy({ by: ["patientId"], where: { patientId: { in: ids }, status: "COMPLETED" }, _count: { _all: true }, _max: { startAt: true } }),
    // "Next" includes a visit that is happening right now (e.g. a walk-in who is checked in).
    prisma.appointment.groupBy({ by: ["patientId"], where: { patientId: { in: ids }, status: { in: [...UPCOMING] }, endAt: { gt: new Date() } }, _min: { startAt: true } }),
  ]);
  const doneBy = new Map(done.map((d) => [d.patientId, d]));
  const nextBy = new Map(upcoming.map((u) => [u.patientId, u._min.startAt]));
  return new Map(
    patients.map((p) => {
      const d = doneBy.get(p.id);
      const completedVisits = d?._count._all ?? 0;
      return [
        p.id,
        {
          completedVisits,
          lastVisitAt: d?._max.startAt ?? null,
          nextVisitAt: nextBy.get(p.id) ?? null,
          category: categoryOf(completedVisits, !!p.primaryTherapistId || p.activePlans > 0),
        },
      ];
    }),
  );
}
