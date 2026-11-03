import { Router, type Request } from "../../router";
import { z } from "zod";
import { prisma, type Prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http";
import { audit } from "../../lib/audit";
import { badRequest, forbidden, unprocessable } from "../../lib/http-error";
import { addDays, dateOnly, dayRange, localDateTime, localDayCode, todayLocal } from "../../lib/time";
import { assertPatientAccess, authorize, isPatient, scopePatient, STAFF } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { afterBooked, book, bookInTx, cancel, deleteAppointment, editAppointment, reschedule, transition } from "./appointment.service";
import { generateSlots } from "../scheduling/scheduling.service";

export const appointmentRouter = Router();
export const waitlistRouter = Router();

const type = z.enum(["INITIAL_CONSULTATION", "FOLLOW_UP_CONSULTATION", "THERAPY_SESSION", "HOME_VISIT"]);
const status = z.enum(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const include = {
  patient: { select: { id: true, patientCode: true, firstName: true, lastName: true, phone: true } },
  therapist: { select: { id: true, colorTag: true, user: { select: { name: true } } } },
  treatmentPlan: { select: { id: true, title: true } },
  therapySession: { select: { id: true, status: true, sessionNumber: true, patientPackageId: true } },
  consultation: { select: { id: true } },
  homeVisit: { select: { id: true, status: true } },
} satisfies Prisma.AppointmentInclude;

/** Load and check that a patient user owns the appointment. */
async function loadOwned(req: Request, id: string) {
  const a = await prisma.appointment.findUniqueOrThrow({ where: { id } });
  assertPatientAccess(req as never, a.patientId);
  // In Movement Hub, every physiotherapist can view and manage clinic appointments
  return { a, own: true };
}

const listQuery = paginationQuery.extend({
  date: date.optional(),
  from: date.optional(),
  to: date.optional(),
  therapistId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: status.optional(),
  type: type.optional(),
  source: z.enum(["SCHEDULED", "WALK_IN"]).optional(),
});

appointmentRouter.get(
  "/",
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const from = query.date ?? query.from;
    const to = query.date ?? query.to;
    const where: Prisma.AppointmentWhereInput = {
      therapistId: query.therapistId,
      patientId: scopePatient(req, query.patientId),
      status: query.status,
      type: query.type,
      source: query.source,
      ...(from || to ? { startAt: { ...(from ? { gte: dayRange(from).gte } : {}), ...(to ? { lt: dayRange(to).lt } : {}) } } : {}),
      ...(query.search
        ? { OR: [{ appointmentNo: { contains: query.search, mode: "insensitive" } }, { patient: { firstName: { contains: query.search, mode: "insensitive" } } }, { patient: { phone: { contains: query.search } } }] }
        : {}),
    };
    const [data, total] = await Promise.all([
      prisma.appointment.findMany({ where, include, ...paging(query), orderBy: { startAt: query.sort === "startAt:desc" ? "desc" : "asc" } }),
      prisma.appointment.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

appointmentRouter.get(
  "/today",
  authorize(...STAFF),
  handler(async (req, res) => {
    const therapistId = (req.query.therapistId as string | undefined) ?? undefined;
    ok(res, await prisma.appointment.findMany({ where: { startAt: dayRange(todayLocal()), ...(therapistId ? { therapistId } : {}) }, include, orderBy: { startAt: "asc" } }));
  }),
);

const bookBody = z.object({
  patientId: z.string().uuid().optional(),
  slotId: z.string().uuid(),
  type,
  treatmentPlanId: z.string().uuid().optional(),
  patientPackageId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
  source: z.enum(["SCHEDULED", "WALK_IN"]).default("SCHEDULED"),
});

appointmentRouter.post(
  "/",
  authorize("RECEPTIONIST", "ADMIN", "PATIENT"),
  validate({ body: bookBody }),
  handler(async (req, res) => {
    const patientId = scopePatient(req, req.body.patientId);
    if (!patientId) throw badRequest("patientId is required");
    if (req.body.type === "HOME_VISIT") throw badRequest("Use POST /home-visits to book home visits");
    const a = await book({ ...req.body, patientId }, req.user!.id);
    await audit(req, "CREATE", "Appointment", a.id, null, a);
    created(res, await prisma.appointment.findUnique({ where: { id: a.id }, include }));
  }),
);

const WEEKDAY = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
const ACTIVE_STATUSES = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] as const;

/**
 * Plan a repeating series before booking it: for each chosen weekday over N weeks at the same time
 * with the same physio, says whether that slot can be booked — and if not, why. Slots beyond the
 * usual 30-day horizon are generated on demand from the physio's weekly schedule.
 */
appointmentRouter.post(
  "/recurring/preview",
  authorize("RECEPTIONIST", "ADMIN"),
  validate({
    body: z.object({
      patientId: z.string().uuid(),
      therapistId: z.string().uuid(),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      from: date,
      weekdays: z.array(WEEKDAY).min(1),
      weeks: z.number().int().min(1).max(12),
      patientPackageId: z.string().uuid().optional(),
    }),
  }),
  handler(async (req, res) => {
    const b = req.body as { patientId: string; therapistId: string; time: string; from: string; weekdays: z.infer<typeof WEEKDAY>[]; weeks: number; patientPackageId?: string };
    const therapist = await prisma.therapist.findFirst({ where: { id: b.therapistId, isActive: true } });
    if (!therapist) throw badRequest("Physiotherapist not found or inactive", "THERAPIST_NOT_FOUND");
    const from = b.from < todayLocal() ? todayLocal() : b.from;
    const to = addDays(from, b.weeks * 7 - 1);
    await generateSlots(b.therapistId, from, to);

    const dates: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (b.weekdays.includes(localDayCode(d))) dates.push(d);
    const starts = dates.map((d) => localDateTime(d, b.time));

    const [slots, clashes, pkg] = await Promise.all([
      prisma.therapistSlot.findMany({ where: { therapistId: b.therapistId, startAt: { in: starts } }, select: { id: true, startAt: true, endAt: true, status: true } }),
      prisma.appointment.findMany({
        where: { patientId: b.patientId, status: { in: [...ACTIVE_STATUSES] }, startAt: { lt: dayRange(to).lt }, endAt: { gt: dayRange(from).gte } },
        select: { appointmentNo: true, startAt: true, endAt: true },
      }),
      b.patientPackageId ? prisma.patientPackage.findUnique({ where: { id: b.patientPackageId }, select: { expiryDate: true, remainingSessions: true } }) : null,
    ]);
    const bySlotStart = new Map(slots.map((sl) => [sl.startAt.getTime(), sl]));
    const now = Date.now();

    const items = dates.map((d, i) => {
      const startAt = starts[i];
      const sl = bySlotStart.get(startAt.getTime());
      let reason: string | null = null;
      if (startAt.getTime() <= now) reason = "Time has passed";
      else if (!sl) reason = "Physio not working at this time (day off, break or leave)";
      else if (sl.status === "BOOKED") reason = "Physio already booked";
      else if (sl.status === "BLOCKED") reason = "Slot blocked";
      else {
        const clash = clashes.find((c) => c.startAt < sl.endAt && c.endAt > sl.startAt);
        if (clash) reason = `Patient already has ${clash.appointmentNo}`;
        else if (pkg && sl.startAt > pkg.expiryDate) reason = "After the package expires";
      }
      return { date: d, startAt: startAt.toISOString(), slotId: sl?.id ?? null, ok: !reason, reason };
    });
    ok(res, { items, available: items.filter((x) => x.ok).length, packageRemaining: pkg?.remainingSessions ?? null });
  }),
);

/** Book a series of therapy sessions for a plan: one slot per chosen date with same therapist & time. */
appointmentRouter.post(
  "/recurring",
  authorize("RECEPTIONIST", "ADMIN"),
  validate({
    body: z.object({
      patientId: z.string().uuid(),
      treatmentPlanId: z.string().uuid(),
      patientPackageId: z.string().uuid().optional(),
      slotIds: z.array(z.string().uuid()).min(1).max(60),
      notes: z.string().optional(),
    }),
  }),
  handler(async (req, res) => {
    const { slotIds, ...rest } = req.body;
    // All-or-nothing: if any slot is taken the whole series is rejected.
    const list = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const slotId of slotIds as string[]) out.push(await bookInTx(tx, { ...rest, slotId, type: "THERAPY_SESSION" }, req.user!.id));
      return out;
    });
    for (const a of list) await afterBooked(a.id);
    await audit(req, "CREATE", "Appointment", null, null, { recurring: list.map((a) => a.id) });
    created(res, list);
  }),
);

appointmentRouter.get(
  "/:id",
  validate({ params: idParam }),
  handler(async (req, res) => {
    const a = await prisma.appointment.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { ...include, history: { orderBy: { createdAt: "asc" } }, slot: true },
    });
    assertPatientAccess(req, a.patientId);
    ok(res, a);
  }),
);

