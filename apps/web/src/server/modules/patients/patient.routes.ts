import { Router } from "../../router";
import { z } from "zod";
import { prisma, type Prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, orderBy, paginationQuery, paging, q } from "../../lib/http";
import { audit } from "../../lib/audit";
import { nextCode } from "../../lib/codes";
import { dateOnly } from "../../lib/time";
import { assertPatientAccess, authorize, STAFF } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { phoneSchema } from "../../lib/validators";
import { notFound, unprocessable } from "../../lib/http-error";

export const patientRouter = Router();

const phone = phoneSchema;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const address = z.object({
  label: z.string().default("Home"),
  line1: z.string().min(2),
  line2: z.string().optional(),
  landmark: z.string().optional(),
  city: z.string(),
  state: z.string(),
  pincode: z.string().regex(/^\d{6}$/),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isDefault: z.boolean().default(false),
});

const patientBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  dateOfBirth: date.optional(),
  phone,
  email: z.string().email().optional(),
  emergencyName: z.string().optional(),
  emergencyPhone: phone.optional(),
  occupation: z.string().optional(),
  referredBy: z.string().optional(),
  consentGiven: z.boolean().default(false),
  address: address.optional(),
});

const historyBody = z.object({
  condition: z.string().min(2),
  details: z.string().optional(),
  diagnosedOn: date.optional(),
  medications: z.string().optional(),
  surgeries: z.string().optional(),
  allergies: z.string().optional(),
  isOngoing: z.boolean().default(true),
});

const listQuery = paginationQuery.extend({ gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional() });

/* ─────────────── Patients ─────────────── */

patientRouter.get(
  "/",
  authorize(...STAFF),
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const where: Prisma.PatientWhereInput = {
      deletedAt: null,
      gender: query.gender,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: "insensitive" } },
              { lastName: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search } },
              { patientCode: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        ...paging(query),
        orderBy: orderBy(query.sort, ["createdAt", "firstName", "patientCode"]),
        include: {
          packages: { where: { status: "ACTIVE" }, select: { id: true, remainingSessions: true, expiryDate: true } },
          treatmentPlans: { where: { status: "ACTIVE" }, select: { id: true, title: true } },
        },
      }),
      prisma.patient.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

patientRouter.post(
  "/",
  authorize("ADMIN", "RECEPTIONIST"),
  validate({ body: patientBody }),
  handler(async (req, res) => {
    const { address: addr, dateOfBirth, ...data } = req.body as z.infer<typeof patientBody>;
    const branchId = req.user!.branchId ?? (await prisma.branch.findFirstOrThrow()).id;
    const patient = await prisma.$transaction(async (tx) =>
      tx.patient.create({
        data: {
          ...data,
          branchId,
          patientCode: await nextCode(tx, "patient"),
          dateOfBirth: dateOfBirth ? dateOnly(dateOfBirth) : undefined,
          consentAt: data.consentGiven ? new Date() : undefined,
          addresses: addr ? { create: { ...addr, isDefault: true } } : undefined,
        },
        include: { addresses: true },
      }),
    );
    await audit(req, "CREATE", "Patient", patient.id, null, patient);
    created(res, patient);
  }),
);

patientRouter.get(
  "/:id",
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    const patient = await prisma.patient.findFirstOrThrow({
      where: { id: req.params.id, deletedAt: null },
      include: {
        addresses: true,
        medicalHistory: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
        packages: { include: { package: true }, orderBy: { createdAt: "desc" } },
        treatmentPlans: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 5 },
        appointments: { orderBy: { startAt: "desc" }, take: 10, include: { therapist: { include: { user: { select: { name: true } } } } } },
      },
    });
    ok(res, patient);
  }),
);

patientRouter.patch(
  "/:id",
  authorize("ADMIN", "RECEPTIONIST", "PATIENT"),
  validate({ params: idParam, body: patientBody.omit({ address: true }).partial() }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    const { dateOfBirth, ...data } = req.body;
    const before = await prisma.patient.findUniqueOrThrow({ where: { id: req.params.id } });
    const patient = await prisma.patient.update({
      where: { id: req.params.id },
      data: { ...data, dateOfBirth: dateOfBirth ? dateOnly(dateOfBirth) : undefined, consentAt: data.consentGiven && !before.consentGiven ? new Date() : undefined },
    });
    await audit(req, "UPDATE", "Patient", patient.id, before, patient);
    ok(res, patient);
  }),
);

