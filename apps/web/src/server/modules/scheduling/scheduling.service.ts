import { prisma, type AppointmentType } from "@movement-hub/database";
import { addDays, addMinutes, dayRange, localDateString, localDateTime, localDayCode } from "../../lib/time";
import { badRequest } from "../../lib/http-error";

/**
 * Create AVAILABLE slots for a therapist between two local dates (inclusive),
 * from their weekly template, skipping breaks and approved leave.
 * Existing slots are left untouched (unique therapistId+startAt).
 */
export async function generateSlots(therapistId: string, from: string, to: string) {
  if (to < from) throw badRequest("'to' must be on or after 'from'");
  const [schedules, leaves] = await Promise.all([
    prisma.therapistSchedule.findMany({ where: { therapistId, isActive: true } }),
    prisma.therapistLeave.findMany({
      where: { therapistId, status: "APPROVED", endDate: { gte: localDateTime(from, "00:00") }, startDate: { lte: localDateTime(addDays(to, 1), "00:00") } },
    }),
  ]);
  const byDay = new Map(schedules.map((s) => [s.dayOfWeek, s]));
  const rows: { therapistId: string; startAt: Date; endAt: Date }[] = [];

  for (let d = from; d <= to; d = addDays(d, 1)) {
    const s = byDay.get(localDayCode(d));
    if (!s) continue;
    for (let t = s.startTime; addMinutes(t, s.slotMinutes) <= s.endTime; t = addMinutes(t, s.slotMinutes)) {
      const end = addMinutes(t, s.slotMinutes);
      if (s.breakStart && s.breakEnd && t < s.breakEnd && end > s.breakStart) continue;
      const startAt = localDateTime(d, t);
      const endAt = localDateTime(d, end);
      if (leaves.some((l) => startAt < l.endDate && endAt > l.startDate)) continue;
      rows.push({ therapistId, startAt, endAt });
    }
  }
  const result = await prisma.therapistSlot.createMany({ data: rows, skipDuplicates: true });
  return { created: result.count, considered: rows.length };
}

/** Block unbooked slots that fall inside a leave window. */
export async function blockSlotsForLeave(therapistId: string, startDate: Date, endDate: Date) {
  return prisma.therapistSlot.updateMany({
    where: { therapistId, status: "AVAILABLE", startAt: { lt: endDate }, endAt: { gt: startDate } },
    data: { status: "BLOCKED" },
  });
}

/** Free-slot count per clinic day, for the booking calendar ("Mon 3 · 12 free"). */
export async function availabilitySummary(opts: { from: string; days: number; therapistId?: string; type?: AppointmentType }) {
  const to = addDays(opts.from, opts.days - 1);
  const slots = await prisma.therapistSlot.findMany({
    where: {
      status: "AVAILABLE",
      startAt: { gte: dayRange(opts.from).gte, lt: dayRange(to).lt, gt: new Date() },
      therapistId: opts.therapistId,
      therapist: { isActive: true, user: { deletedAt: null }, ...(opts.type === "HOME_VISIT" ? { isAvailableForHomeVisit: true } : {}) },
    },
    select: { startAt: true },
  });
  const counts = new Map<string, number>();
  for (const s of slots) {
    const d = localDateString(s.startAt);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return Array.from({ length: opts.days }, (_, i) => {
    const d = addDays(opts.from, i);
    return { date: d, free: counts.get(d) ?? 0 };
  });
}

/**
 * Bookable slots per physio for a day, plus the booked / blocked ones and counts so the app can
 * draw a clear Available / Booked / Unavailable grid. With `walkIn`, the slot that is running
 * right now is still bookable (the patient is at the clinic).
 */
export async function availability(opts: { date: string; therapistId?: string; specializationId?: string; type?: AppointmentType; walkIn?: boolean }) {
  const now = new Date();
  const therapists = await prisma.therapist.findMany({
    where: {
      isActive: true,
      id: opts.therapistId,
      ...(opts.specializationId ? { specializations: { some: { specializationId: opts.specializationId } } } : {}),
      ...(opts.type === "HOME_VISIT" ? { isAvailableForHomeVisit: true } : {}),
    },
    include: {
      user: { select: { name: true } },
      specializations: { include: { specialization: true } },
      leaves: { where: { status: "APPROVED", startDate: { lt: dayRange(opts.date).lt }, endDate: { gt: dayRange(opts.date).gte } }, select: { id: true } },
      slots: {
        where: { startAt: dayRange(opts.date) },
        orderBy: { startAt: "asc" },
        select: { id: true, startAt: true, endAt: true, status: true },
      },
    },
    orderBy: { user: { name: "asc" } },
  });
  const bookable = (s: { startAt: Date; endAt: Date }) => (opts.walkIn ? s.endAt > now : s.startAt > now);
  return therapists.map((t) => {
    const free = t.slots.filter((s) => s.status === "AVAILABLE" && bookable(s));
    const taken = t.slots.filter((s) => s.status !== "AVAILABLE" && s.endAt > now);
    return {
      therapistId: t.id,
      therapistName: t.user.name,
      colorTag: t.colorTag,
      onLeave: t.leaves.length > 0,
      specializations: t.specializations.map((s) => s.specialization.name),
      slots: free.map((s) => ({ slotId: s.id, startAt: s.startAt, endAt: s.endAt })),
      /** Booked or blocked times still ahead today (or on that day), for the legend. */
      taken: taken.map((s) => ({ startAt: s.startAt, endAt: s.endAt, status: s.status as "BOOKED" | "BLOCKED" })),
      counts: { free: free.length, booked: t.slots.filter((s) => s.status === "BOOKED").length, blocked: t.slots.filter((s) => s.status === "BLOCKED").length },
    };
  });
}