/** `clinical` actions (start/complete a visit) are limited to the treating physio; front-desk actions (confirm, check-in, no-show) are open to any physio. */
function statusRoute(path: string, to: z.infer<typeof status>, roles: Parameters<typeof authorize>, extra: () => Prisma.AppointmentUpdateInput = () => ({}), clinical = false) {
  appointmentRouter.patch(
    `/:id/${path}`,
    authorize(...roles),
    validate({ params: idParam, body: z.object({ note: z.string().optional() }).default({}) }),
    handler(async (req, res) => {
      const { own } = await loadOwned(req, req.params.id);
      if (to === "COMPLETED") {
        const draft = await prisma.consultation.findFirst({ where: { appointmentId: req.params.id, status: "DRAFT", deletedAt: null }, select: { id: true } });
        if (draft) throw unprocessable("CONSULTATION_DRAFT", "The consultation notes are still a draft. Finish them before completing the visit.");
      }
      // In a transaction so transition()'s row lock holds until the change is committed.
      const a = await prisma.$transaction((tx) => transition(tx, req.params.id, to, req.user!.id, req.body.note, extra()));
      if (to === "NO_SHOW") await prisma.therapySession.updateMany({ where: { appointmentId: a.id }, data: { status: "MISSED" } });
      await audit(req, "UPDATE", "Appointment", a.id, null, { status: to });
      ok(res, a);
    }),
  );
}

