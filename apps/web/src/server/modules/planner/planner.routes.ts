import { Router } from "../../router";
import { z } from "zod";
import { prisma, type AppointmentType } from "@movement-hub/database";
import { handler, ok } from "../../lib/http";
import { audit } from "../../lib/audit";
import { HttpError } from "../../lib/http-error";
import { addDays, dateOnly, dayRange, localTimeString, todayLocal } from "../../lib/time";
import { authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { book } from "../appointments/appointment.service";
import { generateSlots } from "../scheduling/scheduling.service";
import { visitStats } from "../patients/patient-stats";

/**
 * Day planner — replaces the clinic whiteboard. For one day (tomorrow by default) it shows every
 * physio's free / booked slots, the visits already booked, and the patients in ongoing care who
 * still need a visit that day, each with a suggested physio, time, visit type and package.
 * The front desk (physios run it too) books the whole list in one go, and moves visits between
 * physios when someone is unavailable.
 */
export const plannerRouter = Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LIVE = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"] as const;
const UPCOMING = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] as const;
/** Regulars without a plan are suggested only if they were seen this recently. */
const RECENT_DAYS = 45;

const mode = <T>(values: T[]): T | null => {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
};
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

plannerRouter.get(
  "/",
  authorize("RECEPTIONIST", "ADMIN"),
  validate({ query: z.object({ date: date.optional(), therapistId: z.string().uuid().optional() }) }),
  handler(async (req, res) => {
    const day = (req.query.date as string | undefined) ?? addDays(todayLocal(), 1);
    // A physio plans their own day only (their slots, visits and patients); the Super Admin sees
    // every physio and may narrow to one.
    const mine = req.user!.role === "PHYSIOTHERAPIST" ? req.user!.therapistId ?? "__none__" : undefined;
    const onlyTherapist = mine ?? (req.query.therapistId as string | undefined);
    const range = dayRange(day);

    const therapists = await prisma.therapist.findMany({
      where: { isActive: true, ...(mine ? { id: mine } : {}) },
      select: {
        id: true,
        colorTag: true,
        isAvailableForHomeVisit: true,
        user: { select: { name: true } },
        leaves: { where: { status: "APPROVED", startDate: { lt: range.lt }, endDate: { gt: range.gte } }, select: { id: true } },
      },
      orderBy: { user: { name: "asc" } },
    });
    // The hourly job keeps 30 days of slots; only fill in a day that has none yet (e.g. the job
    // hasn't run since a physio was added), so the planner's frequent refreshes stay cheap.
    if (day >= todayLocal() && !(await prisma.therapistSlot.count({ where: { startAt: range } }))) {
      await Promise.all(therapists.map((t) => generateSlots(t.id, day, day)));
    }

    const [slots, appointments, bookedAnywhere] = await Promise.all([
      prisma.therapistSlot.findMany({
        where: { startAt: range, therapistId: { in: therapists.map((t) => t.id) } },
        select: { id: true, therapistId: true, startAt: true, endAt: true, status: true },
        orderBy: { startAt: "asc" },
      }),
      prisma.appointment.findMany({
        where: { startAt: range, status: { in: [...LIVE] }, ...(mine ? { therapistId: mine } : {}) },
        orderBy: { startAt: "asc" },
        include: {
          patient: { select: { id: true, patientCode: true, firstName: true, lastName: true, phone: true } },
          treatmentPlan: { select: { id: true, title: true, planNo: true } },
        },
      }),
      // Anyone already booked that day (with any physio) doesn't need planning again.
      prisma.appointment.findMany({ where: { startAt: range, status: { in: [...LIVE] } }, select: { patientId: true }, distinct: ["patientId"] }),
    ]);

    /* ── patients who still need a visit that day ── */
    const bookedIds = bookedAnywhere.map((a) => a.patientId);
    const recent = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    const ongoing = [
      { treatmentPlans: { some: { status: "ACTIVE" as const, deletedAt: null } } },
      { primaryTherapistId: { not: null }, appointments: { some: { status: "COMPLETED" as const, startAt: { gte: recent } } } },
    ];
    const candidates = await prisma.patient.findMany({
      where: {
        deletedAt: null,
        id: { notIn: bookedIds },
        AND: [
          { OR: ongoing },
          ...(onlyTherapist ? [{ OR: [{ primaryTherapistId: onlyTherapist }, { treatmentPlans: { some: { status: "ACTIVE" as const, therapistId: onlyTherapist } } }] }] : []),
        ],
      },
      select: {
        id: true,
        patientCode: true,
        firstName: true,
        lastName: true,
        phone: true,
        primaryTherapistId: true,
        treatmentPlans: {
          where: { status: "ACTIVE", deletedAt: null },
          orderBy: { activatedAt: "desc" },
          take: 1,
          select: { id: true, planNo: true, title: true, therapistId: true, prescribedSessions: true, frequencyPerWeek: true },
        },
        packages: {
          where: { status: "ACTIVE", expiryDate: { gte: dateOnly(day) } },
          orderBy: { expiryDate: "asc" },
          select: { id: true, remainingSessions: true, expiryDate: true, treatmentPlanId: true, package: { select: { name: true } } },
        },
      },
      take: 200,
    });

    const ids = candidates.map((c) => c.id);
    const planIds = candidates.flatMap((c) => c.treatmentPlans.map((p) => p.id));
    const pkgIds = candidates.flatMap((c) => c.packages.map((p) => p.id));
    const [history, planSessions, reserved, stats] = await Promise.all([
      // Recent visits tell us each patient's usual time and physio.
      prisma.appointment.findMany({
        where: { patientId: { in: ids }, startAt: { lt: range.gte }, status: { in: ["COMPLETED", ...UPCOMING] } },
        orderBy: { startAt: "desc" },
        take: Math.min(ids.length * 10, 3000),
        select: { patientId: true, therapistId: true, startAt: true },
      }),
      prisma.therapySession.groupBy({ by: ["treatmentPlanId"], where: { treatmentPlanId: { in: planIds }, status: { not: "CANCELLED" } }, _count: { _all: true } }),
      prisma.therapySession.groupBy({ by: ["patientPackageId"], where: { patientPackageId: { in: pkgIds }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } }, _count: { _all: true } }),
      visitStats(candidates.map((c) => ({ id: c.id, primaryTherapistId: c.primaryTherapistId, activePlans: c.treatmentPlans.length }))),
    ]);
    const sessionsBy = new Map(planSessions.map((p) => [p.treatmentPlanId, p._count._all]));
    const reservedBy = new Map(reserved.map((p) => [p.patientPackageId, p._count._all]));
    const historyBy = new Map<string, { therapistId: string; time: string }[]>();
    for (const h of history) {
      const list = historyBy.get(h.patientId) ?? [];
      if (list.length < 10) list.push({ therapistId: h.therapistId, time: localTimeString(h.startAt) });
      historyBy.set(h.patientId, list);
    }
    const onLeave = new Set(therapists.filter((t) => t.leaves.length).map((t) => t.id));
    const taken = new Set<string>(); // don't suggest the same free slot to two patients

    const toPlan = candidates
      .map((c) => {
        const plan = c.treatmentPlans[0] ?? null;
        const sessionsBooked = plan ? sessionsBy.get(plan.id) ?? 0 : 0;
        const planFull = !!plan && sessionsBooked >= plan.prescribedSessions;
        const type: AppointmentType = plan && !planFull ? "THERAPY_SESSION" : "FOLLOW_UP_CONSULTATION";
        const past = historyBy.get(c.id) ?? [];
        const usualTime = mode(past.map((p) => p.time));
        // A physio's own list is always planned with them.
        const therapistId = mine ?? plan?.therapistId ?? c.primaryTherapistId ?? mode(past.map((p) => p.therapistId));
        // Package: the one sold for this plan first, then any other with sessions left.
        const usable = c.packages.filter((p) => p.remainingSessions - (reservedBy.get(p.id) ?? 0) > 0);
        const pkg = type === "THERAPY_SESSION" ? usable.find((p) => p.treatmentPlanId === plan?.id) ?? usable[0] ?? null : null;

        // Suggest the usual time with the usual physio; otherwise that physio's nearest free slot.
        let slot: (typeof slots)[number] | null = null;
        let exact = false;
        if (therapistId && !onLeave.has(therapistId)) {
          const free = slots.filter((s) => s.therapistId === therapistId && s.status === "AVAILABLE" && !taken.has(s.id) && s.startAt > new Date());
          if (usualTime) {
            slot = free.find((s) => localTimeString(s.startAt) === usualTime) ?? null;
            exact = !!slot;
            slot ??= [...free].sort((a, b) => Math.abs(minutesOf(localTimeString(a.startAt)) - minutesOf(usualTime)) - Math.abs(minutesOf(localTimeString(b.startAt)) - minutesOf(usualTime)))[0] ?? null;
          } else slot = free[0] ?? null;
          if (slot) taken.add(slot.id);
        }
        const s = stats.get(c.id);
        return {
          patient: { id: c.id, patientCode: c.patientCode, firstName: c.firstName, lastName: c.lastName, phone: c.phone },
          category: s?.category ?? "NEW",
          lastVisitAt: s?.lastVisitAt ?? null,
          completedVisits: s?.completedVisits ?? 0,
          plan: plan ? { id: plan.id, planNo: plan.planNo, title: plan.title, frequencyPerWeek: plan.frequencyPerWeek, prescribedSessions: plan.prescribedSessions, sessionsBooked, full: planFull } : null,
          package: pkg ? { id: pkg.id, name: pkg.package.name, remaining: pkg.remainingSessions - (reservedBy.get(pkg.id) ?? 0), expiryDate: pkg.expiryDate } : null,
          type,
          therapistId,
          therapistOnLeave: !!therapistId && onLeave.has(therapistId),
          usualTime,
          suggestedSlotId: slot?.id ?? null,
          suggestedIsUsual: exact,
        };
      })
      // Patients with an active plan first, then the most recently seen.
      .sort((a, b) => Number(!!b.plan) - Number(!!a.plan) || (b.lastVisitAt?.getTime() ?? 0) - (a.lastVisitAt?.getTime() ?? 0));

    const summary = therapists.map((t) => {
      const mine = slots.filter((s) => s.therapistId === t.id);
      const free = mine.filter((s) => s.status === "AVAILABLE" && s.startAt > new Date()).length;
      const booked = mine.filter((s) => s.status === "BOOKED").length;
      const blocked = mine.filter((s) => s.status === "BLOCKED").length;
      return {
        id: t.id,
        name: t.user.name,
        colorTag: t.colorTag,
        homeVisits: t.isAvailableForHomeVisit,
        onLeave: t.leaves.length > 0,
        slots: { total: mine.length, free, booked, blocked },
        full: mine.length > 0 && free === 0,
      };
    });

    ok(res, {
      date: day,
      therapists: summary,
      slots,
      appointments: appointments.map((a) => ({
        id: a.id,
        appointmentNo: a.appointmentNo,
        type: a.type,
        status: a.status,
        source: a.source,
        startAt: a.startAt,
        endAt: a.endAt,
        therapistId: a.therapistId,
        patient: a.patient,
        treatmentPlan: a.treatmentPlan,
      })),
      toPlan,
    });
  }),
);

