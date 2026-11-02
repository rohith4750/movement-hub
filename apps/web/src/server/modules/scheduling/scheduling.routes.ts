import { Router } from "../../router";
import { z } from "zod";
import { prisma } from "@movement-hub/database";
import { handler, ok, q } from "../../lib/http";
import { addDays, dayRange, todayLocal } from "../../lib/time";
import { authorize, STAFF } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { availability, availabilitySummary } from "./scheduling.service";

export const availabilityRouter = Router();
export const calendarRouter = Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const availabilityQuery = z.object({
  date: date.default(() => todayLocal()),
  therapistId: z.string().uuid().optional(),
  specializationId: z.string().uuid().optional(),
  type: z.enum(["INITIAL_CONSULTATION", "FOLLOW_UP_CONSULTATION", "THERAPY_SESSION", "HOME_VISIT"]).optional(),
});

availabilityRouter.get(
  "/",
  validate({ query: availabilityQuery }),
  handler(async (req, res) => ok(res, await availability(q<z.infer<typeof availabilityQuery>>(req)))),
);

const summaryQuery = z.object({
  from: date.default(() => todayLocal()),
  days: z.coerce.number().int().min(1).max(60).default(14),
  therapistId: z.string().uuid().optional(),
  type: availabilityQuery.shape.type,
});

availabilityRouter.get(
  "/summary",
  validate({ query: summaryQuery }),
  handler(async (req, res) => ok(res, await availabilitySummary(q<z.infer<typeof summaryQuery>>(req)))),
);

const calendarQuery = z.object({
  view: z.enum(["day", "week", "month"]).default("day"),
  date: date.default(() => todayLocal()),
  therapistId: z.string().uuid().optional(),
});

calendarRouter.get(
  "/",
  authorize(...STAFF),
  validate({ query: calendarQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof calendarQuery>>(req);
    let from = query.date;
    let days = 1;
    if (query.view === "week") {
      const dow = (new Date(`${query.date}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday start
      from = addDays(query.date, -dow);
      days = 7;
    } else if (query.view === "month") {
      from = `${query.date.slice(0, 7)}-01`;
      const next = new Date(`${from}T12:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      days = Math.round((next.getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000);
    }
    const range = { gte: dayRange(from).gte, lt: dayRange(addDays(from, days - 1)).lt };

    const therapists = await prisma.therapist.findMany({
      where: { isActive: true, id: query.therapistId },
      select: {
        id: true,
        colorTag: true,
        user: { select: { name: true } },
        slots: {
          where: { startAt: range },
          orderBy: { startAt: "asc" },
          select: {
            id: true, startAt: true, endAt: true, status: true,
            appointment: { select: { id: true, appointmentNo: true, type: true, status: true, patient: { select: { id: true, firstName: true, lastName: true } } } },
          },
        },
        leaves: { where: { status: "APPROVED", startDate: { lt: range.lt }, endDate: { gt: range.gte } } },
      },
    });

    if (query.view === "month") {
      // Summarised per day to keep payload small.
      return ok(res, {
        from, days,
        therapists: therapists.map((t) => {
          const summary: Record<string, { available: number; booked: number; blocked: number }> = {};
          for (const s of t.slots) {
            const k = s.startAt.toISOString().slice(0, 10);
            summary[k] ??= { available: 0, booked: 0, blocked: 0 };
            summary[k][s.status.toLowerCase() as "available" | "booked" | "blocked"]++;
          }
          return { id: t.id, name: t.user.name, colorTag: t.colorTag, leaves: t.leaves, summary };
        }),
      });
    }
    ok(res, { from, days, therapists: therapists.map((t) => ({ id: t.id, name: t.user.name, colorTag: t.colorTag, leaves: t.leaves, slots: t.slots })) });
  }),
);
