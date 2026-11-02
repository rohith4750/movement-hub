import { Router } from "../../router";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma, type Prisma } from "@movement-hub/database";
import { env } from "../../config/env";
import { handler, meta, ok, paginationQuery, paging, q } from "../../lib/http";
import { authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { notifyPatient } from "./notification.service";

export const notificationRouter = Router();
/** Public, signed by Meta. Mounted without auth. */
export const whatsappWebhookRouter = Router();

const listQuery = paginationQuery.extend({
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "FAILED"]).optional(),
  type: z.string().optional(),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL", "PUSH"]).optional(),
});

notificationRouter.get(
  "/",
  authorize("ADMIN"),
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const where: Prisma.NotificationWhereInput = { status: query.status, channel: query.channel, type: query.type as never };
    const [data, total] = await Promise.all([
      prisma.notification.findMany({ where, ...paging(query), orderBy: { createdAt: "desc" } }),
      prisma.notification.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

notificationRouter.get(
  "/me",
  validate({ query: paginationQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof paginationQuery>>(req);
    const where = { userId: req.user!.id, templateKey: { notIn: ["otp", "password_reset"] } };
    const [data, total] = await Promise.all([
      prisma.notification.findMany({ where, ...paging(query), orderBy: { createdAt: "desc" }, select: { id: true, type: true, payload: true, createdAt: true, sentAt: true } }),
      prisma.notification.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

notificationRouter.post(
  "/send",
  authorize("ADMIN", "RECEPTIONIST"),
  validate({
    body: z.object({
      patientId: z.string().uuid(),
      type: z.enum(["APPOINTMENT_CONFIRMATION", "APPOINTMENT_REMINDER", "APPOINTMENT_RESCHEDULED", "APPOINTMENT_CANCELLED", "PAYMENT_CONFIRMATION", "PACKAGE_EXPIRY", "FOLLOW_UP_REMINDER"]),
      templateKey: z.string().min(2),
      payload: z.record(z.string()).default({}),
    }),
  }),
  handler(async (req, res) => ok(res, await notifyPatient(req.body.patientId, req.body.type, req.body.templateKey, req.body.payload))),
);

const prefBody = z.object({ whatsapp: z.boolean(), sms: z.boolean(), email: z.boolean(), push: z.boolean(), reminders: z.boolean(), marketing: z.boolean() }).partial();

notificationRouter.get(
  "/preferences",
  handler(async (req, res) => {
    ok(res, await prisma.notificationPreference.upsert({ where: { userId: req.user!.id }, create: { userId: req.user!.id }, update: {} }));
  }),
);

notificationRouter.put(
  "/preferences",
  validate({ body: prefBody }),
  handler(async (req, res) => {
    ok(res, await prisma.notificationPreference.upsert({ where: { userId: req.user!.id }, create: { userId: req.user!.id, ...req.body }, update: req.body }));
  }),
);

/* ─────────────── WhatsApp webhook ─────────────── */

// Verification handshake
whatsappWebhookRouter.get("/", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === env.WHATSAPP_ACCESS_TOKEN.slice(0, 16)) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

whatsappWebhookRouter.post(
  "/",
  handler(async (req, res) => {
    const sig = req.get("x-hub-signature-256")?.replace("sha256=", "") ?? "";
    const expected = crypto.createHmac("sha256", env.WHATSAPP_ACCESS_TOKEN).update(JSON.stringify(req.body)).digest("hex");
    if (env.WHATSAPP_ACCESS_TOKEN && sig !== expected) return res.sendStatus(401);
    type Status = { id: string; status: string; errors?: { title: string }[] };
    const statuses: Status[] = req.body?.entry?.flatMap((e: { changes: { value: { statuses?: Status[] } }[] }) => e.changes.flatMap((c) => c.value.statuses ?? [])) ?? [];
    for (const s of statuses) {
      const status = s.status === "delivered" || s.status === "read" ? "DELIVERED" : s.status === "failed" ? "FAILED" : "SENT";
      await prisma.notification.updateMany({ where: { providerMessageId: s.id }, data: { status, error: s.errors?.[0]?.title } });
    }
    res.json({ received: true });
  }),
);

