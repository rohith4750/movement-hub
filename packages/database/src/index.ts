import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaUrl?: string };

const dbUrl =
  process.env.DATABASE_URL_POOLED ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.PRISMA_DATABASE_URL;

if (!dbUrl) {
  console.error(
    "[database] No database URL found. Set DATABASE_URL (or DATABASE_URL_POOLED) in apps/web/.env.local for local dev, or in the Vercel project settings.",
  );
}

// Reuse the cached client across hot reloads and warm serverless invocations — but only if it was
// created for the same URL. A client created before the env var existed would otherwise stay broken
// until the server restarts.
const cached = globalForPrisma.prisma && globalForPrisma.prismaUrl === dbUrl ? globalForPrisma.prisma : undefined;

export const prisma =
  cached ??
  new PrismaClient({
    datasources: dbUrl ? { db: { url: dbUrl } } : undefined,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (!cached) {
  void globalForPrisma.prisma?.$disconnect().catch(() => {});
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaUrl = dbUrl;
}
