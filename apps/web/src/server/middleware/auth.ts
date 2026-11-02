import type { NextFunction, Request, Response } from "../router";
import jwt from "jsonwebtoken";
import type { Role } from "@movement-hub/database";
import { env } from "../config/env";
import { forbidden, unauthorized } from "../lib/http-error";

export interface AuthUser {
  id: string;
  role: Role;
  branchId: string | null;
  patientId: string | null;
  therapistId: string | null;
}

export interface AccessPayload {
  sub: string;
  role: Role;
  branchId: string | null;
  patientId: string | null;
  therapistId: string | null;
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(unauthorized());
  try {
    const p = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as AccessPayload;
    req.user = { id: p.sub, role: p.role, branchId: p.branchId, patientId: p.patientId, therapistId: p.therapistId };
    next();
  } catch {
    next(unauthorized("Invalid or expired token"));
  }
}

export const STAFF: Role[] = ["SUPER_ADMIN", "ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST", "ACCOUNTANT"];

/**
 * Movement Hub has no receptionist or accountant: physiotherapists run the front desk and billing
 * themselves. So a PHYSIOTHERAPIST also holds the RECEPTIONIST and ACCOUNTANT permissions.
 * (Admin-only actions — staff, therapists, settings, deleting patients — stay with SUPER_ADMIN.)
 */
const ALSO_ACTS_AS: Partial<Record<Role, Role[]>> = {
  PHYSIOTHERAPIST: ["RECEPTIONIST", "ACCOUNTANT"],
};

export function roleAllows(role: Role, allowed: Role[]) {
  if (role === "SUPER_ADMIN" || allowed.includes(role)) return true;
  return (ALSO_ACTS_AS[role] ?? []).some((r) => allowed.includes(r));
}

/** Allow only the listed roles. SUPER_ADMIN is always allowed; see ALSO_ACTS_AS for physios. */
export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (roleAllows(req.user.role, roles)) return next();
    next(forbidden());
  };
}

export const isPatient = (req: Request) => req.user?.role === "PATIENT";

/** Patients may only touch their own records. Staff pass through. */
export function assertPatientAccess(req: Request, patientId: string) {
  if (isPatient(req) && req.user!.patientId !== patientId) throw forbidden();
}

/** For list endpoints: force patient users to their own id. */
export function scopePatient(req: Request, requested?: string) {
  if (isPatient(req)) {
    if (!req.user!.patientId) throw forbidden("No patient profile linked to this account");
    return req.user!.patientId;
  }
  return requested;
}
