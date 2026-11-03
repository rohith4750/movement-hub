import { Router, type Request } from "../../router";
import { z } from "zod";
import { prisma, type Prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http";
import { audit } from "../../lib/audit";
import { conflict, forbidden, unprocessable } from "../../lib/http-error";
import { dayRange, todayLocal } from "../../lib/time";
import { assertPatientAccess, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { transition } from "../appointments/appointment.service";
import { useSession } from "../packages/package.service";

export const therapySessionRouter = Router();

const pain = z.number().int().min(0).max(10);
const exercise = z.object({
  name: z.string().min(2),
  sets: z.number().int().positive().optional(),
  reps: z.number().int().positive().optional(),
  durationMinutes: z.number().int().positive().optional(),
  resistance: z.string().optional(),
  notes: z.string().optional(),
});

const include = {
  patient: { select: { id: true, patientCode: true, firstName: true, lastName: true } },
  therapist: { select: { id: true, user: { select: { name: true } } } },
  appointment: { select: { id: true, appointmentNo: true, startAt: true, endAt: true, status: true } },
  treatmentPlan: { select: { id: true, title: true, prescribedSessions: true, items: { orderBy: { sortOrder: "asc" } } } },
  patientPackage: { select: { id: true, remainingSessions: true, expiryDate: true, package: { select: { name: true } } } },
  exercises: true,
} satisfies Prisma.TherapySessionInclude;

async function ownSession(req: Request, id: string) {
  const s = await prisma.therapySession.findFirstOrThrow({ where: { id, deletedAt: null } });
  return s;
}

/**
 * Any physiotherapist can run any session, but when it isn't theirs they must say why.
 * Returns the cover fields to save on the session (empty when the assigned physio is acting).
 */
async function coverFields(req: Request, s: { therapistId: string }, reason?: string) {
  if (req.user!.therapistId === s.therapistId) return {};
  const why = reason?.trim();
  if (!why || why.length < 3) throw unprocessable("COVER_REASON_REQUIRED", "This session is assigned to another physiotherapist. Enter the reason you are taking it.");
  const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } });
  return { coverReason: why, coveredByName: u?.name ?? null };
}

const listQuery = paginationQuery.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  therapistId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "MISSED"]).optional(),
});

