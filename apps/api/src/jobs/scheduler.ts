import { prisma } from "@movement-hub/database";
import { addDays, todayLocal } from "../lib/time.js";
import { generateSlots } from "../modules/scheduling/scheduling.service.js";
import { dispatch, notifyPatient } from "../modules/notifications/notification.service.js";
import { expirePackages } from "../modules/packages/package.service.js";

/**
 * In-process job runner. Runs:
 *  - every minute: send due scheduled notifications (reminders)
 *  - hourly: keep 30 days of slots generated for every active therapist
 *  - hourly: expire packages and warn about packages expiring in 7 days (once per package)
 *
 * For multiple API instances, move these to BullMQ workers on Redis so each job runs once.
 */
const SLOT_HORIZON_DAYS = 30;

async function sendDueNotifications() {
  const due = await prisma.notification.findMany({ where: { status: "QUEUED", scheduledAt: { lte: new Date() } }, take: 100, select: { id: true } });
  for (const n of due) await dispatch(n.id);
}

async function topUpSlots() {
  const therapists = await prisma.therapist.findMany({ where: { isActive: true }, select: { id: true } });
  const from = todayLocal();
  for (const t of therapists) await generateSlots(t.id, from, addDays(from, SLOT_HORIZON_DAYS));
}

async function packageHousekeeping() {
  const system = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  if (system) await expirePackages(system.id);

  const soon = new Date(`${addDays(todayLocal(), 7)}T00:00:00Z`);
  const expiring = await prisma.patientPackage.findMany({ where: { status: "ACTIVE", expiryDate: { lte: soon }, remainingSessions: { gt: 0 } }, include: { package: true } });
  for (const p of expiring) {
    const already = await prisma.notification.count({ where: { type: "PACKAGE_EXPIRY", payload: { path: ["patientPackageId"], equals: p.id } } });
    if (already) continue;
    await notifyPatient(p.patientId, "PACKAGE_EXPIRY", "package_expiry", {
      patientPackageId: p.id,
      packageName: p.package.name,
      remaining: p.remainingSessions,
      expiryDate: p.expiryDate.toISOString().slice(0, 10),
    });
  }
}

function every(ms: number, name: string, fn: () => Promise<unknown>) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      console.error(`[job:${name}]`, e);
    } finally {
      running = false;
    }
  };
  void run();
  return setInterval(run, ms);
}

export function startJobs() {
  const timers = [
    every(60_000, "notifications", sendDueNotifications),
    every(60 * 60_000, "slots", topUpSlots),
    every(60 * 60_000, "packages", packageHousekeeping),
  ];
  return () => timers.forEach(clearInterval);
}
