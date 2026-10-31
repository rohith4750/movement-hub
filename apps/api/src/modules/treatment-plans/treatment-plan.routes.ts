import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { nextCode } from "../../lib/codes.js";
import { badRequest, forbidden, unprocessable } from "../../lib/http-error.js";
import { dateOnly, todayLocal } from "../../lib/time.js";
import { assertPatientAccess, authorize, scopePatient } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";

export const treatmentPlanRouter = Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const item = z.object({
  category: z.string().min(2),
  name: z.string().min(2),
  description: z.string().optional(),
  sets: z.number().int().positive().optional(),
  reps: z.number().int().positive().optional(),
  durationMinutes: z.number().int().positive().optional(),
  sortOrder: z.number().int().default(0),
});

const planBody = z.object({
  title: z.string().min(2),
  diagnosis: z.string().optional(),
  goals: z.string().optional(),
  prescribedSessions: z.number().int().min(1).max(200),
  frequencyPerWeek: z.number().int().min(1).max(14),
  sessionMinutes: z.number().int().min(10).max(180).default(30),
  instructions: z.string().optional(),
  startDate: date.optional(),
  endDate: date.optional(),
});

const include = {
  items: { orderBy: { sortOrder: "asc" } },
  patient: { select: { id: true, patientCode: true, firstName: true, lastName: true } },
  therapist: { select: { id: true, user: { select: { name: true } } } },
  patientPackages: { select: { id: true, remainingSessions: true, status: true, expiryDate: true } },
} satisfies Prisma.TreatmentPlanInclude;

async function progressOf(planId: string, prescribed: number) {
  const completed = await prisma.therapySession.count({ where: { treatmentPlanId: planId, status: "COMPLETED" } });
  const upcoming = await prisma.therapySession.count({ where: { treatmentPlanId: planId, status: "SCHEDULED" } });
  return { completedSessions: completed, upcomingSessions: upcoming, remaining: Math.max(prescribed - completed, 0), percent: Math.round((completed / prescribed) * 100) };
}

/**
 * Plans are managed by the whole physio team (Movement Hub has no fixed "owner only" rule);
 * every change is written to the audit log. Route-level authorize() limits this to physios / Super Admin.
 */
async function editable(_req: Express.Request, id: string) {
  return prisma.treatmentPlan.findFirstOrThrow({ where: { id, deletedAt: null } });
}

const listQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  patientId: z.string().uuid().optional(),
  therapistId: z.string().uuid().optional(),
});

