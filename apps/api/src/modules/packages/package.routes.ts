import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { badRequest, unprocessable } from "../../lib/http-error.js";
import { addDays, dateOnly, todayLocal } from "../../lib/time.js";
import { assertPatientAccess, authorize, scopePatient, STAFF } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createInvoice } from "../billing/billing.service.js";
import { adjust, lockPackage } from "./package.service.js";

export const packageRouter = Router();
export const patientPackageRouter = Router();

const packageBody = z.object({
  name: z.string().min(2),
  tier: z.enum(["BASIC", "STANDARD", "PREMIUM", "CUSTOM"]),
  description: z.string().optional(),
  sessionCount: z.number().int().min(1).max(500),
  validityDays: z.number().int().min(1).max(730),
  price: z.number().nonnegative(),
  includesHomeVisit: z.boolean().default(false),
});

/* ─────────────── Catalogue ─────────────── */

packageRouter.get(
  "/",
  validate({ query: z.object({ includeInactive: z.coerce.boolean().optional() }) }),
  handler(async (req, res) => {
    const includeInactive = q<{ includeInactive?: boolean }>(req).includeInactive && req.user!.role !== "PATIENT";
    ok(res, await prisma.treatmentPackage.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { price: "asc" } }));
  }),
);

packageRouter.post("/", authorize("ADMIN"), validate({ body: packageBody }), handler(async (req, res) => {
  const p = await prisma.treatmentPackage.create({ data: req.body });
  await audit(req, "CREATE", "TreatmentPackage", p.id, null, p);
  created(res, p);
}));

packageRouter.get("/:id", validate({ params: idParam }), handler(async (req, res) => ok(res, await prisma.treatmentPackage.findUniqueOrThrow({ where: { id: req.params.id } }))));

packageRouter.patch("/:id", authorize("ADMIN"), validate({ params: idParam, body: packageBody.partial() }), handler(async (req, res) => {
  const before = await prisma.treatmentPackage.findUniqueOrThrow({ where: { id: req.params.id } });
  const p = await prisma.treatmentPackage.update({ where: { id: before.id }, data: req.body });
  await audit(req, "UPDATE", "TreatmentPackage", p.id, before, p);
  ok(res, p);
}));

packageRouter.patch("/:id/status", authorize("ADMIN"), validate({ params: idParam, body: z.object({ isActive: z.boolean() }) }), handler(async (req, res) => {
  ok(res, await prisma.treatmentPackage.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } }));
}));

/* ─────────────── Patient packages ─────────────── */

const ppInclude = {
  package: true,
  patient: { select: { id: true, patientCode: true, firstName: true, lastName: true, phone: true } },
  treatmentPlan: { select: { id: true, title: true } },
  invoiceItems: { select: { invoice: { select: { id: true, invoiceNo: true, status: true, dueAmount: true } } } },
} satisfies Prisma.PatientPackageInclude;

const listQuery = paginationQuery.extend({
  patientId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "EXHAUSTED", "EXPIRED", "CANCELLED"]).optional(),
  expiringBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

