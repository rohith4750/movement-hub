import { Router } from "../../router";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, type Prisma } from "@movement-hub/database";
import { created, handler, idParam, ok, q } from "../../lib/http";
import { audit } from "../../lib/audit";
import { forbidden } from "../../lib/http-error";
import { addDays, dayRange, localDateTime, todayLocal } from "../../lib/time";
import { authorize, STAFF } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { phoneSchema } from "../../lib/validators";
import { blockSlotsForLeave, generateSlots } from "../scheduling/scheduling.service";
import { deleteStaffUser } from "../users/user.service";
import { pinFields, pinSchema } from "../../lib/pin";

export const therapistRouter = Router();
export const specializationRouter = Router();
export const slotRouter = Router();

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const day = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

const include = {
  user: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
  specializations: { include: { specialization: true } },
} satisfies Prisma.TherapistInclude;

const therapistBody = z.object({
  registrationNo: z.string().optional(),
  qualification: z.string().min(2),
  experienceYears: z.number().int().min(0).default(0),
  bio: z.string().optional(),
  colorTag: z.string().optional(),
  isAvailableForHomeVisit: z.boolean().default(false),
  specializationIds: z.array(z.string().uuid()).default([]),
});

/* ─────────────── Therapists ─────────────── */

const listQuery = z.object({ specializationId: z.string().uuid().optional(), homeVisit: z.coerce.boolean().optional(), includeInactive: z.coerce.boolean().optional() });

therapistRouter.get(
  "/",
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const list = await prisma.therapist.findMany({
      where: {
        user: { deletedAt: null },
        isActive: query.includeInactive ? undefined : true,
        isAvailableForHomeVisit: query.homeVisit,
        ...(query.specializationId ? { specializations: { some: { specializationId: query.specializationId } } } : {}),
      },
      // pinHash is read only to report whether a PIN exists; it is never sent to the client.
      include: { ...include, user: { select: { ...include.user.select, pinHash: true } } },
      orderBy: { createdAt: "asc" },
    });
    ok(res, list.map(({ user: { pinHash, ...user }, ...t }) => ({ ...t, user: { ...user, hasPin: !!pinHash } })));
  }),
);

therapistRouter.post(
  "/",
  authorize("ADMIN"),
  validate({
    body: therapistBody.extend({
      name: z.string().min(2),
      email: z.string().email().toLowerCase(),
      phone: phoneSchema,
      password: z.string().min(8, "Password must be at least 8 characters"),
      pin: pinSchema, // mobile-app PIN
    }),
  }),
  handler(async (req, res) => {
    const { name, email, phone, password, pin, specializationIds, ...profile } = req.body;
    const branchId = req.user!.branchId ?? (await prisma.branch.findFirstOrThrow()).id;
    const user = await prisma.user.create({
      data: {
        name, email, phone, role: "PHYSIOTHERAPIST", branchId, passwordHash: await bcrypt.hash(password, 10), ...(await pinFields(pin)),
        therapist: {
          create: { ...profile, branchId, specializations: { create: specializationIds.map((specializationId: string) => ({ specializationId })) } },
        },
      },
      include: { therapist: { include } },
    });
    await audit(req, "CREATE", "Therapist", user.therapist!.id, null, user.therapist);
    created(res, user.therapist);
  }),
);

therapistRouter.get("/:id", validate({ params: idParam }), handler(async (req, res) => {
  ok(res, await prisma.therapist.findUniqueOrThrow({ where: { id: req.params.id }, include: { ...include, schedules: true } }));
}));

therapistRouter.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: idParam, body: therapistBody.partial().extend({ name: z.string().min(2).optional(), phone: phoneSchema.optional() }) }),
  handler(async (req, res) => {
    const { specializationIds, name, phone, ...profile } = req.body;
    const t = await prisma.$transaction(async (tx) => {
      const current = await tx.therapist.findUniqueOrThrow({ where: { id: req.params.id } });
      if (name || phone) await tx.user.update({ where: { id: current.userId }, data: { name, phone } });
      if (specializationIds) {
        await tx.therapistSpecialization.deleteMany({ where: { therapistId: current.id } });
        await tx.therapistSpecialization.createMany({ data: specializationIds.map((specializationId: string) => ({ therapistId: current.id, specializationId })) });
      }
      return tx.therapist.update({ where: { id: current.id }, data: profile, include });
    });
    await audit(req, "UPDATE", "Therapist", t.id, null, req.body);
    ok(res, t);
  }),
);

