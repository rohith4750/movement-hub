import { Router } from "../../router";
import { z } from "zod";
import { prisma, type Prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http";
import { audit } from "../../lib/audit";
import { forbidden, unprocessable } from "../../lib/http-error";
import { dateOnly } from "../../lib/time";
import { assertPatientAccess, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";

export const consultationRouter = Router();

const json = z.record(z.any());

export const assessmentBody = z.object({
  painScore: z.number().int().min(0).max(10),
  painLocation: z.string().optional(),
  painType: z.string().optional(),
  aggravatingFactors: z.string().optional(),
  relievingFactors: z.string().optional(),
  posture: z.string().optional(),
  rangeOfMotion: json.optional(),
  muscleStrength: json.optional(),
  specialTests: z.array(z.object({ name: z.string(), result: z.string() })).optional(),
  mobilityStatus: z.string().optional(),
  gait: z.string().optional(),
  observations: z.string().optional(),
  diagnosis: z.string().trim().max(1000).optional().transform((v) => v || undefined),
});

const consultationBody = z.object({
  chiefComplaint: z.string().trim().max(500).optional().transform((v) => v || undefined),
  symptoms: z.string().optional(),
  historyOfIllness: z.string().optional(),
  clinicalImpression: z.string().optional(),
  recommendations: z.string().optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const include = {
  assessment: true,
  patient: { select: { id: true, patientCode: true, firstName: true, lastName: true, gender: true, dateOfBirth: true } },
  therapist: { select: { id: true, user: { select: { name: true } } } },
  treatmentPlan: { select: { id: true, planNo: true, title: true, status: true } },
} satisfies Prisma.ConsultationInclude;

const listQuery = paginationQuery.extend({
  patientId: z.string().uuid().optional(),
  therapistId: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "FINAL"]).optional(),
  /** Leave out this appointment's own consultation (used for "previous assessment"). */
  excludeAppointmentId: z.string().uuid().optional(),
});

consultationRouter.get(
  "/",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const where: Prisma.ConsultationWhereInput = {
      deletedAt: null,
      patientId: query.patientId,
      therapistId: query.therapistId,
      status: query.status,
      ...(query.excludeAppointmentId ? { appointmentId: { not: query.excludeAppointmentId } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.consultation.findMany({ where, include, ...paging(query), orderBy: { createdAt: "desc" } }),
      prisma.consultation.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

consultationRouter.post(
  "/",
  authorize("PHYSIOTHERAPIST"),
  validate({ body: consultationBody.extend({ appointmentId: z.string().uuid(), assessment: assessmentBody.optional(), draft: z.boolean().default(false) }) }),
  handler(async (req, res) => {
    const { appointmentId, assessment, followUpDate, draft, ...data } = req.body;
    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    if (!["INITIAL_CONSULTATION", "FOLLOW_UP_CONSULTATION"].includes(appt.type)) throw unprocessable("NOT_A_CONSULTATION", "Appointment is not a consultation");
    if (["CANCELLED", "NO_SHOW", "RESCHEDULED"].includes(appt.status)) throw unprocessable("INVALID_STATUS", `Appointment is ${appt.status}`);

    const c = await prisma.$transaction(async (tx) => {
      const consultation = await tx.consultation.create({
        data: {
          ...data,
          appointmentId,
          patientId: appt.patientId,
          therapistId: appt.therapistId,
          isFollowUp: appt.type === "FOLLOW_UP_CONSULTATION",
          status: draft ? "DRAFT" : "FINAL",
          finalizedAt: draft ? null : new Date(),
          followUpDate: followUpDate ? dateOnly(followUpDate) : undefined,
          assessment: assessment ? { create: assessment } : undefined,
        },
        include,
      });
      if (["SCHEDULED", "CONFIRMED", "CHECKED_IN"].includes(appt.status)) {
        await tx.appointment.update({
          where: { id: appt.id },
          data: { status: "IN_PROGRESS", history: { create: { fromStatus: appt.status, toStatus: "IN_PROGRESS", changedById: req.user!.id, note: "Consultation started" } } },
        });
      }
      return consultation;
    });
    await audit(req, "CREATE", "Consultation", c.id, null, c);
    created(res, c);
  }),
);

consultationRouter.get(
  "/:id",
  authorize("PHYSIOTHERAPIST", "ADMIN", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const c = await prisma.consultation.findFirstOrThrow({ where: { id: req.params.id, deletedAt: null }, include });
    assertPatientAccess(req, c.patientId);
    ok(res, c);
  }),
);

consultationRouter.patch(
  "/:id",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam, body: consultationBody.partial().extend({ finalize: z.boolean().optional() }) }),
  handler(async (req, res) => {
    const before = await prisma.consultation.findUniqueOrThrow({ where: { id: req.params.id } });
    const { followUpDate, finalize, ...data } = req.body;
    const c = await prisma.consultation.update({
      where: { id: before.id },
      data: {
        ...data,
        followUpDate: followUpDate ? dateOnly(followUpDate) : undefined,
        // A draft becomes final once; final notes stay final (edits are kept in the history).
        ...(finalize && before.status === "DRAFT" ? { status: "FINAL" as const, finalizedAt: new Date() } : {}),
      },
      include,
    });
    await audit(req, "UPDATE", "Consultation", c.id, before, c);
    ok(res, c);
  }),
);

consultationRouter.put(
  "/:id/assessment",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam, body: assessmentBody }),
  handler(async (req, res) => {
    const c = await prisma.consultation.findUniqueOrThrow({ where: { id: req.params.id }, include: { assessment: true } });
    const a = await prisma.clinicalAssessment.upsert({ where: { consultationId: c.id }, create: { ...req.body, consultationId: c.id }, update: req.body });
    await audit(req, c.assessment ? "UPDATE" : "CREATE", "ClinicalAssessment", a.id, c.assessment, a);
    ok(res, a);
  }),
);

/* ─────────────── Edit history ─────────────── */

const LABELS: Record<string, string> = {
  chiefComplaint: "Chief complaint",
  symptoms: "Symptoms",
  historyOfIllness: "History of illness",
  clinicalImpression: "Clinical impression",
  recommendations: "Recommendations",
  followUpDate: "Follow-up date",
  status: "Status",
  painScore: "Pain score",
  painLocation: "Pain location",
  painType: "Pain type",
  aggravatingFactors: "Aggravating factors",
  relievingFactors: "Relieving factors",
  posture: "Posture",
  rangeOfMotion: "Range of motion",
  muscleStrength: "Muscle strength",
  specialTests: "Special tests",
  mobilityStatus: "Mobility status",
  gait: "Gait",
  observations: "Observations",
  diagnosis: "Diagnosis",
};

/** Field names whose value differs between two audit snapshots (or all filled fields on create). */
function changedFields(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  return Object.keys(LABELS).filter((k) => {
    const x = JSON.stringify(b[k] ?? null);
    const y = JSON.stringify(a[k] ?? null);
    return before ? x !== y : y !== "null";
  });
}

/** Who wrote and changed these notes, and what changed — clinical notes are traceable. */
consultationRouter.get(
  "/:id/history",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const c = await prisma.consultation.findFirstOrThrow({ where: { id: req.params.id }, include: { assessment: { select: { id: true } } } });
    const entityIds = [c.id, ...(c.assessment ? [c.assessment.id] : [])];
    const logs = await prisma.auditLog.findMany({
      where: { entity: { in: ["Consultation", "ClinicalAssessment"] }, entityId: { in: entityIds } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { name: true, role: true } } },
    });
    ok(
      res,
      logs.map((l) => ({
        id: l.id,
        at: l.createdAt,
        by: l.user?.name ?? "System",
        role: l.user?.role ?? null,
        part: l.entity === "Consultation" ? "Notes" : "Assessment",
        action: l.action === "CREATE" ? "Written" : "Edited",
        fields: changedFields(l.before, l.after).map((k) => LABELS[k]),
      })),
    );
  }),
);
