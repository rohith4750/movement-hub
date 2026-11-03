import { prisma, type AuditAction, type Prisma } from "@movement-hub/database";
import type { Request } from "../router";

/**
 * Write an audit entry. Always awaited: on serverless, work left running after the response is
 * sent can be dropped, which used to lose entries silently.
 *
 * - Pass `tx` to write the entry in the same transaction as the change, so neither can exist
 *   without the other. Use this for anything that destroys data (deletes) or moves money.
 * - Without `tx`, the change is already committed; a failed write is logged loudly, not thrown,
 *   so the user isn't told their (successful) action failed.
 */
export async function audit(
  req: Request,
  action: AuditAction,
  entity: string,
  entityId: string | null,
  before?: unknown,
  after?: unknown,
  tx?: Prisma.TransactionClient,
) {
  const data: Prisma.AuditLogUncheckedCreateInput = {
    userId: req.user?.id,
    action,
    entity,
    entityId,
    before: toJson(before),
    after: toJson(after),
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  };
  if (tx) {
    await tx.auditLog.create({ data });
    return;
  }
  try {
    await prisma.auditLog.create({ data });
  } catch (err) {
    console.error("[audit] FAILED to record", action, entity, entityId, "-", (err as Error)?.message ?? err);
  }
}

const toJson = (v: unknown) => (v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));