therapySessionRouter.get(
  "/",
  authorize("PHYSIOTHERAPIST", "ADMIN", "RECEPTIONIST"),
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const where: Prisma.TherapySessionWhereInput = {
      deletedAt: null,
      therapistId: query.therapistId,
      patientId: query.patientId,
      status: query.status,
      ...(query.date ? { appointment: { startAt: dayRange(query.date) } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.therapySession.findMany({ where, include, ...paging(query), orderBy: { appointment: { startAt: "asc" } } }),
      prisma.therapySession.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

therapySessionRouter.get(
  "/today",
  authorize("PHYSIOTHERAPIST", "ADMIN", "RECEPTIONIST"),
  handler(async (req, res) => {
    const therapistId = (req.query.therapistId as string | undefined) ?? undefined;
    ok(
      res,
      await prisma.therapySession.findMany({
        where: { deletedAt: null, ...(therapistId ? { therapistId } : {}), status: { not: "CANCELLED" }, appointment: { startAt: dayRange(todayLocal()) } },
        include,
        orderBy: { appointment: { startAt: "asc" } },
      }),
    );
  }),
);

therapySessionRouter.get(
  "/:id",
  authorize("PHYSIOTHERAPIST", "ADMIN", "RECEPTIONIST", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const s = await prisma.therapySession.findFirstOrThrow({ where: { id: req.params.id, deletedAt: null }, include });
    assertPatientAccess(req, s.patientId);
    ok(res, s);
  }),
);

therapySessionRouter.post(
  "/:id/start",
  authorize("PHYSIOTHERAPIST"),
  validate({ params: idParam, body: z.object({ painBefore: pain, coverReason: z.string().max(500).optional() }) }),
  handler(async (req, res) => {
    const s = await ownSession(req, req.params.id);
    if (s.status !== "SCHEDULED") throw unprocessable("INVALID_STATUS", `Session is ${s.status}`);
    const cover = await coverFields(req, s, req.body.coverReason);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "TherapySession" WHERE "id" = ${s.id} FOR UPDATE`;
      const fresh = await tx.therapySession.findUniqueOrThrow({ where: { id: s.id }, select: { status: true } });
      if (fresh.status !== "SCHEDULED") throw conflict("ALREADY_STARTED", `Session is already ${fresh.status.toLowerCase().replace("_", " ")}`);
      const appt = await tx.appointment.findUniqueOrThrow({ where: { id: s.appointmentId } });
      if (appt.status === "SCHEDULED" || appt.status === "CONFIRMED") await transition(tx, appt.id, "CHECKED_IN", req.user!.id, "Auto check-in at session start", { checkedInAt: new Date() });
      await transition(tx, appt.id, "IN_PROGRESS", req.user!.id);
      return tx.therapySession.update({ where: { id: s.id }, data: { status: "IN_PROGRESS", painBefore: req.body.painBefore, startedAt: new Date(), ...cover }, include });
    });
    ok(res, updated);
  }),
);

const updateBody = z.object({
  painBefore: pain.optional(),
  painAfter: pain.optional(),
  rangeOfMotion: z.record(z.any()).optional(),
  notes: z.string().optional(),
  homeAdvice: z.string().optional(),
  progressRating: z.number().int().min(1).max(5).optional(),
});

therapySessionRouter.patch(
  "/:id",
  authorize("PHYSIOTHERAPIST"),
  validate({ params: idParam, body: updateBody }),
  handler(async (req, res) => {
    const s = await ownSession(req, req.params.id);
    if (s.status === "CANCELLED") throw unprocessable("INVALID_STATUS", "Session was cancelled");
    const updated = await prisma.therapySession.update({ where: { id: s.id }, data: req.body, include });
    await audit(req, "UPDATE", "TherapySession", s.id, s, updated);
    ok(res, updated);
  }),
);

/** Complete: records outcome, completes the appointment and deducts one package session — atomically. */
therapySessionRouter.post(
  "/:id/complete",
  authorize("PHYSIOTHERAPIST"),
  validate({ params: idParam, body: updateBody.extend({ painAfter: pain, coverReason: z.string().max(500).optional(), exercises: z.array(exercise).default([]) }) }),
  handler(async (req, res) => {
    const s = await ownSession(req, req.params.id);
    if (s.status !== "IN_PROGRESS" && s.status !== "SCHEDULED") throw unprocessable("INVALID_STATUS", `Session is ${s.status}`);
    const { exercises, coverReason, ...data } = req.body;
    // Already taken over at start? Keep that reason; otherwise a non-assigned physio must give one now.
    const cover = s.coverReason ? {} : await coverFields(req, s, coverReason);
    const result = await prisma.$transaction(async (tx) => {
      // Lock the session and re-check its status: a double tap or retried request waits here,
      // then sees COMPLETED and stops, so the package is charged exactly once.
      await tx.$queryRaw`SELECT "id" FROM "TherapySession" WHERE "id" = ${s.id} FOR UPDATE`;
      const fresh = await tx.therapySession.findUniqueOrThrow({ where: { id: s.id }, select: { status: true } });
      if (fresh.status !== "IN_PROGRESS" && fresh.status !== "SCHEDULED") throw conflict("ALREADY_COMPLETED", `Session is already ${fresh.status.toLowerCase()}`);
      const appt = await tx.appointment.findUniqueOrThrow({ where: { id: s.appointmentId } });
      if (appt.status === "SCHEDULED" || appt.status === "CONFIRMED") await transition(tx, appt.id, "CHECKED_IN", req.user!.id, "Auto check-in");
      await transition(tx, appt.id, "COMPLETED", req.user!.id, undefined, { completedAt: new Date() });
      if (exercises.length) await tx.sessionExercise.createMany({ data: exercises.map((e: z.infer<typeof exercise>) => ({ ...e, therapySessionId: s.id })) });
      const session = await tx.therapySession.update({
        where: { id: s.id },
        data: { ...data, ...cover, status: "COMPLETED", startedAt: s.startedAt ?? new Date(), completedAt: new Date() },
        include,
      });
      const pkg = s.patientPackageId ? await useSession(tx, s.patientPackageId, s.id, req.user!.id) : null;
      return { session, package: pkg ? { id: pkg.id, remainingSessions: pkg.remainingSessions, status: pkg.status } : null };
    });
    await audit(req, "UPDATE", "TherapySession", s.id, { status: s.status }, { status: "COMPLETED" });

    // Tell the physio when this was the last prescribed session, so they can complete the treatment.
    let plan: { id: string; planNo: string; completedSessions: number; prescribedSessions: number; readyToComplete: boolean } | null = null;
    if (s.treatmentPlanId) {
      const tp = await prisma.treatmentPlan.findUnique({ where: { id: s.treatmentPlanId }, select: { id: true, planNo: true, status: true, prescribedSessions: true } });
      if (tp?.status === "ACTIVE") {
        const done = await prisma.therapySession.count({ where: { treatmentPlanId: tp.id, status: "COMPLETED" } });
        plan = { id: tp.id, planNo: tp.planNo, completedSessions: done, prescribedSessions: tp.prescribedSessions, readyToComplete: done >= tp.prescribedSessions };
      }
    }
    ok(res, { ...result, plan });
  }),
);

therapySessionRouter.post(
  "/:id/exercises",
  authorize("PHYSIOTHERAPIST"),
  validate({ params: idParam, body: exercise }),
  handler(async (req, res) => {
    const s = await ownSession(req, req.params.id);
    created(res, await prisma.sessionExercise.create({ data: { ...req.body, therapySessionId: s.id } }));
  }),
);

therapySessionRouter.delete(
  "/:id/exercises/:exerciseId",
  authorize("PHYSIOTHERAPIST"),
  validate({ params: idParam.extend({ exerciseId: z.string().uuid() }) }),
  handler(async (req, res) => {
    const s = await ownSession(req, req.params.id);
    await prisma.sessionExercise.delete({ where: { id: req.params.exerciseId, therapySessionId: s.id } });
    ok(res, { deleted: true });
  }),
);