therapistRouter.patch(
  "/:id/status",
  authorize("ADMIN"),
  validate({ params: idParam, body: z.object({ isActive: z.boolean() }) }),
  handler(async (req, res) => {
    const t = await prisma.therapist.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive, user: { update: { isActive: req.body.isActive } } } });
    if (!req.body.isActive) {
      await prisma.therapistSlot.updateMany({ where: { therapistId: t.id, status: "AVAILABLE", startAt: { gt: new Date() } }, data: { status: "BLOCKED" } });
    }
    await audit(req, "UPDATE", "Therapist", t.id, null, { isActive: t.isActive });
    ok(res, t);
  }),
);

therapistRouter.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const t = await prisma.therapist.findUniqueOrThrow({ where: { id: req.params.id } });
    const result = await deleteStaffUser(t.userId, req.user!.id);
    await audit(req, "DELETE", "Therapist", t.id, null, result);
    ok(res, result);
  }),
);

/* ─────────────── Weekly schedule ─────────────── */

const scheduleDay = z
  .object({ dayOfWeek: day, startTime: time, endTime: time, breakStart: time.optional(), breakEnd: time.optional(), slotMinutes: z.number().int().min(10).max(120).default(30) })
  .refine((d) => d.startTime < d.endTime, "startTime must be before endTime")
  .refine((d) => !d.breakStart === !d.breakEnd, "Provide both breakStart and breakEnd")
  .refine((d) => !d.breakStart || (d.breakStart >= d.startTime && d.breakEnd! <= d.endTime && d.breakStart < d.breakEnd!), "Break must be inside working hours");

therapistRouter.get("/:id/schedule", authorize(...STAFF), validate({ params: idParam }), handler(async (req, res) => {
  ok(res, await prisma.therapistSchedule.findMany({ where: { therapistId: req.params.id }, orderBy: { dayOfWeek: "asc" } }));
}));

therapistRouter.put(
  "/:id/schedule",
  authorize("ADMIN"),
  validate({ params: idParam, body: z.object({ days: z.array(scheduleDay).max(7), regenerateDays: z.number().int().min(0).max(90).default(0) }) }),
  handler(async (req, res) => {
    const days = req.body.days as z.infer<typeof scheduleDay>[];
    if (new Set(days.map((d) => d.dayOfWeek)).size !== days.length) throw forbidden("Each day can appear only once");
    await prisma.$transaction([
      prisma.therapistSchedule.deleteMany({ where: { therapistId: req.params.id } }),
      prisma.therapistSchedule.createMany({ data: days.map((d) => ({ ...d, therapistId: req.params.id })) }),
    ]);
    let generated = null;
    if (req.body.regenerateDays > 0) {
      // Drop future unbooked slots so they match the new template, then regenerate.
      await prisma.therapistSlot.deleteMany({ where: { therapistId: req.params.id, status: "AVAILABLE", startAt: { gt: new Date() }, appointment: null } });
      const from = todayLocal();
      generated = await generateSlots(req.params.id, from, addDays(from, req.body.regenerateDays));
    }
    await audit(req, "UPDATE", "TherapistSchedule", req.params.id, null, days);
    ok(res, { schedule: await prisma.therapistSchedule.findMany({ where: { therapistId: req.params.id } }), generated });
  }),
);

/* ─────────────── Leaves ─────────────── */

therapistRouter.get("/:id/leaves", authorize("ADMIN", "PHYSIOTHERAPIST"), validate({ params: idParam }), handler(async (req, res) => {
  ok(res, await prisma.therapistLeave.findMany({ where: { therapistId: req.params.id }, orderBy: { startDate: "desc" } }));
}));