const bookItem = z.object({
  patientId: z.string().uuid(),
  slotId: z.string().uuid(),
  type: z.enum(["INITIAL_CONSULTATION", "FOLLOW_UP_CONSULTATION", "THERAPY_SESSION"]),
  treatmentPlanId: z.string().uuid().optional(),
  patientPackageId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * Book many planned visits at once. Each one is booked on its own, so one taken slot doesn't
 * stop the rest; the response says which succeeded and why any failed.
 */
plannerRouter.post(
  "/book",
  authorize("RECEPTIONIST", "ADMIN"),
  validate({ body: z.object({ items: z.array(bookItem).min(1).max(60) }) }),
  handler(async (req, res) => {
    const items = req.body.items as z.infer<typeof bookItem>[];
    const results: { patientId: string; slotId: string; ok: boolean; appointmentId?: string; appointmentNo?: string; error?: string; code?: string }[] = [];
    // A physio books into their own time only.
    const mine = req.user!.role === "PHYSIOTHERAPIST" ? req.user!.therapistId : null;
    const own = mine ? new Set((await prisma.therapistSlot.findMany({ where: { id: { in: items.map((i) => i.slotId) }, therapistId: mine }, select: { id: true } })).map((x) => x.id)) : null;
    for (const item of items) {
      if (own && !own.has(item.slotId)) {
        results.push({ patientId: item.patientId, slotId: item.slotId, ok: false, error: "You can only book into your own time slots.", code: "NOT_YOUR_SLOT" });
        continue;
      }
      try {
        const a = await book({ ...item, source: "SCHEDULED", notes: item.notes ?? "Booked from the day planner" }, req.user!.id);
        await audit(req, "CREATE", "Appointment", a.id, null, { ...a, via: "planner" });
        results.push({ patientId: item.patientId, slotId: item.slotId, ok: true, appointmentId: a.id, appointmentNo: a.appointmentNo });
      } catch (e) {
        const known = e instanceof HttpError;
        if (!known) console.error("[planner] booking failed:", e);
        results.push({ patientId: item.patientId, slotId: item.slotId, ok: false, error: known ? e.message : "Could not book this visit. Please try again.", code: known ? e.code : "ERROR" });
      }
    }
    ok(res, { booked: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  }),
);
