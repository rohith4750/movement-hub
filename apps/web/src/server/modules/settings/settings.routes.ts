import { Router, type Request } from "../../router";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http";
import { env } from "../../config/env";
import { audit } from "../../lib/audit";
import { forbidden, HttpError } from "../../lib/http-error";
import { authorize, STAFF } from "../../middleware/auth";
import { validate } from "../../middleware/validate";

export const settingsRouter = Router();
export const branchRouter = Router();
export const auditRouter = Router();

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

async function branchId(req: Request) {
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
        tvStaffKey: z.string().min(3).max(60).optional(),
        tvQrUrl: z.string().url().optional(),
        tvQrLabel: z.string().min(1).max(50).optional(),
        tvSlides: z.any().optional(),
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

/* ─────────────── Treatment prices (billing by treatment) ─────────────── */

const priceList = () => prisma.treatmentPrice.findMany({ orderBy: [{ sortOrder: "asc" }, { category: "asc" }] });

/** The price list used when billing. Every staff role can read it; only a Super Admin changes it. */
settingsRouter.get(
  "/treatment-prices",
  authorize(...STAFF),
  handler(async (_req, res) => ok(res, await priceList())),
);

/** Set the price of one or more treatment categories (a new category name is added to the list). */
settingsRouter.put(
  "/treatment-prices",
  authorize("SUPER_ADMIN"),
  validate({
    body: z.object({
      prices: z
        .array(z.object({ category: z.string().trim().min(2).max(60), price: z.number().nonnegative().max(1_000_000), isActive: z.boolean().optional() }))
        .min(1)
        .max(50),
    }),
  }),
  handler(async (req, res) => {
    const before = await priceList();
    const order = new Map(before.map((b) => [b.category, b.sortOrder]));
    await prisma.$transaction(
      (req.body.prices as { category: string; price: number; isActive?: boolean }[]).map((p, i) =>
        prisma.treatmentPrice.upsert({
          where: { category: p.category },
          create: { category: p.category, price: p.price, isActive: p.isActive ?? true, sortOrder: 100 + i },
          update: { price: p.price, ...(p.isActive === undefined ? {} : { isActive: p.isActive }), sortOrder: order.get(p.category) },
        }),
      ),
    );
    const after = await priceList();
    await audit(req, "UPDATE", "TreatmentPrice", null, before, after);
    ok(res, after);
  }),
);

/* ─────────────── Flush data (go-live clean-up) ─────────────── */

/**
 * Reference data that survives a flush: the branch and its settings, the service catalogues and price list, and the user
 * table itself (only admin accounts stay in it). Everything else - patients, staff profiles, appointments,
 * plans, bills, payments, notifications, audit trail - is activity and is deleted.
 */
const KEEP_TABLES = new Set(["_prisma_migrations", "Branch", "HospitalSetting", "Specialization", "TreatmentPackage", "TreatmentPrice", "User"]);
const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN"] as const;
const RESET_PHRASE = "DELETE ALL DATA";
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Which tables a flush would empty, how many rows each holds, and how many accounts go or stay. */
async function flushPlan() {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const tables = rows.map((r) => r.table_name).filter((t) => !KEEP_TABLES.has(t));
  const counts = await Promise.all(
    tables.map(async (table) => {
      const r = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM ${ident(table)}`);
      return { table, rows: r[0].n };
    }),
  );
  const [adminsKept, usersRemoved] = await Promise.all([
    prisma.user.count({ where: { role: { in: [...ADMIN_ROLES] } } }),
    prisma.user.count({ where: { role: { notIn: [...ADMIN_ROLES] } } }),
  ]);
  return { tables, counts, adminsKept, usersRemoved };
}

/** Preview only: what a flush would delete. Safe to call; changes nothing. */
settingsRouter.get(
  "/data-reset",
  authorize("SUPER_ADMIN"),
  handler(async (_req, res) => {
    const plan = await flushPlan();
    ok(res, {
      enabled: env.ALLOW_DATA_RESET === "true",
      phrase: RESET_PHRASE,
      adminsKept: plan.adminsKept,
      usersRemoved: plan.usersRemoved,
      tables: plan.counts.filter((c) => c.rows > 0),
      totalRows: plan.counts.reduce((n, c) => n + c.rows, 0),
    });
  }),
);

/**
 * Delete all activity data, keeping admin accounts, the branch and settings and the catalogues.
 * Irreversible, so it needs ALL of: the server switch (ALLOW_DATA_RESET=true), a Super Admin, that
 * person's password, and the typed phrase. Runs in one transaction: all of it or none of it.
 */
settingsRouter.post(
  "/data-reset",
  authorize("SUPER_ADMIN"),
  validate({
    body: z.object({
      confirm: z.literal(RESET_PHRASE, { errorMap: () => ({ message: `Type ${RESET_PHRASE} to confirm` }) }),
      password: z.string().min(1, "Enter your password"),
    }),
  }),
  handler(async (req, res) => {
    if (req.user!.role !== "SUPER_ADMIN") throw forbidden("Only a Super Admin can flush data");
    if (env.ALLOW_DATA_RESET !== "true") {
      throw new HttpError(403, "DATA_RESET_DISABLED", "Flushing data is switched off on this server. To allow it, set ALLOW_DATA_RESET=true in the server's environment variables and redeploy, run it, then remove the variable.");
    }
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    // 403, not 401: a 401 would make the app think the session expired and sign the user out.
    if (!me.passwordHash || !(await bcrypt.compare(req.body.password, me.passwordHash))) throw new HttpError(403, "WRONG_PASSWORD", "Password is incorrect");

    const plan = await flushPlan();
    // One TRUNCATE listing every table (no CASCADE): if a kept table pointed at a flushed one the database
    // would refuse instead of silently emptying it. Then drop every non-admin account.
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`TRUNCATE TABLE ${plan.tables.map(ident).join(", ")}`),
      prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "role" NOT IN ('SUPER_ADMIN', 'ADMIN')`),
    ]);
    const rowsDeleted = plan.counts.reduce((n, c) => n + c.rows, 0);
    // The audit trail was part of the flush, so this entry is the first one in the fresh log.
    await audit(req, "DELETE", "DataReset", me.id, null, { rowsDeleted, tables: plan.tables.length, usersRemoved: plan.usersRemoved, adminsKept: plan.adminsKept });
    ok(res, { rowsDeleted, tablesEmptied: plan.tables.length, usersRemoved: plan.usersRemoved, adminsKept: plan.adminsKept });
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