statusRoute("confirm", "CONFIRMED", ["RECEPTIONIST", "ADMIN"]);
statusRoute("check-in", "CHECKED_IN", ["RECEPTIONIST", "ADMIN"], () => ({ checkedInAt: new Date() }));
statusRoute("start", "IN_PROGRESS", ["PHYSIOTHERAPIST"], undefined, true);
statusRoute("complete", "COMPLETED", ["PHYSIOTHERAPIST"], () => ({ completedAt: new Date() }), true);
statusRoute("no-show", "NO_SHOW", ["RECEPTIONIST", "PHYSIOTHERAPIST", "ADMIN"]);

appointmentRouter.post(
  "/:id/reschedule",
  authorize("RECEPTIONIST", "ADMIN", "PATIENT"),
  validate({ params: idParam, body: z.object({ newSlotId: z.string().uuid(), reason: z.string().optional() }) }),
  handler(async (req, res) => {
    await loadOwned(req, req.params.id);
    const a = await reschedule(req.params.id, req.body.newSlotId, req.user!.id, req.body.reason);
    await audit(req, "UPDATE", "Appointment", req.params.id, null, { rescheduledTo: a.id });
    ok(res, await prisma.appointment.findUnique({ where: { id: a.id }, include }));
  }),
);

appointmentRouter.post(
  "/:id/cancel",
  authorize("RECEPTIONIST", "ADMIN", "PATIENT"),
  validate({ params: idParam, body: z.object({ reason: z.string().min(2).max(500) }) }),
  handler(async (req, res) => {
    await loadOwned(req, req.params.id);
    const a = await cancel(req.params.id, req.user!.id, req.body.reason, { enforceWindow: isPatient(req) });
    await audit(req, "UPDATE", "Appointment", a.id, null, { status: "CANCELLED", reason: req.body.reason });
    ok(res, a);
  }),
);

