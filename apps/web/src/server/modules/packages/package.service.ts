import { prisma, type Prisma } from "@movement-hub/database";
import { conflict, notFound, unprocessable } from "../../lib/http-error";
import { dateOnly, localDateString } from "../../lib/time";

type Tx = Prisma.TransactionClient;

/** Lock a patient package row for the rest of the transaction. */
export async function lockPackage(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "PatientPackage" WHERE "id" = ${id} FOR UPDATE`;
  const pkg = await tx.patientPackage.findUnique({ where: { id } });
  if (!pkg) throw notFound("Patient package");
  return pkg;
}

/** Deduct one session when a therapy session completes. Writes to the ledger. */
export async function useSession(tx: Tx, patientPackageId: string, therapySessionId: string, performedById: string) {
  const pkg = await lockPackage(tx, patientPackageId);
  if (pkg.status !== "ACTIVE") throw unprocessable("PACKAGE_INACTIVE", `Package is ${pkg.status.toLowerCase()}`);
  if (localDateString(new Date()) > pkg.expiryDate.toISOString().slice(0, 10)) throw unprocessable("PACKAGE_EXPIRED", "Package has expired");
  if (pkg.remainingSessions <= 0) throw conflict("PACKAGE_EXHAUSTED", "No remaining sessions in this package");
  const remaining = pkg.remainingSessions - 1;
  const updated = await tx.patientPackage.update({
    where: { id: pkg.id },
    data: { usedSessions: { increment: 1 }, remainingSessions: remaining, status: remaining === 0 ? "EXHAUSTED" : "ACTIVE" },
  });
  await tx.packageTransaction.create({
    data: { patientPackageId: pkg.id, type: "SESSION_USED", sessionsDelta: -1, balanceAfter: remaining, therapySessionId, performedById },
  });
  return updated;
}

export async function adjust(tx: Tx, patientPackageId: string, delta: number, performedById: string, note: string) {
  const pkg = await lockPackage(tx, patientPackageId);
  const remaining = pkg.remainingSessions + delta;
  if (remaining < 0) throw unprocessable("NEGATIVE_BALANCE", "Adjustment would make the balance negative");
  const updated = await tx.patientPackage.update({
    where: { id: pkg.id },
    data: {
      remainingSessions: remaining,
      totalSessions: { increment: delta > 0 ? delta : 0 },
      usedSessions: delta < 0 ? { increment: -delta } : undefined,
      status: remaining === 0 ? "EXHAUSTED" : pkg.status === "EXHAUSTED" ? "ACTIVE" : pkg.status,
    },
  });
  await tx.packageTransaction.create({ data: { patientPackageId: pkg.id, type: "ADJUSTMENT", sessionsDelta: delta, balanceAfter: remaining, performedById, note } });
  return updated;
}

/** Nightly: mark expired packages and record the forfeited balance. */
export async function expirePackages(systemUserId: string) {
  const today = dateOnly(localDateString(new Date()));
  const expired = await prisma.patientPackage.findMany({ where: { status: "ACTIVE", expiryDate: { lt: today } } });
  for (const p of expired) {
    await prisma.$transaction([
      prisma.patientPackage.update({ where: { id: p.id }, data: { status: "EXPIRED" } }),
      prisma.packageTransaction.create({
        data: { patientPackageId: p.id, type: "EXPIRED", sessionsDelta: 0, balanceAfter: p.remainingSessions, performedById: systemUserId, note: `${p.remainingSessions} unused session(s) at expiry` },
      }),
    ]);
  }
  return expired.length;
}
