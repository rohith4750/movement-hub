import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@movement-hub/database";
import { handler, ok, q } from "../../lib/http.js";
import { addDays, dayRange, todayLocal } from "../../lib/time.js";
import { authorize } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { patientProgress } from "../patients/patient.routes.js";

export const reportRouter = Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeQuery = z.object({ from: date.default(() => `${todayLocal().slice(0, 7)}-01`), to: date.default(() => todayLocal()) });
type Range = z.infer<typeof rangeQuery>;
const span = (r: Range) => ({ gte: dayRange(r.from).gte, lt: dayRange(r.to).lt });
const num = (v: Prisma.Decimal | null | undefined) => Number(v ?? 0);

/** Successful money in, minus processed refunds, within a range. */
async function netRevenue(range: { gte: Date; lt: Date }) {
  const [paid, refunded] = await Promise.all([
    prisma.payment.aggregate({ _sum: { amount: true }, where: { status: { in: ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] }, paidAt: range } }),
    prisma.refund.aggregate({ _sum: { amount: true }, where: { status: { not: "FAILED" }, createdAt: range } }),
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
    const therapistId = req.user!.role === "PHYSIOTHERAPIST" ? req.user!.therapistId ?? undefined : undefined;
    const [totalPatients, todayAppointments, pendingAppointments, completedSessionsToday, therapists, revenueToday, revenueMonth, upcoming, newPatientsMonth] = await Promise.all([
      prisma.patient.count({ where: { deletedAt: null } }),
      prisma.appointment.count({ where: { startAt: todayR, therapistId, status: { notIn: ["CANCELLED", "RESCHEDULED"] } } }),
      prisma.appointment.count({ where: { startAt: { gte: new Date() }, therapistId, status: { in: ["SCHEDULED"] } } }),
      prisma.therapySession.count({ where: { completedAt: todayR, therapistId, status: "COMPLETED" } }),
      prisma.therapist.findMany({
        where: { isActive: true },
        select: {
          id: true, colorTag: true, user: { select: { name: true } },
          slots: { where: { startAt: todayR }, select: { status: true } },
          leaves: { where: { status: "APPROVED", startDate: { lt: todayR.lt }, endDate: { gt: todayR.gte } }, select: { id: true } },
        },
      }),
      therapistId ? Promise.resolve(null) : netRevenue(todayR),
      therapistId ? Promise.resolve(null) : netRevenue(monthR),
      prisma.appointment.findMany({
        where: { startAt: { gte: new Date(), lt: dayRange(addDays(today, 1)).lt }, therapistId, status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN"] } },
        orderBy: { startAt: "asc" },
        take: 10,
        include: { patient: { select: { id: true, firstName: true, lastName: true } }, therapist: { select: { id: true, user: { select: { name: true } } } } },
      }),
      prisma.patient.count({ where: { createdAt: monthR, deletedAt: null } }),
    ]);
    const utilization = therapists.map((t) => {
      const total = t.slots.filter((s) => s.status !== "BLOCKED").length;
      const booked = t.slots.filter((s) => s.status === "BOOKED").length;
      return { therapistId: t.id, name: t.user.name, colorTag: t.colorTag, onLeave: t.leaves.length > 0, booked, total, percent: total ? Math.round((booked / total) * 100) : 0 };
    });
    ok(res, {
      totalPatients,
      newPatientsMonth,
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

reportRouter.get(
  "/revenue",
  authorize("ADMIN", "ACCOUNTANT"),
  validate({ query: rangeQuery.extend({ groupBy: z.enum(["day", "month"]).default("day") }) }),
  handler(async (req, res) => {
    const r = q<Range & { groupBy: "day" | "month" }>(req);
    const s = span(r);
    const unit = r.groupBy === "month" ? Prisma.sql`'month'` : Prisma.sql`'day'`;
    const rows = await prisma.$queryRaw<{ period: Date; method: string; total: Prisma.Decimal; count: bigint }[]>`
      SELECT date_trunc(${unit}, "paidAt" AT TIME ZONE 'Asia/Kolkata') AS period, "method", SUM("amount") AS total, COUNT(*) AS count
      FROM "Payment" WHERE "status" IN ('SUCCESS','PARTIALLY_REFUNDED','REFUNDED') AND "paidAt" >= ${s.gte} AND "paidAt" < ${s.lt}
      GROUP BY 1, 2 ORDER BY 1`;
    const byType = await prisma.$queryRaw<{ type: string; total: Prisma.Decimal }[]>`
      SELECT ii."type", SUM(ii."amount") AS total FROM "InvoiceItem" ii JOIN "Invoice" i ON i."id" = ii."invoiceId"
      WHERE i."status" NOT IN ('DRAFT','CANCELLED') AND i."issuedAt" >= ${s.gte} AND i."issuedAt" < ${s.lt} GROUP BY 1`;
    ok(res, {
      range: r,
      netRevenue: await netRevenue(s),
      series: rows.map((x) => ({ period: x.period, method: x.method, total: num(x.total), count: Number(x.count) })),
      byServiceType: byType.map((x) => ({ type: x.type, total: num(x.total) })),
    });
  }),
);

reportRouter.get(
  "/appointments",
  authorize("ADMIN"),
  validate({ query: rangeQuery }),
  handler(async (req, res) => {
    const r = q<Range>(req);
    const [byStatus, byType, byTherapist] = await Promise.all([
      prisma.appointment.groupBy({ by: ["status"], where: { startAt: span(r) }, _count: true }),
      prisma.appointment.groupBy({ by: ["type"], where: { startAt: span(r) }, _count: true }),
      prisma.appointment.groupBy({ by: ["therapistId"], where: { startAt: span(r), status: "COMPLETED" }, _count: true }),
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
  validate({ query: rangeQuery }),
  handler(async (req, res) => {
    const r = q<Range>(req);
    const [sold, byStatus, catalogue] = await Promise.all([
      prisma.patientPackage.groupBy({ by: ["packageId"], where: { createdAt: span(r) }, _count: true, _sum: { pricePaid: true, totalSessions: true, usedSessions: true } }),
      prisma.patientPackage.groupBy({ by: ["status"], _count: true }),
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
  handler(async (_req, res) => {
    const invoices = await prisma.invoice.findMany({
      where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, deletedAt: null },
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
    let rows: Record<string, unknown>[] = [];
    if (r.type === "payments") {
      rows = (await prisma.payment.findMany({ where: { paidAt: span(r) }, include: { invoice: { select: { invoiceNo: true } } }, orderBy: { paidAt: "asc" } })).map((p) => ({
        receiptNo: p.receiptNo, invoiceNo: p.invoice.invoiceNo, method: p.method, status: p.status, amount: num(p.amount), paidAt: p.paidAt?.toISOString(),
      }));
    } else if (r.type === "appointments") {
      rows = (await prisma.appointment.findMany({ where: { startAt: span(r) }, include: { patient: true, therapist: { include: { user: true } } }, orderBy: { startAt: "asc" } })).map((a) => ({
        appointmentNo: a.appointmentNo, type: a.type, status: a.status, startAt: a.startAt.toISOString(), patient: `${a.patient.firstName} ${a.patient.lastName ?? ""}`.trim(), therapist: a.therapist.user.name,
      }));
    } else {
      rows = (await prisma.invoice.findMany({ where: { issuedAt: span(r) }, include: { patient: true }, orderBy: { issuedAt: "asc" } })).map((i) => ({
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