treatmentPlanRouter.get(
  "/",
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const where: Prisma.TreatmentPlanWhereInput = {
      deletedAt: null,
      status: query.status,
      therapistId: query.therapistId,
      patientId: scopePatient(req, query.patientId),
      ...(query.search ? { OR: [{ title: { contains: query.search, mode: "insensitive" } }, { planNo: { contains: query.search, mode: "insensitive" } }] } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.treatmentPlan.findMany({ where, include, ...paging(query), orderBy: { createdAt: "desc" } }),
      prisma.treatmentPlan.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

treatmentPlanRouter.post(
  "/",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({
    body: planBody.extend({
      patientId: z.string().uuid(),
      consultationId: z.string().uuid().optional(),
      therapistId: z.string().uuid().optional(), // admins choose the treating physiotherapist
      activate: z.boolean().default(false),
      items: z.array(item).default([]),
    }),
  }),
  handler(async (req, res) => {
    const { items, startDate, endDate, therapistId: requestedTherapist, activate, ...data } = req.body;
    // Physiotherapists own the plans they write. Otherwise: the chosen physiotherapist,
    // or — when the plan comes from a consultation — the physiotherapist who did that consultation.
    let therapistId = req.user!.role === "PHYSIOTHERAPIST" ? req.user!.therapistId : requestedTherapist;
    if (!therapistId && data.consultationId) {
      therapistId = (await prisma.consultation.findUnique({ where: { id: data.consultationId }, select: { therapistId: true } }))?.therapistId ?? null;
    }
    if (!therapistId) throw badRequest("Choose the treating physiotherapist", "THERAPIST_REQUIRED");
    const therapist = await prisma.therapist.findFirst({ where: { id: therapistId, isActive: true } });
    if (!therapist) throw badRequest("Physiotherapist not found or inactive");
    const patient = await prisma.patient.findFirst({ where: { id: data.patientId, deletedAt: null } });
    if (!patient) throw badRequest("Patient not found");
    if (activate && items.length === 0) throw unprocessable("PLAN_EMPTY", "Add at least one treatment before activating");
    if (data.consultationId) {
      const c = await prisma.consultation.findUniqueOrThrow({ where: { id: data.consultationId } });
      if (c.patientId !== data.patientId) throw badRequest("Consultation belongs to another patient");
    }
    const plan = await prisma.$transaction(async (tx) =>
      tx.treatmentPlan.create({
        data: {
          ...data,
          planNo: await nextCode(tx, "plan"),
          therapistId,
          ...(activate ? { status: "ACTIVE" as const, activatedAt: new Date() } : {}),
          startDate: startDate ? dateOnly(startDate) : activate ? dateOnly(todayLocal()) : undefined,
          endDate: endDate ? dateOnly(endDate) : undefined,
          items: { create: items },
        },
        include,
      }),
    );
    await audit(req, "CREATE", "TreatmentPlan", plan.id, null, plan);
    created(res, plan);
  }),
);

treatmentPlanRouter.get(
  "/:id",
  validate({ params: idParam }),
  handler(async (req, res) => {
    const plan = await prisma.treatmentPlan.findFirstOrThrow({
      where: { id: req.params.id, deletedAt: null },
      include: { ...include, consultation: { include: { assessment: true } }, therapySessions: { orderBy: { sessionNumber: "asc" }, select: { id: true, sessionNumber: true, status: true, painBefore: true, painAfter: true, completedAt: true } } },
    });
    assertPatientAccess(req, plan.patientId);
    ok(res, { ...plan, progress: await progressOf(plan.id, plan.prescribedSessions) });
  }),
);

treatmentPlanRouter.patch(
  "/:id",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam, body: planBody.partial().extend({ therapistId: z.string().uuid().optional() }) }),
  handler(async (req, res) => {
    const before = await editable(req, req.params.id);
    if (["COMPLETED", "CANCELLED"].includes(before.status)) throw unprocessable("PLAN_CLOSED", "Closed plans cannot be edited");
    const { startDate, endDate, therapistId, ...data } = req.body;
    if (therapistId) {
      const t = await prisma.therapist.findFirst({ where: { id: therapistId, isActive: true } });
      if (!t) throw badRequest("Physiotherapist not found or inactive");
    }
    const plan = await prisma.treatmentPlan.update({
      where: { id: before.id },
      data: { ...data, therapistId, startDate: startDate ? dateOnly(startDate) : undefined, endDate: endDate ? dateOnly(endDate) : undefined },
      include,
    });
    await audit(req, "UPDATE", "TreatmentPlan", plan.id, before, plan);
    ok(res, plan);
  }),
);

treatmentPlanRouter.post(
  "/:id/activate",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const plan = await editable(req, req.params.id);
    if (plan.status !== "DRAFT") throw unprocessable("INVALID_STATUS", `Plan is ${plan.status}`);
    const items = await prisma.treatmentPlanItem.count({ where: { treatmentPlanId: plan.id } });
    if (items === 0) throw unprocessable("PLAN_EMPTY", "Add at least one treatment before activating");
    const updated = await prisma.treatmentPlan.update({
      where: { id: plan.id },
      data: { status: "ACTIVE", activatedAt: new Date(), startDate: plan.startDate ?? dateOnly(todayLocal()) },
      include,
    });
    await audit(req, "UPDATE", "TreatmentPlan", plan.id, { status: plan.status }, { status: "ACTIVE" });
    ok(res, updated);
  }),
);

