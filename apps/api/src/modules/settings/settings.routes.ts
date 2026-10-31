import { Router } from "express";
import { z } from "zod";
import { prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { authorize } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";

export const settingsRouter = Router();
export const branchRouter = Router();
export const auditRouter = Router();

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

async function branchId(req: Express.Request) {
  return req.user!.branchId ?? (await prisma.branch.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
}

settingsRouter.get(
  "/",
  authorize("ADMIN"),
  handler(async (req, res) => {
    const id = await branchId(req);
    ok(res, await prisma.hospitalSetting.findUniqueOrThrow({ where: { branchId: id }, include: { branch: true } }));
  }),
);

settingsRouter.patch(
  "/",
  authorize("SUPER_ADMIN"),
  validate({
    body: z
      .object({
        defaultSlotMinutes: z.number().int().min(10).max(120),
        openingTime: time,
        closingTime: time,
        gstPercent: z.number().min(0).max(28),
        consultationFee: z.number().nonnegative(),
        therapySessionFee: z.number().nonnegative(),
        homeVisitFee: z.number().nonnegative(),
        travelChargePerKm: z.number().nonnegative(),
        cancellationHours: z.number().int().min(0).max(72),
        reminderHoursBefore: z.number().int().min(1).max(72),
        invoicePrefix: z.string().min(1).max(10),
      })
      .partial(),
  }),
  handler(async (req, res) => {
    const id = await branchId(req);
    const before = await prisma.hospitalSetting.findUniqueOrThrow({ where: { branchId: id } });
    const s = await prisma.hospitalSetting.update({ where: { branchId: id }, data: req.body });
    await audit(req, "UPDATE", "HospitalSetting", s.id, before, s);
    ok(res, s);
  }),
);

/* ─────────────── Branches ─────────────── */

const branchBody = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(20).toUpperCase(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  pincode: z.string().regex(/^\d{6}$/),
  gstin: z.string().optional(),
});

branchRouter.get("/", authorize("SUPER_ADMIN"), handler(async (_req, res) => ok(res, await prisma.branch.findMany({ orderBy: { createdAt: "asc" } }))));

branchRouter.post(
  "/",
  authorize("SUPER_ADMIN"),
  validate({ body: branchBody.extend({ consultationFee: z.number().nonnegative(), therapySessionFee: z.number().nonnegative(), homeVisitFee: z.number().nonnegative() }) }),
  handler(async (req, res) => {
    const { consultationFee, therapySessionFee, homeVisitFee, ...data } = req.body;
    const b = await prisma.branch.create({ data: { ...data, settings: { create: { consultationFee, therapySessionFee, homeVisitFee } } }, include: { settings: true } });
    await audit(req, "CREATE", "Branch", b.id, null, b);
    created(res, b);
  }),
);

branchRouter.patch(
  "/:id",
  authorize("SUPER_ADMIN"),
  validate({ params: idParam, body: branchBody.partial().extend({ isActive: z.boolean().optional() }) }),
  handler(async (req, res) => {
    const b = await prisma.branch.update({ where: { id: req.params.id }, data: req.body });
    await audit(req, "UPDATE", "Branch", b.id, null, req.body);
    ok(res, b);
  }),
);

/* ─────────────── Audit log ─────────────── */

const auditQuery = paginationQuery.extend({
  entity: z.string().optional(),
  entityId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

auditRouter.get(
  "/",
  authorize("SUPER_ADMIN"),
  validate({ query: auditQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof auditQuery>>(req);
    const where = {
      entity: query.entity,
      entityId: query.entityId,
      userId: query.userId,
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({ where, ...paging(query), orderBy: { createdAt: "desc" }, include: { user: { select: { name: true, role: true } } } }),
      prisma.auditLog.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);
