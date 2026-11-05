/**
 * Applies pending Prisma migrations before `next build`, on Vercel PRODUCTION deploys only.
 * Preview deploys and local builds skip it, so they never change the production database.
 * Force it elsewhere with MIGRATE_ON_BUILD=true.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = path.resolve(here, "../../../packages/database/prisma/schema.prisma");
const isProd = process.env.VERCEL_ENV === "production";
const forced = process.env.MIGRATE_ON_BUILD === "true";

if (!isProd && !forced) {
  console.log(`[migrate] Skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "local"}). Runs on production deploys only.`);
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.warn("[migrate] DATABASE_URL is not set — skipping migrations. Add it in Vercel → Settings → Environment Variables.");
  process.exit(0);
}

console.log("[migrate] Applying pending migrations…");
const r = spawnSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], { stdio: "inherit", shell: process.platform === "win32" });
if (r.status !== 0) {
  console.error("[migrate] Migration failed — stopping the build so the new code doesn't go live against an old database.");
  process.exit(r.status ?? 1);
}
