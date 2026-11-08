import { Router, type Request } from "../../router";
import { z } from "zod";
import { Prisma, prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http";
import { audit } from "../../lib/audit";
import { nextCode } from "../../lib/codes";
import { HttpError, badRequest, forbidden, unprocessable } from "../../lib/http-error";
import { dateOnly, todayLocal } from "../../lib/time";
import { assertPatientAccess, authorize, scopePatient } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { cancel as cancelAppointment } from "../appointments/appointment.service";

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
  /** Optional — defaults to the diagnosis, or "Treatment plan". */
  title: z.string().trim().max(500).optional().transform((v) => v || undefined),
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

/** Visits still booked under a plan (not yet started). */
const BOOKED: ("SCHEDULED" | "CONFIRMED")[] = ["SCHEDULED", "CONFIRMED"];
/** Visits happening right now — a plan can't be closed under them. */
const IN_VISIT: ("CHECKED_IN" | "IN_PROGRESS")[] = ["CHECKED_IN", "IN_PROGRESS"];

export async function progressOf(planId: string, prescribed: number) {
  const [completed, upcoming, bookedVisits, lastDone] = await Promise.all([
    prisma.therapySession.count({ where: { treatmentPlanId: planId, status: "COMPLETED" } }),
    prisma.therapySession.count({ where: { treatmentPlanId: planId, status: "SCHEDULED" } }),
    prisma.appointment.count({ where: { treatmentPlanId: planId, status: { in: [...BOOKED, ...IN_VISIT] } } }),
    prisma.therapySession.findFirst({ where: { treatmentPlanId: planId, status: "COMPLETED", painAfter: { not: null } }, orderBy: { completedAt: "desc" }, select: { painAfter: true } }),
  ]);
  return {
    completedSessions: completed,
    upcomingSessions: upcoming,
    bookedVisits,
    remaining: Math.max(prescribed - completed, 0),
    percent: Math.min(100, Math.round((completed / prescribed) * 100)),
    /** Every prescribed session is done — time to complete the treatment. */
    readyToComplete: completed >= prescribed,
    latestPain: lastDone?.painAfter ?? null,
  };
}

/**
 * Plans are managed by the whole physio team (Movement Hub has no fixed "owner only" rule);
 * every change is written to the audit log. Route-level authorize() limits this to physios / Super Admin.
 */
async function editable(_req: Request, id: string) {
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

/* ─────────────── One active plan per patient ─────────────── */

const UPCOMING_BOOKED = ["SCHEDULED", "CONFIRMED"] as const;

/**
 * A patient has at most one ACTIVE plan. Activating another is refused (409 ACTIVE_PLAN_EXISTS,
 * with the current plan in `details`) unless the caller confirms `replaceActive`: then the old
 * plan is completed as "replaced", and its upcoming, not-yet-started visits move to the new plan
 * so the patient's bookings carry on. Runs inside the activating transaction, with the patient
 * row locked so two activations can't race.
 */
async function ensureSingleActivePlan(tx: Prisma.TransactionClient, opts: { patientId: string; newPlanId: string; newPlanNo: string; replaceActive: boolean }) {
  await tx.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${opts.patientId} FOR UPDATE`;
  const current = await tx.treatmentPlan.findFirst({
    where: { patientId: opts.patientId, status: "ACTIVE", deletedAt: null, id: { not: opts.newPlanId } },
    select: { id: true, planNo: true, title: true, dischargeSummary: true },
  });
  if (!current) return null;
  const upcoming = { treatmentPlanId: current.id, status: { in: [...UPCOMING_BOOKED] }, startAt: { gt: new Date() } };
  if (!opts.replaceActive) {
    const upcomingVisits = await tx.appointment.count({ where: upcoming });
    throw new HttpError(409, "ACTIVE_PLAN_EXISTS", `This patient already has an active plan (${current.planNo} – ${current.title}).`, {
      planId: current.id,
      planNo: current.planNo,
      title: current.title,
      upcomingVisits,
    });
  }
  const moving = await tx.appointment.findMany({ where: upcoming, select: { id: true } });
  const ids = moving.map((m) => m.id);
  await tx.appointment.updateMany({ where: { id: { in: ids } }, data: { treatmentPlanId: opts.newPlanId } });
  await tx.therapySession.updateMany({ where: { appointmentId: { in: ids }, status: "SCHEDULED" }, data: { treatmentPlanId: opts.newPlanId } });
  await tx.treatmentPlan.update({
    where: { id: current.id },
    data: { status: "COMPLETED", completedAt: new Date(), dischargeSummary: current.dischargeSummary ?? `Replaced by plan ${opts.newPlanNo}.` },
  });
  return { replacedPlanId: current.id, replacedPlanNo: current.planNo, movedVisits: ids.length };
}

treatmentPlanRouter.post(
  "/",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({
    body: planBody.extend({
      patientId: z.string().uuid(),
      consultationId: z.string().uuid().optional(),
      therapistId: z.string().uuid().optional(), // admins choose the treating physiotherapist
      activate: z.boolean().default(false),
      /** Confirmed by the user: complete the patient's current active plan and carry its bookings over. */
      replaceActive: z.boolean().default(false),
      items: z.array(item).default([]),
    }),
  }),
  handler(async (req, res) => {
    const { items, startDate, endDate, therapistId: requestedTherapist, activate, replaceActive, ...data } = req.body;
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
    if (data.consultationId) {
      const c = await prisma.consultation.findUniqueOrThrow({ where: { id: data.consultationId }, include: { assessment: { select: { diagnosis: true } } } });
      if (c.patientId !== data.patientId) throw badRequest("Consultation belongs to another patient");
      // The diagnosis recorded at the end of the assessment carries over to the plan.
      data.diagnosis ||= c.assessment?.diagnosis ?? undefined;
    }
    const title = data.title || data.diagnosis?.slice(0, 120) || "Treatment plan";
    const { plan, replaced } = await prisma.$transaction(async (tx) => {
      const p = await tx.treatmentPlan.create({
        data: {
          ...data,
          title,
          planNo: await nextCode(tx, "plan"),
          therapistId,
          ...(activate ? { status: "ACTIVE" as const, activatedAt: new Date() } : {}),
          startDate: startDate ? dateOnly(startDate) : activate ? dateOnly(todayLocal()) : undefined,
          endDate: endDate ? dateOnly(endDate) : undefined,
          items: { create: items },
        },
        include,
      });
      const r = activate ? await ensureSingleActivePlan(tx, { patientId: p.patientId, newPlanId: p.id, newPlanNo: p.planNo, replaceActive }) : null;
      if (r) await audit(req, "UPDATE", "TreatmentPlan", r.replacedPlanId, { status: "ACTIVE" }, { status: "COMPLETED", replacedBy: p.planNo, movedVisits: r.movedVisits }, tx);
      return { plan: p, replaced: r };
    });
    await audit(req, "CREATE", "TreatmentPlan", plan.id, null, plan);
    created(res, { ...plan, replaced });
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
  validate({ params: idParam, body: z.object({ replaceActive: z.boolean().default(false) }).default({}) }),
  handler(async (req, res) => {
    const plan = await editable(req, req.params.id);
    if (plan.status !== "DRAFT") throw unprocessable("INVALID_STATUS", `Plan is ${plan.status}`);
    const { updated, replaced } = await prisma.$transaction(async (tx) => {
      const r = await ensureSingleActivePlan(tx, { patientId: plan.patientId, newPlanId: plan.id, newPlanNo: plan.planNo, replaceActive: req.body.replaceActive });
      const u = await tx.treatmentPlan.update({
        where: { id: plan.id },
        data: { status: "ACTIVE", activatedAt: new Date(), startDate: plan.startDate ?? dateOnly(todayLocal()) },
        include,
      });
      if (r) await audit(req, "UPDATE", "TreatmentPlan", r.replacedPlanId, { status: "ACTIVE" }, { status: "COMPLETED", replacedBy: plan.planNo, movedVisits: r.movedVisits }, tx);
      return { updated: u, replaced: r };
    });
    await audit(req, "UPDATE", "TreatmentPlan", plan.id, { status: plan.status }, { status: "ACTIVE" });
    ok(res, { ...updated, replaced });
  }),
);

/* ─────────────── Daily progress ─────────────── */

const progressStatus = z.enum(["IMPROVED", "SAME", "WORSE"]);
const progressBody = z.object({
  painScore: z.number().int().min(0).max(10).nullable().optional(),
  status: progressStatus.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /** How each therapy of the plan went that day. Left out = keep what is saved; [] / null = clear it. */
  items: z
    .array(z.object({ itemId: z.string().uuid(), status: progressStatus, note: z.string().trim().max(500).nullable().optional() }))
    .max(40)
    .nullable()
    .optional(),
});

type StoredItem = { itemId?: string | null; name: string; status: z.infer<typeof progressStatus>; note?: string | null };
/** The per-therapy list saved on a progress entry (tolerates anything unexpected in the JSON). */
const storedItems = (v: unknown): StoredItem[] =>
  Array.isArray(v) ? (v as StoredItem[]).filter((x) => x && typeof x.name === "string" && progressStatus.safeParse(x.status).success) : [];
const MAX_DAYS = 120;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDaysYmd = (day: string, n: number) => ymd(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));

/**
 * Day-by-day progress for a plan, newest first. A day without an entry carries forward the last
 * recorded value of each field until a new entry changes it (`carriedForward: true`).
 */
treatmentPlanRouter.get(
  "/:id/progress-log",
  validate({ params: idParam }),
  handler(async (req, res) => {
    const plan = await prisma.treatmentPlan.findFirstOrThrow({
      where: { id: req.params.id, deletedAt: null },
      select: { id: true, patientId: true, status: true, startDate: true, activatedAt: true, createdAt: true, completedAt: true, endDate: true },
    });
    assertPatientAccess(req, plan.patientId);
    const entries = await prisma.treatmentProgress.findMany({ where: { treatmentPlanId: plan.id }, orderBy: { date: "asc" } });

    const today = todayLocal();
    const first = entries[0] ? ymd(entries[0].date) : undefined;
    let start = plan.startDate ? ymd(plan.startDate) : ymd(plan.activatedAt ?? plan.createdAt);
    if (first && first < start) start = first;
    let end = plan.status === "COMPLETED" || plan.status === "CANCELLED" ? (plan.endDate ? ymd(plan.endDate) : plan.completedAt ? ymd(plan.completedAt) : today) : today;
    if (end > today) end = today;
    if (addDaysYmd(start, MAX_DAYS) < end) start = addDaysYmd(end, -MAX_DAYS);

    const byDay = new Map(entries.map((e) => [ymd(e.date), e]));
    // Seed the carried values from entries before the visible window.
    let painScore: number | null = null;
    let status: z.infer<typeof progressStatus> | null = null;
    let notes: string | null = null;
    let since: string | null = null;
    // Each therapy keeps its last recorded status (and the day it was recorded) until a newer entry changes it.
    const therapy = new Map<string, StoredItem & { on: string }>();
    for (const e of entries) {
      if (ymd(e.date) >= start) break;
      if (e.painScore != null) painScore = e.painScore;
      if (e.status) status = e.status;
      if (e.notes) notes = e.notes;
      for (const x of storedItems(e.items)) therapy.set(x.name, { ...x, on: ymd(e.date) });
      since = ymd(e.date);
    }

    const days: {
      date: string;
      painScore: number | null;
      status: string | null;
      notes: string | null;
      items: { itemId: string | null; name: string; status: string; note: string | null; carriedForward: boolean }[];
      carriedForward: boolean;
      recordedOn: string | null;
      entryId: string | null;
    }[] = [];
    for (let d = start; d <= end; d = addDaysYmd(d, 1)) {
      const e = byDay.get(d);
      if (e) {
        if (e.painScore != null) painScore = e.painScore;
        if (e.status) status = e.status;
        if (e.notes) notes = e.notes;
        for (const x of storedItems(e.items)) therapy.set(x.name, { ...x, on: d });
        since = d;
      }
      const items = [...therapy.values()].map((x) => ({ itemId: x.itemId ?? null, name: x.name, status: x.status, note: x.on === d ? x.note ?? null : null, carriedForward: x.on !== d }));
      days.push({ date: d, painScore, status, notes, items, carriedForward: !e && since !== null, recordedOn: since, entryId: e?.id ?? null });
    }
    ok(res, { days: days.reverse(), entries: entries.length, editable: plan.status === "ACTIVE" });
  }),
);

/** Record (or update) one day's progress. Fields left out keep their previous value for that day. */
treatmentPlanRouter.put(
  "/:id/progress-log/:date",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam.extend({ date }), body: progressBody }),
  handler(async (req, res) => {
    const plan = await editable(req, req.params.id);
    if (plan.status !== "ACTIVE") throw unprocessable("PLAN_NOT_ACTIVE", "Progress can only be recorded on an active plan");
    const day = req.params.date as string;
    if (day > todayLocal()) throw badRequest("Progress can't be recorded for a future date", "FUTURE_DATE");
    const body = req.body as z.infer<typeof progressBody>;
    if (body.painScore == null && !body.status && !body.notes?.trim() && !body.items?.length) throw badRequest("Enter pain, status, a therapy status or a note", "EMPTY_PROGRESS");

    // Therapy statuses are saved with the therapy's name, so the history still reads right if the plan is edited later.
    let items: StoredItem[] | undefined;
    if (body.items !== undefined) {
      const planItems = await prisma.treatmentPlanItem.findMany({ where: { treatmentPlanId: plan.id }, select: { id: true, name: true } });
      items = (body.items ?? []).map((i) => {
        const found = planItems.find((p) => p.id === i.itemId);
        if (!found) throw badRequest("That therapy is not part of this plan", "UNKNOWN_THERAPY");
        return { itemId: found.id, name: found.name, status: i.status, note: i.note?.trim() || null };
      });
    }
    const itemsData = items === undefined ? {} : { items: items.length ? (items as unknown as Prisma.InputJsonValue) : Prisma.DbNull };
    const data = { painScore: body.painScore ?? null, status: body.status ?? null, notes: body.notes?.trim() || null, recordedById: req.user!.id, ...itemsData };
    const entry = await prisma.treatmentProgress.upsert({
      where: { treatmentPlanId_date: { treatmentPlanId: plan.id, date: dateOnly(day) } },
      create: { treatmentPlanId: plan.id, date: dateOnly(day), ...data },
      update: data,
    });
    await audit(req, "UPDATE", "TreatmentProgress", entry.id, null, entry);
    ok(res, entry);
  }),
);

const completeBody = z.object({
  outcome: z.enum(["GOALS_MET", "PARTIALLY_MET", "NOT_MET", "DISCONTINUED"]),
  finalPainScore: z.number().int().min(0).max(10).optional(),
  dischargeSummary: z.string().trim().max(4000).optional(),
  homeProgram: z.string().trim().max(4000).optional(),
  /** Cancel visits still booked under this plan (frees the slots). Without it, booked visits block completion. */
  cancelUpcoming: z.boolean().default(false),
});

/**
 * Complete the treatment: records the discharge summary and closes the plan.
 * Booked visits under the plan must be cancelled — either beforehand, or here with `cancelUpcoming`.
 */
treatmentPlanRouter.post(
  "/:id/complete",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam, body: completeBody }),
  handler(async (req, res) => {
    const plan = await editable(req, req.params.id);
    if (plan.status !== "ACTIVE") throw unprocessable("INVALID_STATUS", `Plan is ${plan.status}`);
    const { cancelUpcoming, ...discharge } = req.body as z.infer<typeof completeBody>;

    const [inVisit, booked] = await Promise.all([
      prisma.appointment.count({ where: { treatmentPlanId: plan.id, status: { in: IN_VISIT } } }),
      prisma.appointment.findMany({ where: { treatmentPlanId: plan.id, status: { in: BOOKED } }, select: { id: true, appointmentNo: true, startAt: true }, orderBy: { startAt: "asc" } }),
    ]);
    if (inVisit > 0) throw unprocessable("VISIT_IN_PROGRESS", "A visit under this plan is in progress. Finish it before completing the treatment.");
    if (booked.length && !cancelUpcoming) {
      throw new HttpError(409, "PLAN_HAS_UPCOMING", `${booked.length} visit(s) are still booked under this plan. Cancel them to complete the treatment.`, { count: booked.length, appointments: booked });
    }
    for (const a of booked) await cancelAppointment(a.id, req.user!.id, "Treatment plan completed", { enforceWindow: false });

    const finalPainScore = discharge.finalPainScore ?? (await progressOf(plan.id, plan.prescribedSessions)).latestPain ?? undefined;
    const updated = await prisma.treatmentPlan.update({
      where: { id: plan.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        endDate: dateOnly(todayLocal()),
        outcome: discharge.outcome,
        finalPainScore,
        dischargeSummary: discharge.dischargeSummary || undefined,
        homeProgram: discharge.homeProgram || undefined,
      },
      include,
    });
    await audit(req, "UPDATE", "TreatmentPlan", plan.id, { status: plan.status }, { status: "COMPLETED", outcome: discharge.outcome, finalPainScore, cancelledVisits: booked.map((a) => a.appointmentNo) });
    ok(res, { ...updated, cancelledVisits: booked.length });
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
