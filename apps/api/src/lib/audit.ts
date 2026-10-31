import { prisma, type AuditAction, type Prisma } from "@movement-hub/database";
import type { Request } from "express";

export async function audit(
  req: Request,
  action: AuditAction,
  entity: string,
  entityId: string | null,
  before?: unknown,
  after?: unknown,
) {
  await prisma.auditLog.create({
    data: {
      userId: req.user?.id,
      action,
      entity,
      entityId,
      before: toJson(before),
      after: toJson(after),
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    },
  });
}

const toJson = (v: unknown) => (v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));