/**
 * Permanent delete is an admin-only correction tool (e.g. a duplicate booked by mistake).
 * Everyone else cancels instead, so the visit stays in the patient's history.
 */
appointmentRouter.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const deleted = await deleteAppointment(req.params.id, {
      force: true,
      userId: req.user!.id,
      record: (snapshot, tx) => audit(req, "DELETE", "Appointment", req.params.id, snapshot, null, tx),
    });
    ok(res, { deleted: true, appointmentNo: deleted.appointmentNo });
  }),
);

appointmentRouter.patch(
  "/:id",
  authorize("ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"),
  validate({
    params: idParam,
    body: z.object({
      notes: z.string().max(1000).nullable().optional(),
      type: type.optional(),
      treatmentPlanId: z.string().uuid().nullable().optional(),
    }),
  }),
  handler(async (req, res) => {
    const before = await prisma.appointment.findUniqueOrThrow({ where: { id: req.params.id } });
    const a = await editAppointment(req.params.id, req.body, req.user!.id);
    await audit(req, "UPDATE", "Appointment", a.id, { notes: before.notes, type: before.type, treatmentPlanId: before.treatmentPlanId }, req.body);
    ok(res, await prisma.appointment.findUnique({ where: { id: a.id }, include }));
  }),
);

/* ─────────────── Waitlist ─────────────── */

waitlistRouter.get(
  "/",
  authorize("RECEPTIONIST", "ADMIN"),
  validate({ query: z.object({ date: date.optional(), includeFulfilled: z.coerce.boolean().optional() }) }),
  handler(async (req, res) => {
    const query = q<{ date?: string; includeFulfilled?: boolean }>(req);
    ok(
      res,
      await prisma.waitlist.findMany({
        where: { isFulfilled: query.includeFulfilled ? undefined : false, preferredDate: query.date ? dateOnly(query.date) : { gte: dateOnly(todayLocal()), lt: dateOnly(addDays(todayLocal(), 60)) } },
        include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true } }, therapist: { select: { id: true, user: { select: { name: true } } } } },
        orderBy: [{ preferredDate: "asc" }, { createdAt: "asc" }],
      }),
    );
  }),
);

waitlistRouter.post(
  "/",
  authorize("RECEPTIONIST", "ADMIN", "PATIENT"),
  validate({
    body: z.object({
      patientId: z.string().uuid().optional(),
      therapistId: z.string().uuid().optional(),
      type,
      preferredDate: date,
      preferredFrom: z.string().optional(),
      preferredTo: z.string().optional(),
    }),
  }),
  handler(async (req, res) => {
    const patientId = scopePatient(req, req.body.patientId);
    if (!patientId) throw badRequest("patientId is required");
    created(res, await prisma.waitlist.create({ data: { ...req.body, patientId, preferredDate: dateOnly(req.body.preferredDate) } }));
  }),
);

waitlistRouter.patch(
  "/:id/fulfil",
  authorize("RECEPTIONIST", "ADMIN"),
  validate({ params: idParam }),
  handler(async (req, res) => ok(res, await prisma.waitlist.update({ where: { id: req.params.id }, data: { isFulfilled: true } }))),
);

waitlistRouter.delete(
  "/:id",
  authorize("RECEPTIONIST", "ADMIN", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const w = await prisma.waitlist.findUniqueOrThrow({ where: { id: req.params.id } });
    assertPatientAccess(req, w.patientId);
    await prisma.waitlist.delete({ where: { id: w.id } });
    ok(res, { deleted: true });
  }),
);
