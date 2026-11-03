import { Router } from "../../router";
import { z } from "zod";
import { Prisma, prisma } from "@movement-hub/database";
import { handler, ok, q } from "../../lib/http";
import { addDays, dayRange, todayLocal } from "../../lib/time";
import { authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { patientProgress } from "../patients/patient.routes";
import { billingScope } from "../billing/billing.service";

export const reportRouter = Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Optional for the Super Admin: one physio's figures. Physios always get their own. */
const therapistFilter = z.string().uuid().optional();
const rangeQuery = z.object({ from: date.default(() => `${todayLocal().slice(0, 7)}-01`), to: date.default(() => todayLocal()) });
type Range = z.infer<typeof rangeQuery>;
const span = (r: Range) => ({ gte: dayRange(r.from).gte, lt: dayRange(r.to).lt });
const num = (v: Prisma.Decimal | null | undefined) => Number(v ?? 0);

/** Successful money in, minus processed refunds, within a range — optionally one physio's bills only. */
async function netRevenue(range: { gte: Date; lt: Date }, therapistId?: string) {
  const own = therapistId ? { invoice: { therapistId } } : {};
  const [paid, refunded] = await Promise.all([
    prisma.payment.aggregate({ _sum: { amount: true }, where: { status: { in: ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] }, paidAt: range, ...own } }),
    prisma.refund.aggregate({ _sum: { amount: true }, where: { status: { not: "FAILED" }, createdAt: range, ...(therapistId ? { payment: own } : {}) } }),
  ]);
  return num(paid._sum.amount) - num(refunded._sum.amount);
}

reportRouter.get(
  "/dashboard",
  authorize("ADMIN", "RECEPTIONIST", "ACCOUNTANT", "PHYSIOTHERAPIST"),
  handler(async (req, res) => {
    const today = todayLocal();
    const todayR = dayRange(today);
    const monthR = { gte: dayRange(`${today.slice(0, 7)}-01`).gte, lt: todayR.lt };
    const therapistId = (req.query.therapistId as string | undefined) ?? undefined;
    const [totalPatients, todayAppointments, pendingAppointments, completedSessionsToday, therapists, slotCounts, revenueToday, revenueMonth, upcoming, newPatientsMonth] = await Promise.all([
      prisma.patient.count({ where: { deletedAt: null } }),
      prisma.appointment.count({ where: { startAt: todayR, therapistId, status: { notIn: ["CANCELLED", "RESCHEDULED"] } } }),
      prisma.appointment.count({ where: { startAt: { gte: new Date() }, therapistId, status: { in: ["SCHEDULED"] } } }),
      prisma.therapySession.count({ where: { completedAt: todayR, therapistId, status: "COMPLETED" } }),
      prisma.therapist.findMany({
        where: { isActive: true },
        select: {
          id: true, colorTag: true, user: { select: { name: true } },
          leaves: { where: { status: "APPROVED", startDate: { lt: todayR.lt }, endDate: { gt: todayR.gte } }, select: { id: true } },
        },
      }),
      // Count today's slots per therapist and status in the database instead of loading every slot row.
      prisma.therapistSlot.groupBy({ by: ["therapistId", "status"], where: { startAt: todayR }, _count: { _all: true } }),
      // Physios see what they collected from their own patients; the Super Admin sees the clinic.
      netRevenue(todayR, billingScope(req.user)),
      netRevenue(monthR, billingScope(req.user)),
      prisma.appointment.findMany({
        where: { startAt: { gte: new Date(), lt: dayRange(addDays(today, 1)).lt }, therapistId, status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN"] } },
        orderBy: { startAt: "asc" },
        take: 10,
        include: { patient: { select: { id: true, firstName: true, lastName: true } }, therapist: { select: { id: true, user: { select: { name: true } } } } },
      }),
      prisma.patient.count({ where: { createdAt: monthR, deletedAt: null } }),
    ]);
    // Walk-ins vs booked-ahead visits today, and how many patients are in ongoing care.
    const [bySourceToday, regularPatients] = await Promise.all([
      prisma.appointment.groupBy({ by: ["source"], where: { startAt: todayR, therapistId, status: { notIn: ["CANCELLED", "RESCHEDULED"] } }, _count: { _all: true } }),
      prisma.patient.count({ where: { deletedAt: null, OR: [{ primaryTherapistId: { not: null } }, { treatmentPlans: { some: { status: "ACTIVE", deletedAt: null } } }] } }),
    ]);
    const sourceCount = (s: "SCHEDULED" | "WALK_IN") => bySourceToday.find((x) => x.source === s)?._count._all ?? 0;
    const slotsOf = (id: string, status: "AVAILABLE" | "BOOKED") =>
      slotCounts.find((c) => c.therapistId === id && c.status === status)?._count._all ?? 0;
    const utilization = therapists.map((t) => {
      const booked = slotsOf(t.id, "BOOKED");
      const total = booked + slotsOf(t.id, "AVAILABLE");
      return { therapistId: t.id, name: t.user.name, colorTag: t.colorTag, onLeave: t.leaves.length > 0, booked, total, percent: total ? Math.round((booked / total) * 100) : 0 };
    });
    ok(res, {
      totalPatients,
      newPatientsMonth,
      regularPatients,
      walkInsToday: sourceCount("WALK_IN"),
      scheduledToday: sourceCount("SCHEDULED"),
      todayAppointments,
      pendingAppointments,
      completedSessionsToday,
      availableTherapists: utilization.filter((u) => !u.onLeave && u.total > u.booked).length,
      revenueToday,
      revenueMonth,
      therapistUtilization: utilization,
      upcomingAppointments: upcoming,
    });
  }),
);

/** Month-by-month trend for the owner: visits, completed, walk-ins, no-shows and new patients. */
reportRouter.get(
  "/monthly",
  authorize("ADMIN"),
  validate({ query: z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }) }),
  handler(async (req, res) => {
    const months = q<{ months: number }>(req).months;
    const thisMonth = todayLocal().slice(0, 7);
    const keys: string[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(`${thisMonth}-15T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - i);
      keys.push(d.toISOString().slice(0, 7));
    }
    const nextMonth = (m: string) => {
      const d = new Date(`${m}-15T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d.toISOString().slice(0, 7);
    };
    const rows = await Promise.all(
      keys.map(async (m) => {
        const range = { gte: dayRange(`${m}-01`).gte, lt: dayRange(`${nextMonth(m)}-01`).gte };
        const live = { startAt: range, status: { notIn: ["CANCELLED" as const, "RESCHEDULED" as const] } };
        const [visits, completed, walkIns, noShows, newPatients] = await Promise.all([
          prisma.appointment.count({ where: live }),
          prisma.appointment.count({ where: { startAt: range, status: "COMPLETED" } }),
          prisma.appointment.count({ where: { ...live, source: "WALK_IN" } }),
          prisma.appointment.count({ where: { startAt: range, status: "NO_SHOW" } }),
          prisma.patient.count({ where: { createdAt: range, deletedAt: null } }),
        ]);
        return { month: m, visits, completed, walkIns, scheduled: visits - walkIns, noShows, newPatients };
      }),
    );
    ok(res, rows);
  }),
);