/**
 * Soft delete: the patient disappears from lists/search and their app login stops working,
 * but clinical and financial history stays (records must not be hard-deleted).
 */
patientRouter.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const patient = await prisma.patient.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!patient) throw notFound("Patient");

    const upcoming = await prisma.appointment.count({
      where: { patientId: patient.id, startAt: { gt: new Date() }, status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] } },
    });
    if (upcoming > 0) throw unprocessable("HAS_UPCOMING_APPOINTMENTS", `This patient has ${upcoming} upcoming appointment(s). Cancel them first.`);

    const unpaid = await prisma.invoice.count({ where: { patientId: patient.id, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, deletedAt: null } });
    if (unpaid > 0) throw unprocessable("HAS_UNPAID_INVOICES", `This patient has ${unpaid} unpaid invoice(s). Settle or cancel them first.`);

    await prisma.$transaction(async (tx) => {
      await tx.patient.update({ where: { id: patient.id }, data: { deletedAt: new Date() } });
      await tx.patientPackage.updateMany({ where: { patientId: patient.id, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      await tx.waitlist.deleteMany({ where: { patientId: patient.id, isFulfilled: false } });
      if (patient.userId) {
        const stamp = Date.now();
        const u = await tx.user.findUniqueOrThrow({ where: { id: patient.userId } });
        await tx.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.user.update({
          where: { id: u.id },
          data: { isActive: false, deletedAt: new Date(), phone: `deleted-${stamp}-${u.phone}`, email: u.email ? `deleted-${stamp}-${u.email}` : null },
        });
      }
    });
    await audit(req, "DELETE", "Patient", patient.id, { patientCode: patient.patientCode, name: `${patient.firstName} ${patient.lastName ?? ""}`.trim() });
    ok(res, { deleted: true });
  }),
);

patientRouter.post(
  "/:id/consent",
  authorize("RECEPTIONIST", "ADMIN", "PATIENT"),
  validate({ params: idParam, body: z.object({ consentGiven: z.literal(true) }) }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    const p = await prisma.patient.update({ where: { id: req.params.id }, data: { consentGiven: true, consentAt: new Date() } });
    await audit(req, "UPDATE", "Patient", p.id, null, { consentGiven: true });
    ok(res, { consentGiven: p.consentGiven, consentAt: p.consentAt });
  }),
);

/* ─────────────── Addresses ─────────────── */

patientRouter.get(
  "/:id/addresses",
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    ok(res, await prisma.patientAddress.findMany({ where: { patientId: req.params.id }, orderBy: { isDefault: "desc" } }));
  }),
);

patientRouter.post(
  "/:id/addresses",
  authorize("RECEPTIONIST", "ADMIN", "PATIENT"),
  validate({ params: idParam, body: address }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    const a = await prisma.$transaction(async (tx) => {
      if (req.body.isDefault) await tx.patientAddress.updateMany({ where: { patientId: req.params.id }, data: { isDefault: false } });
      return tx.patientAddress.create({ data: { ...req.body, patientId: req.params.id } });
    });
    created(res, a);
  }),
);

patientRouter.patch(
  "/:id/addresses/:addressId",
  authorize("RECEPTIONIST", "ADMIN", "PATIENT"),
  validate({ params: idParam.extend({ addressId: z.string().uuid() }), body: address.partial() }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    const a = await prisma.$transaction(async (tx) => {
      if (req.body.isDefault) await tx.patientAddress.updateMany({ where: { patientId: req.params.id }, data: { isDefault: false } });
      return tx.patientAddress.update({ where: { id: req.params.addressId, patientId: req.params.id }, data: req.body });
    });
    ok(res, a);
  }),
);

/* ─────────────── Medical history ─────────────── */

patientRouter.get(
  "/:id/medical-history",
  authorize("PHYSIOTHERAPIST", "ADMIN", "RECEPTIONIST", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    ok(res, await prisma.medicalHistory.findMany({ where: { patientId: req.params.id, deletedAt: null }, orderBy: { createdAt: "desc" } }));
  }),
);

patientRouter.post(
  "/:id/medical-history",
  authorize("PHYSIOTHERAPIST", "RECEPTIONIST"),
  validate({ params: idParam, body: historyBody }),
  handler(async (req, res) => {
    const { diagnosedOn, ...data } = req.body;
    const h = await prisma.medicalHistory.create({
      data: { ...data, patientId: req.params.id, diagnosedOn: diagnosedOn ? dateOnly(diagnosedOn) : undefined },
    });
    await audit(req, "CREATE", "MedicalHistory", h.id, null, h);
    created(res, h);
  }),
);

