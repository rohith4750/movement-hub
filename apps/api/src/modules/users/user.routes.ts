import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { authorize } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { phoneSchema } from "../../lib/validators.js";
import { forbidden } from "../../lib/http-error.js";
import { clearPinLock, pinFields, pinSchema } from "../../lib/pin.js";
import { deleteStaffUser } from "./user.service.js";

export const userRouter = Router();
// authorize("ADMIN") also admits SUPER_ADMIN; with ADMIN unassignable, only Super Admins manage users.
userRouter.use(authorize("ADMIN"));

/**
 * Current phase: internal use with two roles only — Super Admin (everything) and Physiotherapist.
 * ADMIN / RECEPTIONIST / ACCOUNTANT still exist in the database enum (dormant) but can't be assigned.
 * Physiotherapists are created via /therapists so they get a profile and schedule.
 */
const activeRole = z.enum(["SUPER_ADMIN", "PHYSIOTHERAPIST"]);
const creatableRole = z.literal("SUPER_ADMIN", { errorMap: () => ({ message: "Only Super Admin accounts can be created here. Add physiotherapists from the Therapists page." }) });
const select = { id: true, name: true, email: true, phone: true, role: true, branchId: true, isActive: true, lastLoginAt: true, createdAt: true, pinHash: true };

/** Never send the PIN hash to the client — only whether a PIN is set. */
type WithPin = { pinHash: string | null } & Record<string, unknown>;
const publicUser = <T extends WithPin>({ pinHash, ...u }: T) => ({ ...u, hasPin: !!pinHash });

const listQuery = paginationQuery.extend({ role: activeRole.optional(), isActive: z.coerce.boolean().optional() });

userRouter.get(
  "/",
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const where = {
      role: query.role ?? { not: "PATIENT" as const },
      isActive: query.isActive,
      deletedAt: null,
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" as const } }, { email: { contains: query.search } }, { phone: { contains: query.search } }] } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.user.findMany({ where, select, ...paging(query), orderBy: { createdAt: "desc" } }),
      prisma.user.count({ where }),
    ]);
    ok(res, data.map(publicUser), meta(query, total));
  }),
);

userRouter.post(
  "/",
  validate({
    body: z.object({
      name: z.string().min(2),
      email: z.string().email().toLowerCase(),
      phone: phoneSchema,
      role: creatableRole.default("SUPER_ADMIN"),
      password: z.string().min(8, "Password must be at least 8 characters"),
      pin: pinSchema, // mobile-app PIN
      branchId: z.string().uuid().optional(),
    }),
  }),
  handler(async (req, res) => {
    const { password, pin, ...data } = req.body;
    const user = await prisma.user.create({
      data: { ...data, branchId: data.branchId ?? req.user!.branchId, passwordHash: await bcrypt.hash(password, 10), ...(await pinFields(pin)) },
      select,
    });
    await audit(req, "CREATE", "User", user.id, null, publicUser(user));
    created(res, publicUser(user));
  }),
);

userRouter.get("/:id", validate({ params: idParam }), handler(async (req, res) => ok(res, publicUser(await prisma.user.findUniqueOrThrow({ where: { id: req.params.id }, select })))));

/** Admin sets / resets a staff member's mobile-app PIN. Signs them out everywhere and clears any lockout. */
userRouter.post(
  "/:id/pin",
  validate({ params: idParam, body: z.object({ pin: pinSchema }) }),
  handler(async (req, res) => {
    const target = await prisma.user.findFirstOrThrow({ where: { id: req.params.id, deletedAt: null } });
    if (target.role === "PATIENT") throw forbidden("Patients don't use staff PINs");
    if (target.role === "SUPER_ADMIN" && req.user!.role !== "SUPER_ADMIN") throw forbidden("Only a Super Admin can change a Super Admin's PIN");
    const fields = await pinFields(req.body.pin, target.id);
    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: fields }),
      prisma.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await clearPinLock(target.id, req.user!.id);
    await audit(req, "UPDATE", "User", target.id, null, { pinReset: true });
    ok(res, { pinSet: true });
  }),
);

userRouter.patch(
  "/:id",
  validate({
    params: idParam,
    body: z.object({ name: z.string().min(2), email: z.string().email().toLowerCase(), phone: phoneSchema, branchId: z.string().uuid() }).partial(), // role changes disabled in this phase
  }),
  handler(async (req, res) => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id }, select });
    const user = await prisma.user.update({ where: { id: req.params.id }, data: req.body, select });
    await audit(req, "UPDATE", "User", user.id, publicUser(before), publicUser(user));
    ok(res, publicUser(user));
  }),
);

userRouter.delete(
  "/:id",
  validate({ params: idParam }),
  handler(async (req, res) => {
    const result = await deleteStaffUser(req.params.id, req.user!.id);
    await audit(req, "DELETE", "User", req.params.id, null, result);
    ok(res, result);
  }),
);

userRouter.patch(
  "/:id/status",
  validate({ params: idParam, body: z.object({ isActive: z.boolean() }) }),
  handler(async (req, res) => {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive }, select });
    if (!req.body.isActive) await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(req, "UPDATE", "User", user.id, null, { isActive: user.isActive });
    ok(res, publicUser(user));
  }),
);