reportRouter.get(
  "/revenue",
  authorize("ADMIN", "ACCOUNTANT"),
  validate({ query: rangeQuery.extend({ groupBy: z.enum(["day", "month"]).default("day"), therapistId: therapistFilter }) }),
  handler(async (req, res) => {
    const r = q<Range & { groupBy: "day" | "month"; therapistId?: string }>(req);
    const s = span(r);
    const tid = billingScope(req.user, r.therapistId) ?? null;
    const ownPay = tid ? Prisma.sql`AND "invoiceId" IN (SELECT "id" FROM "Invoice" WHERE "therapistId" = ${tid})` : Prisma.empty;
    const ownInv = tid ? Prisma.sql`AND i."therapistId" = ${tid}` : Prisma.empty;
    const unit = r.groupBy === "month" ? Prisma.sql`'month'` : Prisma.sql`'day'`;
    const rows = await prisma.$queryRaw<{ period: Date; method: string; total: Prisma.Decimal; count: bigint }[]>`
      SELECT date_trunc(${unit}, "paidAt" AT TIME ZONE 'Asia/Kolkata') AS period, "method", SUM("amount") AS total, COUNT(*) AS count
      FROM "Payment" WHERE "status" IN ('SUCCESS','PARTIALLY_REFUNDED','REFUNDED') AND "paidAt" >= ${s.gte} AND "paidAt" < ${s.lt} ${ownPay}
      GROUP BY 1, 2 ORDER BY 1`;
    const byType = await prisma.$queryRaw<{ type: string; total: Prisma.Decimal }[]>`
      SELECT ii."type", SUM(ii."amount") AS total FROM "InvoiceItem" ii JOIN "Invoice" i ON i."id" = ii."invoiceId"
      WHERE i."status" NOT IN ('DRAFT','CANCELLED') AND i."issuedAt" >= ${s.gte} AND i."issuedAt" < ${s.lt} ${ownInv} GROUP BY 1`;
    // Clinic view: what each physio collected (money in on their bills) — the basis for their share.
    const byTherapist = tid
      ? []
      : await prisma.$queryRaw<{ therapistId: string | null; name: string | null; total: Prisma.Decimal; payments: bigint }[]>`
          SELECT i."therapistId", u."name", SUM(p."amount") AS total, COUNT(*) AS payments
          FROM "Payment" p JOIN "Invoice" i ON i."id" = p."invoiceId"
          LEFT JOIN "Therapist" t ON t."id" = i."therapistId" LEFT JOIN "User" u ON u."id" = t."userId"
          WHERE p."status" IN ('SUCCESS','PARTIALLY_REFUNDED','REFUNDED') AND p."paidAt" >= ${s.gte} AND p."paidAt" < ${s.lt}
          GROUP BY 1, 2 ORDER BY 3 DESC`;
    ok(res, {
      range: r,
      therapistId: tid,
      netRevenue: await netRevenue(s, tid ?? undefined),
      series: rows.map((x) => ({ period: x.period, method: x.method, total: num(x.total), count: Number(x.count) })),
      byServiceType: byType.map((x) => ({ type: x.type, total: num(x.total) })),
      byTherapist: byTherapist.map((x) => ({ therapistId: x.therapistId, name: x.name ?? "Not linked to a physio", total: num(x.total), payments: Number(x.payments) })),
    });
  }),
);