treatmentPlanRouter.post(
  "/:id/complete",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const plan = await editable(req, req.params.id);
    if (plan.status !== "ACTIVE") throw unprocessable("INVALID_STATUS", `Plan is ${plan.status}`);
    const updated = await prisma.treatmentPlan.update({ where: { id: plan.id }, data: { status: "COMPLETED", completedAt: new Date(), endDate: dateOnly(todayLocal()) }, include });
    await audit(req, "UPDATE", "TreatmentPlan", plan.id, { status: plan.status }, { status: "COMPLETED" });
    ok(res, updated);
  }),
);

treatmentPlanRouter.post(
  "/:id/cancel",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam, body: z.object({ reason: z.string().min(2) }) }),
  handler(async (req, res) => {
    const plan = await editable(req, req.params.id);
    if (["COMPLETED", "CANCELLED"].includes(plan.status)) throw unprocessable("INVALID_STATUS", `Plan is ${plan.status}`);
    const upcoming = await prisma.appointment.count({ where: { treatmentPlanId: plan.id, status: { in: ["SCHEDULED", "CONFIRMED"] } } });
    if (upcoming > 0) throw unprocessable("HAS_UPCOMING", `Cancel the ${upcoming} upcoming appointment(s) first`);
    const updated = await prisma.treatmentPlan.update({ where: { id: plan.id }, data: { status: "CANCELLED", instructions: `${plan.instructions ?? ""}\n[Cancelled] ${req.body.reason}`.trim() }, include });
    await audit(req, "UPDATE", "TreatmentPlan", plan.id, { status: plan.status }, { status: "CANCELLED", reason: req.body.reason });
    ok(res, updated);
  }),
);

/**
 * Delete a plan (soft delete — hidden everywhere, kept in the database and audit log).
 * Only plans with no treatment done yet: if a session was completed or visits are still booked,
 * the plan is part of the clinical record — cancel it instead.
 */
treatmentPlanRouter.delete(
  "/:id",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const plan = await editable(req, req.params.id);
    const [done, booked] = await Promise.all([
      prisma.therapySession.count({ where: { treatmentPlanId: plan.id, status: { in: ["IN_PROGRESS", "COMPLETED"] } } }),
      prisma.appointment.count({ where: { treatmentPlanId: plan.id, status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] } } }),
    ]);
    if (done > 0) throw unprocessable("PLAN_HAS_TREATMENT", `${done} session(s) were already done under this plan, so it's part of the medical record. Cancel the plan instead.`);
    if (booked > 0) throw unprocessable("PLAN_HAS_BOOKINGS", `${booked} visit(s) are booked under this plan. Cancel or reschedule them first, or cancel the plan instead.`);
    await prisma.$transaction([
      prisma.patientPackage.updateMany({ where: { treatmentPlanId: plan.id }, data: { treatmentPlanId: null } }),
      prisma.treatmentPlan.update({ where: { id: plan.id }, data: { deletedAt: new Date() } }),
    ]);
    await audit(req, "DELETE", "TreatmentPlan", plan.id, { planNo: plan.planNo, title: plan.title, status: plan.status });
    ok(res, { deleted: true });
  }),
);

treatmentPlanRouter.post(
  "/:id/items",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam, body: item }),
  handler(async (req, res) => {
    await editable(req, req.params.id);
    created(res, await prisma.treatmentPlanItem.create({ data: { ...req.body, treatmentPlanId: req.params.id } }));
  }),
);

const itemParams = idParam.extend({ itemId: z.string().uuid() });

treatmentPlanRouter.patch(
  "/:id/items/:itemId",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: itemParams, body: item.partial() }),
  handler(async (req, res) => {
    await editable(req, req.params.id);
    ok(res, await prisma.treatmentPlanItem.update({ where: { id: req.params.itemId, treatmentPlanId: req.params.id }, data: req.body }));
  }),
);

treatmentPlanRouter.delete(
  "/:id/items/:itemId",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: itemParams }),
  handler(async (req, res) => {
    await editable(req, req.params.id);
    await prisma.treatmentPlanItem.delete({ where: { id: req.params.itemId, treatmentPlanId: req.params.id } });
    ok(res, { deleted: true });
  }),
);
