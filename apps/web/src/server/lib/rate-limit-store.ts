import { prisma } from "@movement-hub/database";
import type { RateLimitStore } from "../router";

/**
 * Rate-limit counters in Postgres, shared by every server instance. In-memory counters reset on
 * each cold start and are split across serverless instances, so they can't protect sign-in.
 * One row per limiter+client; the upsert is a single atomic statement.
 */
export const postgresStore: RateLimitStore = {
  async hit(key, windowMs) {
    const [row] = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "resetAt")
      VALUES (${key}, 1, timezone('UTC', now()) + ${windowMs}::int * interval '1 millisecond')
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "RateLimit"."resetAt" <= timezone('UTC', now()) THEN 1 ELSE "RateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimit"."resetAt" <= timezone('UTC', now()) THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
      RETURNING "count", "resetAt"`;
    // Occasionally clear out long-expired rows so the table stays small.
    if (Math.random() < 0.01) await prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "resetAt" < timezone('UTC', now()) - interval '1 hour'`;
    return { count: row.count, resetAt: row.resetAt.getTime() };
  },
  async undo(key) {
    await prisma.$executeRaw`UPDATE "RateLimit" SET "count" = GREATEST("count" - 1, 0) WHERE "key" = ${key} AND "resetAt" > timezone('UTC', now())`;
  },
};