reportRouter.get(
  "/appointments",
  authorize("ADMIN"),
  validate({ query: rangeQuery }),
  handler(async (req, res) => {
    const r = q<Range>(req);
    const [byStatus, byType, byTherapist, bySource] = await Promise.all([
      prisma.appointment.groupBy({ by: ["status"], where: { startAt: span(r) }, _count: true }),
      prisma.appointment.groupBy({ by: ["type"], where: { startAt: span(r) }, _count: true }),
      prisma.appointment.groupBy({ by: ["therapistId"], where: { startAt: span(r), status: "COMPLETED" }, _count: true }),
      prisma.appointment.groupBy({ by: ["source"], where: { startAt: span(r), status: { notIn: ["CANCELLED", "RESCHEDULED"] } }, _count: true }),
    ]);
    const names = await prisma.therapist.findMany({ select: { id: true, user: { select: { name: true } } } });
    const total = byStatus.reduce((s, x) => s + x._count, 0);
    const noShow = byStatus.find((x) => x.status === "NO_SHOW")?._count ?? 0;
    const cancelled = byStatus.find((x) => x.status === "CANCELLED")?._count ?? 0;
    ok(res, {
      range: r,
      total,
      noShowRate: total ? +(noShow / total * 100).toFixed(1) : 0,
      cancellationRate: total ? +(cancelled / total * 100).toFixed(1) : 0,
      byStatus: byStatus.map((x) => ({ status: x.status, count: x._count })),
      byType: byType.map((x) => ({ type: x.type, count: x._count })),
      bySource: bySource.map((x) => ({ source: x.source, count: x._count })),
      completedByTherapist: byTherapist.map((x) => ({ therapistId: x.therapistId, name: names.find((n) => n.id === x.therapistId)?.user.name, count: x._count })),
    });
  }),
);

reportRouter.get(
  "/therapist-utilization",
  authorize("ADMIN"),
  validate({ query: rangeQuery }),
  handler(async (req, res) => {
    const r = q<Range>(req);
    const rows = await prisma.therapistSlot.groupBy({ by: ["therapistId", "status"], where: { startAt: span(r) }, _count: true });
    const therapists = await prisma.therapist.findMany({ select: { id: true, colorTag: true, user: { select: { name: true } } } });
    ok(res, {
      range: r,
      therapists: therapists.map((t) => {
        const c = (s: string) => rows.find((x) => x.therapistId === t.id && x.status === s)?._count ?? 0;
        const available = c("AVAILABLE");
        const booked = c("BOOKED");
        return { therapistId: t.id, name: t.user.name, colorTag: t.colorTag, booked, available, blocked: c("BLOCKED"), percent: booked + available ? Math.round((booked / (booked + available)) * 100) : 0 };
      }),
    });
  }),
);

