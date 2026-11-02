import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@movement-hub/database";
import { env } from "../config/env";
import { conflict, HttpError } from "./http-error";

/**
 * Mobile-app PIN for staff (admins set it when creating the user, and can reset it).
 * - 6 digits, stored only as a bcrypt hash in User.pinHash (separate from the web password).
 * - Lockout: 5 wrong PINs within 15 minutes locks PIN sign-in for 15 minutes.
 *   Attempts are written to the audit log, so they also appear in the security trail.
 */
export const PIN_LENGTH = 6;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

function isWeak(pin: string) {
  if (/^(\d)\1+$/.test(pin)) return true; // 000000, 111111 …
  const digits = pin.split("").map(Number);
  const up = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
  const down = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
  if (up || down) return true; // 123456, 654321, 890123 …
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d\d\d)\1$/.test(pin)) return true; // 121212, 123123
  return ["112233", "102030", "147258", "159753", "123321", "696969"].includes(pin);
}

export const pinSchema = z
  .string({ required_error: "PIN is required" })
  .regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), `PIN must be exactly ${PIN_LENGTH} digits`)
  .refine((p) => !isWeak(p), "This PIN is too easy to guess. Avoid repeated or sequential digits like 111111 or 123456.");

export const pinInputSchema = z.string().regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), `Enter your ${PIN_LENGTH}-digit PIN`);

export const hashPin = (pin: string) => bcrypt.hash(pin, 10);
export const checkPin = (pin: string, hash: string | null) => (hash ? bcrypt.compare(pin, hash) : Promise.resolve(false));

/**
 * Deterministic, secret-keyed fingerprint of a PIN. Lets PIN-only sign-in find the user in one
 * indexed lookup, and enforces "no two staff share a PIN" via a unique index. Without the server
 * secret the fingerprint can't be reversed or brute-forced offline.
 */
export const pinLookup = (pin: string) => crypto.createHmac("sha256", `${env.JWT_REFRESH_SECRET}:mobile-pin`).update(pin).digest("hex");

/** Fields to store for a new PIN. Throws 409 if another active staff member already uses it. */
export async function pinFields(pin: string, forUserId?: string) {
  const lookup = pinLookup(pin);
  const taken = await prisma.user.findFirst({ where: { pinLookup: lookup, ...(forUserId ? { id: { not: forUserId } } : {}) }, select: { id: true } });
  if (taken) throw conflict("PIN_TAKEN", "This PIN is already used by another staff member. Please choose a different PIN.");
  return { pinHash: await hashPin(pin), pinLookup: lookup };
}

/* ───────────── lockout ───────────── */

async function failuresSinceLastSuccess(userId: string) {
  const windowStart = new Date(Date.now() - PIN_LOCK_MINUTES * 60_000);
  const lastOk = await prisma.auditLog.findFirst({
    where: { userId, action: "LOGIN", entity: "PIN_OK", createdAt: { gte: windowStart } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const since = lastOk?.createdAt ?? windowStart;
  return prisma.auditLog.findMany({
    where: { userId, action: "LOGIN", entity: "PIN_FAILED", createdAt: { gt: since } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
}

export async function assertNotLocked(userId: string) {
  const fails = await failuresSinceLastSuccess(userId);
  if (fails.length >= PIN_MAX_ATTEMPTS) {
    const unlockAt = fails[fails.length - PIN_MAX_ATTEMPTS].createdAt.getTime() + PIN_LOCK_MINUTES * 60_000;
    const mins = Math.max(1, Math.ceil((unlockAt - Date.now()) / 60_000));
    throw new HttpError(429, "PIN_LOCKED", `Too many wrong PINs. Try again in ${mins} minute${mins > 1 ? "s" : ""}, or ask your admin to reset your PIN.`);
  }
}

/** Record a PIN attempt. Returns how many attempts are left before lockout. */
export async function recordPinResult(userId: string, success: boolean, meta: { ip?: string; userAgent?: string }) {
  await prisma.auditLog.create({
    data: { userId, action: "LOGIN", entity: success ? "PIN_OK" : "PIN_FAILED", entityId: userId, ipAddress: meta.ip, userAgent: meta.userAgent },
  });
  if (success) return PIN_MAX_ATTEMPTS;
  const fails = await failuresSinceLastSuccess(userId);
  return Math.max(0, PIN_MAX_ATTEMPTS - fails.length);
}

/** Clear any lockout (used when an admin resets the PIN). */
export async function clearPinLock(userId: string, adminId: string) {
  await prisma.auditLog.create({ data: { userId, action: "LOGIN", entity: "PIN_OK", entityId: userId, after: { resetBy: adminId } } });
}