patientRouter.patch(
  "/:id/medical-history/:historyId",
  authorize("PHYSIOTHERAPIST"),
  validate({ params: idParam.extend({ historyId: z.string().uuid() }), body: historyBody.partial() }),
  handler(async (req, res) => {
    const { diagnosedOn, ...data } = req.body;
    const before = await prisma.medicalHistory.findFirstOrThrow({ where: { id: req.params.historyId, patientId: req.params.id } });
    const h = await prisma.medicalHistory.update({
      where: { id: before.id },
      data: { ...data, diagnosedOn: diagnosedOn ? dateOnly(diagnosedOn) : undefined },
    });
    await audit(req, "UPDATE", "MedicalHistory", h.id, before, h);
    ok(res, h);
  }),
);

/* ─────────────── Related records ─────────────── */

const therapistName = { therapist: { select: { id: true, user: { select: { name: true } } } } };

patientRouter.get(
  "/:id/appointments",
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    ok(res, await prisma.appointment.findMany({ where: { patientId: req.params.id }, orderBy: { startAt: "desc" }, include: therapistName }));
  }),
);

patientRouter.get(
  "/:id/consultations",
  authorize("PHYSIOTHERAPIST", "ADMIN", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    ok(res, await prisma.consultation.findMany({ where: { patientId: req.params.id, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { assessment: true, ...therapistName } }));
  }),
);

patientRouter.get(
  "/:id/treatment-plans",
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    ok(res, await prisma.treatmentPlan.findMany({ where: { patientId: req.params.id, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { items: true, ...therapistName } }));
  }),
);

patientRouter.get(
  "/:id/packages",
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    ok(res, await prisma.patientPackage.findMany({ where: { patientId: req.params.id }, orderBy: { createdAt: "desc" }, include: { package: true } }));
  }),
);

patientRouter.get(
  "/:id/sessions",
  authorize("PHYSIOTHERAPIST", "ADMIN", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    ok(res, await prisma.therapySession.findMany({ where: { patientId: req.params.id, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { exercises: true, ...therapistName } }));
  }),
);

patientRouter.get(
  "/:id/invoices",
  authorize("ACCOUNTANT", "ADMIN", "RECEPTIONIST", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    ok(res, await prisma.invoice.findMany({ where: { patientId: req.params.id, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { items: true, payments: true } }));
  }),
);

patientRouter.get(
  "/:id/documents",
  authorize("PHYSIOTHERAPIST", "ADMIN", "RECEPTIONIST", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    ok(res, await prisma.patientDocument.findMany({ where: { patientId: req.params.id, deletedAt: null }, orderBy: { createdAt: "desc" } }));
  }),
);

patientRouter.get(
  "/:id/progress",
  authorize("PHYSIOTHERAPIST", "ADMIN", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.params.id);
    ok(res, await patientProgress(req.params.id));
  }),
);

export async function patientProgress(patientId: string) {
  const [sessions, consultations, plan] = await Promise.all([
    prisma.therapySession.findMany({
      where: { patientId, status: "COMPLETED", deletedAt: null },
      orderBy: { completedAt: "asc" },
      select: { id: true, sessionNumber: true, completedAt: true, painBefore: true, painAfter: true, progressRating: true, rangeOfMotion: true },
    }),
    prisma.consultation.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, assessment: { select: { painScore: true, rangeOfMotion: true } } },
    }),
    prisma.treatmentPlan.findFirst({ where: { patientId, status: "ACTIVE" }, select: { id: true, title: true, prescribedSessions: true } }),
  ]);
  const completed = plan ? await prisma.therapySession.count({ where: { treatmentPlanId: plan.id, status: "COMPLETED" } }) : 0;
  const first = consultations[0]?.assessment?.painScore ?? sessions[0]?.painBefore ?? null;
  const latest = sessions.at(-1)?.painAfter ?? null;
  return {
    activePlan: plan ? { ...plan, completedSessions: completed, percent: Math.round((completed / plan.prescribedSessions) * 100) } : null,
    initialPain: first,
    latestPain: latest,
    painReduction: first !== null && latest !== null ? first - latest : null,
    timeline: sessions,
    assessments: consultations,
  };
}
