import { Router } from "../../router";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "../../router";
import { z } from "zod";
import { prisma, type User } from "@movement-hub/database";
import { env } from "../../config/env";
import { handler, ok } from "../../lib/http";
import { badRequest, unauthorized } from "../../lib/http-error";
import { nextCode } from "../../lib/codes";
import { authenticate, type AccessPayload } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { looksLikePhone, normalizePhone, phoneSchema } from "../../lib/validators";
import { notify } from "../notifications/notification.service";
import { assertNotLocked, checkPin, pinFields, pinInputSchema, pinLookup, pinSchema, recordPinResult } from "../../lib/pin";

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const phone = phoneSchema;
const password = z.string().min(8).max(100);

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

async function issueTokens(user: User, req: { ip?: string; get(h: string): string | undefined }) {
  const [therapist, patient] = await Promise.all([
    prisma.therapist.findUnique({ where: { userId: user.id }, select: { id: true } }),
    prisma.patient.findUnique({ where: { userId: user.id }, select: { id: true } }),
  ]);
  const payload: AccessPayload = {
    sub: user.id,
    role: user.role,
    branchId: user.branchId,
    therapistId: therapist?.id ?? null,
    patientId: patient?.id ?? null,
  };
  const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as jwt.SignOptions);
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      userAgent: req.get("user-agent"),
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_EXPIRES_DAYS * 86_400_000),
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: payload.role, branchId: payload.branchId, therapistId: payload.therapistId, patientId: payload.patientId },
  };
}

authRouter.post(
  "/login",
  limiter,
  validate({ body: z.object({ identifier: z.string().min(3), password: z.string().min(1) }) }),
  handler(async (req, res) => {
    const { identifier, password: pw } = req.body;
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier.toLowerCase() }, { phone: looksLikePhone(identifier) ? normalizePhone(identifier) : identifier }], deletedAt: null },
    });
    if (!user?.passwordHash || !user.isActive || !(await bcrypt.compare(pw, user.passwordHash))) {
      throw unauthorized("Invalid credentials");
    }
    ok(res, await issueTokens(user, req));
  }),
);

/* ─────────────── Staff mobile-app PIN ─────────────── */

// PIN-only sign-in has no account to lock before the PIN matches, so wrong guesses are limited per
// device/IP. Successful sign-ins don't count, so staff sharing the clinic Wi-Fi aren't blocked.
const pinLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ success: false, error: { code: "TOO_MANY_ATTEMPTS", message: "Too many PIN attempts from this device. Please wait 15 minutes and try again." } }),
});

/** Mobile app sign-in for staff: 6-digit PIN only (each staff member's PIN is unique). */
authRouter.post(
  "/pin/login",
  pinLimiter,
  validate({ body: z.object({ pin: pinInputSchema }) }),
  handler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { pinLookup: pinLookup(req.body.pin) } });
    // Belt and braces: the fingerprint matched, now verify the bcrypt hash too.
    if (!user || user.deletedAt || user.role === "PATIENT" || !(await checkPin(req.body.pin, user.pinHash))) {
      throw unauthorized("Incorrect PIN. Forgot it? Ask your admin to reset it.");
    }
    if (!user.isActive) throw unauthorized("Your account is disabled. Please contact your admin.");
    await assertNotLocked(user.id);
    await recordPinResult(user.id, true, { ip: req.ip, userAgent: req.get("user-agent") });
    ok(res, await issueTokens(user, req));
  }),
);

/** Staff change their own PIN (from the app's profile). */
authRouter.post(
  "/pin/change",
  authenticate,
  limiter,
  validate({ body: z.object({ currentPin: pinInputSchema, newPin: pinSchema }) }),
  handler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.role === "PATIENT" || !user.pinHash) throw unauthorized("No app PIN is set for this account");
    await assertNotLocked(user.id);
    const meta = { ip: req.ip, userAgent: req.get("user-agent") };
    if (!(await checkPin(req.body.currentPin, user.pinHash))) {
      const left = await recordPinResult(user.id, false, meta);
      throw unauthorized(`Current PIN is incorrect. ${left} attempt${left === 1 ? "" : "s"} left.`);
    }
    if (req.body.currentPin === req.body.newPin) throw badRequest("New PIN must be different from the current PIN");
    const fields = await pinFields(req.body.newPin, user.id);
    await recordPinResult(user.id, true, meta);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: fields });
      // Sign out other devices; this one gets a fresh session below.
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    ok(res, await issueTokens(user, req));
  }),
);