therapistRouter.post(
  "/:id/leaves",
  authorize("ADMIN", "PHYSIOTHERAPIST"),
  validate({
    params: idParam,
    body: z.object({ startDate: date, endDate: date, startTime: time.default("00:00"), endTime: time.default("23:59"), reason: z.string().optional() }).refine((b) => b.startDate <= b.endDate, "startDate must be before endDate"),
  }),
  handler(async (req, res) => {
    if (req.user!.role === "PHYSIOTHERAPIST" && req.user!.therapistId !== req.params.id) throw forbidden();
    const isAdmin = req.user!.role === "ADMIN" || req.user!.role === "SUPER_ADMIN";
    const leave = await prisma.therapistLeave.create({
      data: {
        therapistId: req.params.id,
        startDate: localDateTime(req.body.startDate, req.body.startTime),
        endDate: localDateTime(req.body.endDate, req.body.endTime),
        reason: req.body.reason,
        status: isAdmin ? "APPROVED" : "PENDING",
        approvedById: isAdmin ? req.user!.id : undefined,
      },
    });
    if (leave.status === "APPROVED") await blockSlotsForLeave(leave.therapistId, leave.startDate, leave.endDate);
    created(res, { leave, conflicts: await leaveConflicts(leave.therapistId, leave.startDate, leave.endDate) });
  }),
);

therapistRouter.patch(
  "/:id/leaves/:leaveId",
  authorize("ADMIN"),
  validate({ params: idParam.extend({ leaveId: z.string().uuid() }), body: z.object({ status: z.enum(["APPROVED", "REJECTED"]) }) }),
  handler(async (req, res) => {
    const leave = await prisma.therapistLeave.update({
      where: { id: req.params.leaveId, therapistId: req.params.id },
      data: { status: req.body.status, approvedById: req.user!.id },
    });
    if (leave.status === "APPROVED") await blockSlotsForLeave(leave.therapistId, leave.startDate, leave.endDate);
    await audit(req, "UPDATE", "TherapistLeave", leave.id, null, leave);
    ok(res, { leave, conflicts: leave.status === "APPROVED" ? await leaveConflicts(leave.therapistId, leave.startDate, leave.endDate) : [] });
  }),
);

/** Appointments already booked during a leave window — reception must reschedule these. */
function leaveConflicts(therapistId: string, startDate: Date, endDate: Date) {
  return prisma.appointment.findMany({
    where: { therapistId, startAt: { lt: endDate }, endAt: { gt: startDate }, status: { in: ["SCHEDULED", "CONFIRMED"] } },
    select: { id: true, appointmentNo: true, startAt: true, patient: { select: { firstName: true, lastName: true, phone: true } } },
  });
}

/* ─────────────── Slots ─────────────── */

const rangeQuery = z.object({ from: date.default(() => todayLocal()), to: date.optional(), status: z.enum(["AVAILABLE", "BOOKED", "BLOCKED"]).optional() });

therapistRouter.get(
  "/:id/slots",
  validate({ params: idParam, query: rangeQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof rangeQuery>>(req);
    const to = query.to ?? query.from;
    ok(
      res,
      await prisma.therapistSlot.findMany({
        where: { therapistId: req.params.id, status: query.status, startAt: { gte: dayRange(query.from).gte, lt: dayRange(to).lt } },
        orderBy: { startAt: "asc" },
        include: { appointment: { select: { id: true, status: true, type: true, patient: { select: { id: true, firstName: true, lastName: true } } } } },
      }),
    );
  }),
);

therapistRouter.post(
  "/:id/slots/generate",
  authorize("ADMIN"),
  validate({ params: idParam, body: z.object({ from: date, to: date }) }),
  handler(async (req, res) => ok(res, await generateSlots(req.params.id, req.body.from, req.body.to))),
);

slotRouter.patch(
  "/:id",
  authorize("ADMIN", "RECEPTIONIST"),
  validate({ params: idParam, body: z.object({ status: z.enum(["AVAILABLE", "BLOCKED"]) }) }),
  handler(async (req, res) => {
    const slot = await prisma.therapistSlot.findUniqueOrThrow({ where: { id: req.params.id }, include: { appointment: true } });
    if (slot.appointment) throw forbidden("Slot has an appointment. Cancel or reschedule it first.");
    ok(res, await prisma.therapistSlot.update({ where: { id: slot.id }, data: { status: req.body.status } }));
  }),
);

/* ─────────────── Specializations ─────────────── */

specializationRouter.get("/", handler(async (_req, res) => ok(res, await prisma.specialization.findMany({ orderBy: { name: "asc" } }))));

specializationRouter.post(
  "/",
  authorize("ADMIN"),
  validate({ body: z.object({ name: z.string().min(2), description: z.string().optional() }) }),
  handler(async (req, res) => created(res, await prisma.specialization.create({ data: req.body }))),
);