patientPackageRouter.get(
  "/",
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const where: Prisma.PatientPackageWhereInput = {
      patientId: scopePatient(req, query.patientId),
      status: query.status,
      ...(query.expiringBefore ? { expiryDate: { lte: dateOnly(query.expiringBefore) } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.patientPackage.findMany({ where, include: ppInclude, ...paging(query), orderBy: { createdAt: "desc" } }),
      prisma.patientPackage.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

/** Purchase: creates the patient package, the ledger entry and an issued invoice in one transaction. */
patientPackageRouter.post(
  "/",
  authorize("RECEPTIONIST", "ACCOUNTANT", "ADMIN", "PATIENT"),
  validate({
    body: z.object({
      patientId: z.string().uuid().optional(),
      packageId: z.string().uuid(),
      treatmentPlanId: z.string().uuid().optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      discountAmount: z.number().nonnegative().default(0),
      discountReason: z.string().optional(),
      // Custom packages: staff may override sessions/price
      customSessions: z.number().int().positive().optional(),
      customPrice: z.number().nonnegative().optional(),
    }),
  }),
  handler(async (req, res) => {
    const patientId = scopePatient(req, req.body.patientId);
    if (!patientId) throw badRequest("patientId is required");
    const isPatientUser = req.user!.role === "PATIENT";
    if (isPatientUser && (req.body.discountAmount || req.body.customSessions || req.body.customPrice !== undefined)) throw badRequest("Discounts and custom pricing are staff-only");

    const result = await prisma.$transaction(async (tx) => {
      const pkg = await tx.treatmentPackage.findUniqueOrThrow({ where: { id: req.body.packageId } });
      if (!pkg.isActive) throw unprocessable("PACKAGE_INACTIVE", "This package is no longer offered");
      if (req.body.treatmentPlanId) {
        const plan = await tx.treatmentPlan.findUniqueOrThrow({ where: { id: req.body.treatmentPlanId } });
        if (plan.patientId !== patientId) throw badRequest("Treatment plan belongs to another patient");
      }
      const sessions = req.body.customSessions ?? pkg.sessionCount;
      const price = req.body.customPrice ?? Number(pkg.price);
      const start = req.body.startDate ?? todayLocal();
      const pp = await tx.patientPackage.create({
        data: {
          patientId,
          packageId: pkg.id,
          treatmentPlanId: req.body.treatmentPlanId,
          totalSessions: sessions,
          remainingSessions: sessions,
          pricePaid: price,
          startDate: dateOnly(start),
          expiryDate: dateOnly(addDays(start, pkg.validityDays)),
          transactions: { create: { type: "PURCHASE", sessionsDelta: sessions, balanceAfter: sessions, performedById: req.user!.id } },
        },
      });
      const invoice = await createInvoice(
        tx,
        {
          patientId,
          items: [{ type: "PACKAGE", description: `${pkg.name} – ${sessions} sessions`, quantity: 1, unitPrice: price, patientPackageId: pp.id }],
          discountAmount: req.body.discountAmount,
          discountReason: req.body.discountReason,
        },
        req.user!.id,
        true,
      );
      return { patientPackage: pp, invoice };
    });
    await audit(req, "CREATE", "PatientPackage", result.patientPackage.id, null, result);
    created(res, result);
  }),
);

patientPackageRouter.get(
  "/:id",
  validate({ params: idParam }),
  handler(async (req, res) => {
    const pp = await prisma.patientPackage.findUniqueOrThrow({ where: { id: req.params.id }, include: ppInclude });
    assertPatientAccess(req, pp.patientId);
    ok(res, pp);
  }),
);

patientPackageRouter.get(
  "/:id/transactions",
  validate({ params: idParam }),
  handler(async (req, res) => {
    const pp = await prisma.patientPackage.findUniqueOrThrow({ where: { id: req.params.id } });
    assertPatientAccess(req, pp.patientId);
    ok(res, await prisma.packageTransaction.findMany({ where: { patientPackageId: pp.id }, orderBy: { createdAt: "asc" }, include: { therapySession: { select: { id: true, sessionNumber: true, completedAt: true } } } }));
  }),
);

patientPackageRouter.post(
  "/:id/adjust",
  authorize("ADMIN"),
  validate({ params: idParam, body: z.object({ sessionsDelta: z.number().int().refine((n) => n !== 0, "Must not be zero"), note: z.string().min(3) }) }),
  handler(async (req, res) => {
    const pp = await prisma.$transaction((tx) => adjust(tx, req.params.id, req.body.sessionsDelta, req.user!.id, req.body.note));
    await audit(req, "UPDATE", "PatientPackage", pp.id, null, req.body);
    ok(res, pp);
  }),
);

patientPackageRouter.post(
  "/:id/extend",
  authorize("ADMIN"),
  validate({ params: idParam, body: z.object({ days: z.number().int().min(1).max(365), note: z.string().min(3) }) }),
  handler(async (req, res) => {
    const pp = await prisma.$transaction(async (tx) => {
      const current = await lockPackage(tx, req.params.id);
      if (current.status === "CANCELLED") throw unprocessable("PACKAGE_CANCELLED", "Cancelled packages cannot be extended");
      const expiry = dateOnly(addDays(current.expiryDate.toISOString().slice(0, 10), req.body.days));
      const reopen = current.status === "EXPIRED" && current.remainingSessions > 0 && expiry >= dateOnly(todayLocal());
      await tx.packageTransaction.create({
        data: { patientPackageId: current.id, type: "ADJUSTMENT", sessionsDelta: 0, balanceAfter: current.remainingSessions, performedById: req.user!.id, note: `Validity +${req.body.days} days: ${req.body.note}` },
      });
      return tx.patientPackage.update({ where: { id: current.id }, data: { expiryDate: expiry, status: reopen ? "ACTIVE" : current.status } });
    });
    await audit(req, "UPDATE", "PatientPackage", pp.id, null, req.body);
    ok(res, pp);
  }),
);

patientPackageRouter.post(
  "/:id/cancel",
  authorize("ADMIN"),
  validate({ params: idParam, body: z.object({ reason: z.string().min(3) }) }),
  handler(async (req, res) => {
    const pp = await prisma.$transaction(async (tx) => {
      const current = await lockPackage(tx, req.params.id);
      await tx.packageTransaction.create({
        data: { patientPackageId: current.id, type: "ADJUSTMENT", sessionsDelta: -current.remainingSessions, balanceAfter: 0, performedById: req.user!.id, note: `Cancelled: ${req.body.reason}` },
      });
      return tx.patientPackage.update({ where: { id: current.id }, data: { status: "CANCELLED", remainingSessions: 0 } });
    });
    await audit(req, "UPDATE", "PatientPackage", pp.id, null, { status: "CANCELLED", reason: req.body.reason });
    ok(res, pp);
  }),
);

// Staff-only list helper for dashboard widgets
patientPackageRouter.get(
  "/expiring/soon",
  authorize(...STAFF),
  handler(async (_req, res) => {
    ok(res, await prisma.patientPackage.findMany({ where: { status: "ACTIVE", expiryDate: { lte: dateOnly(addDays(todayLocal(), 7)) } }, include: ppInclude, orderBy: { expiryDate: "asc" } }));
  }),
);
