import { Router } from "../../router";
import { z } from "zod";
import { Prisma, prisma } from "@movement-hub/database";
import { handler, ok, q } from "../../lib/http";
import { addDays } from "../../lib/time";
import { authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { billingScope } from "../billing/billing.service";
import { netRevenue, num, rangeQuery, span, therapistFilter, type Range } from "./report.routes";

/**
 * Deeper analytics for the owner and accountant: patients & retention, clinical outcomes,
 * operations & peak times, and a finance deep-dive. Mounted next to the basic reports (/reports/…).
 * All take ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: this month).
 */
export const analyticsRouter = Router();

/** Postgres stores timestamps as UTC; this turns a column into clinic-local (IST) time for grouping. */
const local = (col: string) => Prisma.raw(`("${col}" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')`);
const pct = (part: number, whole: number) => (whole ? +((part / whole) * 100).toFixed(1) : 0);
const round1 = (v: number | null | undefined) => (v === null || v === undefined ? null : +Number(v).toFixed(1));

/* ─────────────── Patients & retention ─────────────── */

const AGE_BUCKETS = ["0–17", "18–35", "36–50", "51–65", "65+", "Unknown"] as const;
const DROP_OFF_DAYS = 30;

analyticsRouter.get(
  "/patients",
  authorize("ADMIN"),
  validate({ query: rangeQuery }),
  handler(async (req, res) => {
    const r = q<Range>(req);
    const s = span(r);
    const [newPatients, totalPatients, visitors, dropOffs, referrals, gender, ages, types] = await Promise.all([
      prisma.patient.count({ where: { createdAt: s, deletedAt: null } }),
      prisma.patient.count({ where: { deletedAt: null } }),
      // Patients with a completed visit in the range; "returning" = registered before the range began.
      prisma.$queryRaw<{ active: number; returning: number }[]>`
        SELECT COUNT(DISTINCT a."patientId")::int AS active,
               (COUNT(DISTINCT a."patientId") FILTER (WHERE p."createdAt" < ${s.gte}))::int AS returning
        FROM "Appointment" a JOIN "Patient" p ON p."id" = a."patientId"
        WHERE a."status" = 'COMPLETED' AND a."startAt" >= ${s.gte} AND a."startAt" < ${s.lt} AND p."deletedAt" IS NULL`,
      // Patients who came before, haven't been in for DROP_OFF_DAYS+ days and have nothing booked: worth a call.
      prisma.$queryRaw<{ id: string; patientCode: string; firstName: string; lastName: string | null; phone: string; lastVisit: Date; visits: number }[]>`
        SELECT p."id", p."patientCode", p."firstName", p."lastName", p."phone", MAX(a."startAt") AS "lastVisit", COUNT(*)::int AS visits
        FROM "Patient" p JOIN "Appointment" a ON a."patientId" = p."id" AND a."status" = 'COMPLETED'
        WHERE p."deletedAt" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "Appointment" f WHERE f."patientId" = p."id" AND f."startAt" > now() AND f."status" IN ('SCHEDULED','CONFIRMED','CHECKED_IN'))
        GROUP BY p."id"
        HAVING MAX(a."startAt") < now() - (${DROP_OFF_DAYS} * interval '1 day')
        ORDER BY MAX(a."startAt") DESC LIMIT 200`,
      prisma.patient.groupBy({ by: ["referredBy"], where: { createdAt: s, deletedAt: null, referredBy: { not: null } }, _count: true }),
      prisma.patient.groupBy({ by: ["gender"], where: { deletedAt: null }, _count: true }),
      prisma.$queryRaw<{ bucket: string; n: number }[]>`
        SELECT CASE WHEN "dateOfBirth" IS NULL THEN 'Unknown'
                    WHEN date_part('year', age("dateOfBirth")) < 18 THEN '0–17'
                    WHEN date_part('year', age("dateOfBirth")) < 36 THEN '18–35'
                    WHEN date_part('year', age("dateOfBirth")) < 51 THEN '36–50'
                    WHEN date_part('year', age("dateOfBirth")) < 66 THEN '51–65'
                    ELSE '65+' END AS bucket, COUNT(*)::int AS n
        FROM "Patient" WHERE "deletedAt" IS NULL GROUP BY 1`,
      prisma.patient.groupBy({ by: ["patientType"], where: { deletedAt: null }, _count: true }),
    ]);

    // "Dr Rao", "dr rao " and "DR RAO" are the same referrer.
    const merged = new Map<string, { name: string; count: number }>();
    for (const x of referrals) {
      const name = (x.referredBy ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const cur = merged.get(key);
      if (cur) cur.count += x._count;
      else merged.set(key, { name, count: x._count });
    }
    const active = visitors[0]?.active ?? 0;
    const returning = visitors[0]?.returning ?? 0;
    ok(res, {
      range: r,
      totalPatients,
      newPatients,
      activePatients: active,
      returningPatients: returning,
      returningRate: pct(returning, active),
      dropOffDays: DROP_OFF_DAYS,
      dropOffCount: dropOffs.length,
      dropOffCapped: dropOffs.length >= 200,
      dropOffs: dropOffs.slice(0, 15).map((d) => ({
        id: d.id,
        patientCode: d.patientCode,
        firstName: d.firstName,
        lastName: d.lastName,
        phone: d.phone,
        lastVisit: d.lastVisit,
        visits: d.visits,
        daysAgo: Math.floor((Date.now() - new Date(d.lastVisit).getTime()) / 86_400_000),
      })),
      referralSources: [...merged.values()].sort((a, b) => b.count - a.count).slice(0, 8),
      gender: gender.map((g) => ({ gender: g.gender, count: g._count })),
      ageGroups: AGE_BUCKETS.map((b) => ({ bucket: b, count: ages.find((a) => a.bucket === b)?.n ?? 0 })),
      patientTypes: types.map((t) => ({ type: t.patientType, count: t._count })),
    });
  }),
);

/* ─────────────── Clinical outcomes ─────────────── */

analyticsRouter.get(
  "/outcomes",
  authorize("ADMIN"),
  validate({ query: rangeQuery }),
  handler(async (req, res) => {
    const r = q<Range>(req);
    const s = span(r);
    const [byPhysio, plans, planStats, activePlans] = await Promise.all([
      prisma.$queryRaw<{ therapistId: string; name: string; sessions: number; measured: number; relief: number; avgBefore: number | null; avgAfter: number | null; avgRating: number | null }[]>`
        SELECT s."therapistId", u."name", COUNT(*)::int AS sessions,
               (COUNT(*) FILTER (WHERE s."painBefore" IS NOT NULL AND s."painAfter" IS NOT NULL))::int AS measured,
               (COUNT(*) FILTER (WHERE s."painAfter" < s."painBefore"))::int AS relief,
               AVG(s."painBefore")::float AS "avgBefore", AVG(s."painAfter")::float AS "avgAfter", AVG(s."progressRating")::float AS "avgRating"
        FROM "TherapySession" s JOIN "Therapist" t ON t."id" = s."therapistId" JOIN "User" u ON u."id" = t."userId"
        WHERE s."status" = 'COMPLETED' AND s."deletedAt" IS NULL AND s."completedAt" >= ${s.gte} AND s."completedAt" < ${s.lt}
        GROUP BY 1, 2 ORDER BY 3 DESC`,
      prisma.treatmentPlan.groupBy({ by: ["outcome"], where: { status: "COMPLETED", deletedAt: null, completedAt: s }, _count: true }),
      prisma.$queryRaw<{ prescribed: number | null; done: number | null; finalPain: number | null }[]>`
        SELECT AVG(tp."prescribedSessions")::float AS prescribed,
               AVG((SELECT COUNT(*) FROM "TherapySession" ts WHERE ts."treatmentPlanId" = tp."id" AND ts."status" = 'COMPLETED'))::float AS done,
               AVG(tp."finalPainScore")::float AS "finalPain"
        FROM "TreatmentPlan" tp
        WHERE tp."status" = 'COMPLETED' AND tp."deletedAt" IS NULL AND tp."completedAt" >= ${s.gte} AND tp."completedAt" < ${s.lt}`,
      prisma.treatmentPlan.count({ where: { status: "ACTIVE", deletedAt: null } }),
    ]);

    const sessions = byPhysio.reduce((n, x) => n + x.sessions, 0);
    const measured = byPhysio.reduce((n, x) => n + x.measured, 0);
    const relief = byPhysio.reduce((n, x) => n + x.relief, 0);
    const weighted = (pick: (x: (typeof byPhysio)[number]) => number | null) => {
      const rows = byPhysio.filter((x) => pick(x) !== null && x.sessions > 0);
      const n = rows.reduce((a, x) => a + x.sessions, 0);
      return n ? rows.reduce((a, x) => a + (pick(x) as number) * x.sessions, 0) / n : null;
    };
    const avgBefore = weighted((x) => x.avgBefore);
    const avgAfter = weighted((x) => x.avgAfter);
    const completedPlans = plans.reduce((n, p) => n + p._count, 0);
    const outcome = (o: string) => plans.find((p) => p.outcome === o)?._count ?? 0;

    ok(res, {
      range: r,
      sessionsCompleted: sessions,
      sessionsMeasured: measured,
      avgPainBefore: round1(avgBefore),
      avgPainAfter: round1(avgAfter),
      avgPainReduction: avgBefore !== null && avgAfter !== null ? round1(avgBefore - avgAfter) : null,
      reliefRate: pct(relief, measured),
      avgProgressRating: round1(weighted((x) => x.avgRating)),
      activePlans,
      completedPlans,
      outcomes: {
        goalsMet: outcome("GOALS_MET"),
        partiallyMet: outcome("PARTIALLY_MET"),
        notMet: outcome("NOT_MET"),
        discontinued: outcome("DISCONTINUED"),
        notRecorded: plans.filter((p) => !p.outcome).reduce((n, p) => n + p._count, 0),
      },
      goalsMetRate: pct(outcome("GOALS_MET"), completedPlans),
      avgPrescribedSessions: round1(planStats[0]?.prescribed),
      avgSessionsDone: round1(planStats[0]?.done),
      avgFinalPain: round1(planStats[0]?.finalPain),
      byTherapist: byPhysio.map((x) => ({
        therapistId: x.therapistId,
        name: x.name,
        sessions: x.sessions,
        avgReduction: x.avgBefore !== null && x.avgAfter !== null ? round1(x.avgBefore - x.avgAfter) : null,
        reliefRate: pct(x.relief, x.measured),
        avgRating: round1(x.avgRating),
      })),
    });
  }),
);

/* ─────────────── Operations & peak times ─────────────── */

analyticsRouter.get(
  "/operations",
  authorize("ADMIN"),
  validate({ query: rangeQuery }),
  handler(async (req, res) => {
    const r = q<Range>(req);
    const s = span(r);
    const now = new Date();
    const slotEnd = s.lt < now ? s.lt : now; // only slots that have already passed can be "unused"
    const start = local("startAt");
    const [cells, byTherapistStatus, byType, slots, duration, names] = await Promise.all([
      prisma.$queryRaw<{ dow: number; hour: number; n: number }[]>`
        SELECT EXTRACT(DOW FROM ${start})::int AS dow, EXTRACT(HOUR FROM ${start})::int AS hour, COUNT(*)::int AS n
        FROM "Appointment" WHERE "startAt" >= ${s.gte} AND "startAt" < ${s.lt} AND "status" NOT IN ('CANCELLED','RESCHEDULED')
        GROUP BY 1, 2`,
      prisma.appointment.groupBy({ by: ["therapistId", "status"], where: { startAt: s }, _count: true }),
      prisma.appointment.groupBy({ by: ["type"], where: { startAt: s, status: { notIn: ["CANCELLED", "RESCHEDULED"] } }, _count: true }),
      prisma.therapistSlot.groupBy({ by: ["status"], where: { startAt: { gte: s.gte, lt: slotEnd } }, _count: true }),
      prisma.$queryRaw<{ minutes: number | null; n: number }[]>`
        SELECT AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) / 60)::float AS minutes, COUNT(*)::int AS n
        FROM "TherapySession"
        WHERE "status" = 'COMPLETED' AND "deletedAt" IS NULL AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL
          AND "completedAt" >= ${s.gte} AND "completedAt" < ${s.lt} AND "completedAt" > "startedAt"
          AND "completedAt" - "startedAt" < interval '4 hours'`,
      prisma.therapist.findMany({ select: { id: true, colorTag: true, user: { select: { name: true } } } }),
    ]);

    // Busiest times: a day-of-week × hour grid (Mon first), plus the busiest day and hour overall.
    const dayOrder = [1, 2, 3, 4, 5, 6, 0];
    const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const hours = [...new Set(cells.map((c) => c.hour))].sort((a, b) => a - b);
    const perDay = dayOrder.map((d) => ({ day: dayName[d], count: cells.filter((c) => c.dow === d).reduce((n, c) => n + c.n, 0) }));
    const perHour = hours.map((h) => ({ hour: h, count: cells.filter((c) => c.hour === h).reduce((n, c) => n + c.n, 0) }));
    const top = (rows: { count: number }[]) => rows.reduce<number>((m, x) => Math.max(m, x.count), 0);

    const statusOf = (tid: string, st: string) => byTherapistStatus.find((x) => x.therapistId === tid && x.status === st)?._count ?? 0;
    const perTherapist = names
      .map((t) => {
        const total = byTherapistStatus.filter((x) => x.therapistId === t.id).reduce((n, x) => n + x._count, 0);
        const base = total - statusOf(t.id, "RESCHEDULED"); // moved visits aren't a miss
        return {
          therapistId: t.id,
          name: t.user.name,
          colorTag: t.colorTag,
          visits: base,
          completed: statusOf(t.id, "COMPLETED"),
          noShowRate: pct(statusOf(t.id, "NO_SHOW"), base),
          cancelRate: pct(statusOf(t.id, "CANCELLED"), base),
        };
      })
      .filter((t) => t.visits > 0)
      .sort((a, b) => b.visits - a.visits);

    const slotCount = (st: string) => slots.find((x) => x.status === st)?._count ?? 0;
    const booked = slotCount("BOOKED");
    const open = slotCount("AVAILABLE");
    const homeVisits = byType.find((x) => x.type === "HOME_VISIT")?._count ?? 0;
    const allVisits = byType.reduce((n, x) => n + x._count, 0);

    ok(res, {
      range: r,
      totalVisits: allVisits,
      busiestDay: perDay.find((d) => d.count > 0 && d.count === top(perDay))?.day ?? null,
      busiestHour: perHour.find((h) => h.count > 0 && h.count === top(perHour))?.hour ?? null,
      perDay,
      perHour,
      heatmap: { hours, days: dayOrder.map((d) => dayName[d]), cells: cells.map((c) => ({ day: dayName[c.dow], hour: c.hour, count: c.n })) },
      slotFillRate: pct(booked, booked + open),
      slotsBooked: booked,
      slotsUnused: open,
      homeVisitShare: pct(homeVisits, allVisits),
      byType: byType.map((x) => ({ type: x.type, count: x._count })),
      avgSessionMinutes: round1(duration[0]?.minutes),
      sessionsTimed: duration[0]?.n ?? 0,
      perTherapist,
    });
  }),
);

/* ─────────────── Finance deep-dive ─────────────── */

const PAID = ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

analyticsRouter.get(
  "/finance",
  authorize("ADMIN", "ACCOUNTANT"),
  validate({ query: rangeQuery.extend({ therapistId: therapistFilter }) }),
  handler(async (req, res) => {
    const r = q<Range & { therapistId?: string }>(req);
    const s = span(r);
    const tid = billingScope(req.user, r.therapistId);
    // The same length of time immediately before, so every figure can be compared with "last period".
    const days = Math.max(1, Math.round((s.lt.getTime() - s.gte.getTime()) / 86_400_000));
    const prevFrom = addDays(r.from, -days);
    const prevR: Range = { from: prevFrom, to: addDays(r.from, -1) };
    const p = span(prevR);

    const ownInvoice = tid ? { invoice: { therapistId: tid } } : {};
    const ownPay = tid ? Prisma.sql`AND i."therapistId" = ${tid}` : Prisma.empty;
    const [net, prevNet, billed, methods, completedVisits, payers, packages, redeemed] = await Promise.all([
      netRevenue(s, tid),
      netRevenue(p, tid),
      prisma.invoice.aggregate({
        _sum: { totalAmount: true, paidAmount: true, dueAmount: true },
        _count: true,
        where: { status: { notIn: ["DRAFT", "CANCELLED"] }, deletedAt: null, issuedAt: s, ...(tid ? { therapistId: tid } : {}) },
      }),
      prisma.payment.groupBy({ by: ["method"], where: { status: { in: [...PAID] }, paidAt: s, ...ownInvoice }, _sum: { amount: true }, _count: true }),
      prisma.appointment.count({ where: { status: "COMPLETED", startAt: s, ...(tid ? { therapistId: tid } : {}) } }),
      prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(DISTINCT i."patientId")::int AS n FROM "Payment" pay JOIN "Invoice" i ON i."id" = pay."invoiceId"
        WHERE pay."status" IN ('SUCCESS','PARTIALLY_REFUNDED','REFUNDED') AND pay."paidAt" >= ${s.gte} AND pay."paidAt" < ${s.lt} ${ownPay}`,
      prisma.patientPackage.aggregate({
        _sum: { pricePaid: true },
        _count: true,
        where: { createdAt: s, ...(tid ? { invoiceItems: { some: { invoice: { therapistId: tid } } } } : {}) },
      }),
      tid ? Promise.resolve(null) : prisma.packageTransaction.count({ where: { type: "SESSION_USED", createdAt: s } }),
    ]);

    const billedTotal = num(billed._sum.totalAmount);
    const billedPaid = num(billed._sum.paidAmount);
    const payingPatients = payers[0]?.n ?? 0;
    const methodTotal = methods.reduce((n, m) => n + num(m._sum.amount), 0);
    ok(res, {
      range: r,
      previousRange: prevR,
      netRevenue: net,
      previousNetRevenue: prevNet,
      changePct: prevNet ? +(((net - prevNet) / prevNet) * 100).toFixed(1) : null,
      invoicesIssued: billed._count,
      billed: billedTotal,
      collected: billedPaid,
      stillDue: num(billed._sum.dueAmount),
      collectionRate: pct(billedPaid, billedTotal),
      paymentMethods: methods
        .map((m) => ({ method: m.method, total: num(m._sum.amount), count: m._count, share: pct(num(m._sum.amount), methodTotal) }))
        .sort((a, b) => b.total - a.total),
      completedVisits,
      revenuePerVisit: completedVisits ? Math.round(net / completedVisits) : null,
      payingPatients,
      revenuePerPatient: payingPatients ? Math.round(net / payingPatients) : null,
      packagesSold: packages._count,
      packageRevenue: num(packages._sum.pricePaid),
      packageSessionsRedeemed: redeemed,
    });
  }),
);