authRouter.post(
  "/otp/request",
  limiter,
  validate({ body: z.object({ phone }) }),
  handler(async (req, res) => {
    const code = String(crypto.randomInt(100000, 999999));
    await prisma.otpCode.create({
      data: { phone: req.body.phone, codeHash: sha256(code), expiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    await notify({ phone: req.body.phone, channel: "SMS", type: "APPOINTMENT_CONFIRMATION", templateKey: "otp", payload: { code } });
    ok(res, { sent: true, expiresInSeconds: 300, ...(env.NODE_ENV === "development" ? { devCode: code } : {}) });
  }),
);

authRouter.post(
  "/otp/verify",
  limiter,
  validate({
    body: z.object({
      phone,
      code: z.string().length(6),
      firstName: z.string().min(1).optional(),
      lastName: z.string().optional(),
      gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
    }),
  }),
  handler(async (req, res) => {
    const { phone: ph, code, firstName, lastName, gender } = req.body;
    const otp = await prisma.otpCode.findFirst({
      where: { phone: ph, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp || otp.attempts >= 5) throw unauthorized("OTP expired. Request a new one.");
    if (otp.codeHash !== sha256(code)) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw unauthorized("Incorrect OTP");
    }
    let user = await prisma.user.findUnique({ where: { phone: ph } });
    if (!user) {
      // Patient registered at reception: link the existing record — no re-registration needed.
      const existing = await prisma.patient.findFirst({ where: { phone: ph, userId: null, deletedAt: null }, orderBy: { createdAt: "asc" } });
      if (existing) {
        user = await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({
            data: { role: "PATIENT", name: `${existing.firstName} ${existing.lastName ?? ""}`.trim(), phone: ph, email: existing.email ?? undefined, branchId: existing.branchId },
          });
          await tx.patient.update({ where: { id: existing.id }, data: { userId: u.id } });
          return u;
        });
      } else {
        const branch = await prisma.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
        if (!branch) throw badRequest("No active branch configured");
        if (!firstName || !gender) throw badRequest("New patient: firstName and gender are required", "REGISTRATION_REQUIRED");
        user = await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({ data: { role: "PATIENT", name: `${firstName} ${lastName ?? ""}`.trim(), phone: ph, branchId: branch.id } });
          await tx.patient.create({
            data: { userId: u.id, branchId: branch.id, patientCode: await nextCode(tx, "patient"), firstName, lastName, gender, phone: ph },
          });
          return u;
        });
      }
    }
    if (!user.isActive) throw unauthorized("Account disabled");
    await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
    ok(res, await issueTokens(user, req));
  }),
);

authRouter.post(
  "/refresh",
  validate({ body: z.object({ refreshToken: z.string().min(10) }) }),
  handler(async (req, res) => {
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(req.body.refreshToken) }, include: { user: true } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.isActive) throw unauthorized("Invalid refresh token");
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }); // rotation
    ok(res, await issueTokens(stored.user, req));
  }),
);

authRouter.post(
  "/logout",
  authenticate,
  validate({ body: z.object({ refreshToken: z.string().optional() }) }),
  handler(async (req, res) => {
    if (req.body.refreshToken) {
      await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(req.body.refreshToken), userId: req.user!.id }, data: { revokedAt: new Date() } });
    }
    ok(res, { loggedOut: true });
  }),
);

authRouter.get(
  "/me",
  authenticate,
  handler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: {
        id: true, name: true, email: true, phone: true, role: true, branchId: true,
        therapist: { select: { id: true, colorTag: true } },
        patient: { select: { id: true, patientCode: true, firstName: true, lastName: true } },
      },
    });
    ok(res, user);
  }),
);

authRouter.post(
  "/change-password",
  authenticate,
  validate({ body: z.object({ currentPassword: z.string(), newPassword: password }) }),
  handler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.passwordHash || !(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) throw unauthorized("Current password is incorrect");
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(req.body.newPassword, 10) } }),
      prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    ok(res, { changed: true });
  }),
);

authRouter.post(
  "/forgot-password",
  limiter,
  validate({ body: z.object({ identifier: z.string().min(3) }) }),
  handler(async (req, res) => {
    const user = await prisma.user.findFirst({ where: { OR: [{ email: req.body.identifier.toLowerCase() }, { phone: looksLikePhone(req.body.identifier) ? normalizePhone(req.body.identifier) : req.body.identifier }] } });
    if (user && user.role !== "PATIENT") {
      const code = String(crypto.randomInt(100000, 999999));
      await prisma.otpCode.create({ data: { phone: user.phone, codeHash: sha256(code), expiresAt: new Date(Date.now() + 10 * 60_000) } });
      await notify({ userId: user.id, phone: user.phone, channel: "SMS", type: "APPOINTMENT_CONFIRMATION", templateKey: "password_reset", payload: { code } });
    }
    ok(res, { sent: true }); // same response either way: no account enumeration
  }),
);

authRouter.post(
  "/reset-password",
  limiter,
  validate({ body: z.object({ identifier: z.string(), code: z.string().length(6), newPassword: password }) }),
  handler(async (req, res) => {
    const user = await prisma.user.findFirst({ where: { OR: [{ email: req.body.identifier.toLowerCase() }, { phone: looksLikePhone(req.body.identifier) ? normalizePhone(req.body.identifier) : req.body.identifier }] } });
    if (!user) throw unauthorized("Invalid reset code");
    const otp = await prisma.otpCode.findFirst({
      where: { phone: user.phone, usedAt: null, expiresAt: { gt: new Date() }, codeHash: sha256(req.body.code) },
    });
    if (!otp) throw unauthorized("Invalid reset code");
    await prisma.$transaction([
      prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(req.body.newPassword, 10) } }),
      prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    ok(res, { reset: true });
  }),
);