reportRouter.get(
  "/packages",
  authorize("ADMIN", "ACCOUNTANT"),
  validate({ query: rangeQuery.extend({ therapistId: therapistFilter }) }),
  handler(async (req, res) => {
    const r = q<Range & { therapistId?: string }>(req);
    const tid = billingScope(req.user, r.therapistId);
    // A package is a physio's when its invoice is theirs.
    const own = tid ? { invoiceItems: { some: { invoice: { therapistId: tid } } } } : {};
    const [sold, byStatus, catalogue] = await Promise.all([
      prisma.patientPackage.groupBy({ by: ["packageId"], where: { createdAt: span(r), ...own }, _count: true, _sum: { pricePaid: true, totalSessions: true, usedSessions: true } }),
      prisma.patientPackage.groupBy({ by: ["status"], where: own, _count: true }),
      prisma.treatmentPackage.findMany({ select: { id: true, name: true, tier: true } }),
    ]);
    ok(res, {
      range: r,
      sales: sold.map((s) => ({ ...catalogue.find((c) => c.id === s.packageId), count: s._count, revenue: num(s._sum.pricePaid), sessionsSold: s._sum.totalSessions ?? 0, sessionsUsed: s._sum.usedSessions ?? 0 })),
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
    });
  }),
);

reportRouter.get(
  "/outstanding",
  authorize("ADMIN", "ACCOUNTANT"),
  validate({ query: z.object({ therapistId: therapistFilter }) }),
  handler(async (req, res) => {
    const tid = billingScope(req.user, q<{ therapistId?: string }>(req).therapistId);
    const invoices = await prisma.invoice.findMany({
      where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, deletedAt: null, ...(tid ? { therapistId: tid } : {}) },
      orderBy: { issuedAt: "asc" },
      include: { patient: { select: { id: true, patientCode: true, firstName: true, lastName: true, phone: true } } },
    });
    ok(res, { totalDue: invoices.reduce((s, i) => s + num(i.dueAmount), 0), count: invoices.length, invoices });
  }),
);

reportRouter.get(
  "/patient-progress/:patientId",
  authorize("PHYSIOTHERAPIST", "ADMIN"),
  validate({ params: z.object({ patientId: z.string().uuid() }) }),
  handler(async (req, res) => ok(res, await patientProgress(req.params.patientId))),
);

/** CSV export of a report's rows. */
reportRouter.get(
  "/export",
  authorize("ADMIN", "ACCOUNTANT"),
  validate({ query: rangeQuery.extend({ type: z.enum(["payments", "appointments", "invoices"]) }) }),
  handler(async (req, res) => {
    const r = q<Range & { type: "payments" | "appointments" | "invoices" }>(req);
    const tid = billingScope(req.user);
    let rows: Record<string, unknown>[] = [];
    if (r.type === "payments") {
      rows = (await prisma.payment.findMany({ where: { paidAt: span(r), ...(tid ? { invoice: { therapistId: tid } } : {}) }, include: { invoice: { select: { invoiceNo: true } } }, orderBy: { paidAt: "asc" } })).map((p) => ({
        receiptNo: p.receiptNo, invoiceNo: p.invoice.invoiceNo, method: p.method, status: p.status, amount: num(p.amount), paidAt: p.paidAt?.toISOString(),
      }));
    } else if (r.type === "appointments") {
      rows = (await prisma.appointment.findMany({ where: { startAt: span(r), ...(tid ? { therapistId: tid } : {}) }, include: { patient: true, therapist: { include: { user: true } } }, orderBy: { startAt: "asc" } })).map((a) => ({
        appointmentNo: a.appointmentNo, type: a.type, status: a.status, startAt: a.startAt.toISOString(), patient: `${a.patient.firstName} ${a.patient.lastName ?? ""}`.trim(), therapist: a.therapist.user.name,
      }));
    } else {
      rows = (await prisma.invoice.findMany({ where: { issuedAt: span(r), ...(tid ? { therapistId: tid } : {}) }, include: { patient: true }, orderBy: { issuedAt: "asc" } })).map((i) => ({
        invoiceNo: i.invoiceNo, patient: `${i.patient.firstName} ${i.patient.lastName ?? ""}`.trim(), status: i.status, taxable: num(i.taxableAmount),
        cgst: num(i.cgstAmount), sgst: num(i.sgstAmount), igst: num(i.igstAmount), total: num(i.totalAmount), paid: num(i.paidAmount), due: num(i.dueAmount), issuedAt: i.issuedAt?.toISOString(),
      }));
    }
    const headers = Object.keys(rows[0] ?? { empty: "" });
    const cell = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
    };
    const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => cell(row[h])).join(","))].join("\n");
    res.setHeader("Content-Disposition", `attachment; filename="${r.type}-${r.from}-to-${r.to}.csv"`);
    res.type("text/csv").send(csv);
  }),
);
