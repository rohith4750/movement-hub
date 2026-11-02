import { prisma, type AuditAction, type Prisma } from "@movement-hub/database";
import type { Request } from "../router";

export function audit(
  req: Request,
  action: AuditAction,
  entity: string,
  entityId: string | null,
  before?: unknown,
  after?: unknown,
) {
  // Fire and forget: do not block user HTTP response for audit logging
  prisma.auditLog
    .create({
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
    })
    .catch((err) => {
      console.warn("[Audit Log Non-fatal Error]:", err?.message ?? err);
    });
  return Promise.resolve();
}

const toJson = (v: unknown) => (v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));
