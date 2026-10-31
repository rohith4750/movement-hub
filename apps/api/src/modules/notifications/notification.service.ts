import { prisma, type NotificationChannel, type NotificationType, type Prisma } from "@movement-hub/database";
import { env } from "../../config/env.js";

export interface NotifyInput {
  userId?: string | null;
  phone?: string | null;
  email?: string | null;
  channel: NotificationChannel;
  type: NotificationType;
  templateKey: string;
  payload: Record<string, unknown>;
  scheduledAt?: Date;
}

/** Queue a notification. Immediate ones are dispatched right away; scheduled ones by the job runner. */
export async function notify(input: NotifyInput) {
  if (input.userId) {
    const pref = await prisma.notificationPreference.findUnique({ where: { userId: input.userId } });
    const key = input.channel.toLowerCase() as "whatsapp" | "sms" | "email" | "push";
    if (pref && pref[key] === false) return null;
  }
  const n = await prisma.notification.create({
    data: {
      userId: input.userId ?? undefined,
      phone: input.phone ?? undefined,
      email: input.email ?? undefined,
      channel: input.channel,
      type: input.type,
      templateKey: input.templateKey,
      payload: input.payload as Prisma.InputJsonValue,
      scheduledAt: input.scheduledAt ?? new Date(),
    },
  });
  if (!input.scheduledAt || input.scheduledAt <= new Date()) await dispatch(n.id);
  return n;
}

/** Notify a patient via WhatsApp by patientId. */
export async function notifyPatient(patientId: string, type: NotificationType, templateKey: string, payload: Record<string, unknown>, scheduledAt?: Date) {
  const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { userId: true, phone: true, firstName: true } });
  if (!p) return null;
  return notify({ userId: p.userId, phone: p.phone, channel: "WHATSAPP", type, templateKey, payload: { name: p.firstName, ...payload }, scheduledAt });
}

export async function dispatch(notificationId: string) {
  const n = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!n || n.status !== "QUEUED") return;
  try {
    let providerMessageId: string | undefined;
    if (n.channel === "WHATSAPP" && env.WHATSAPP_ACCESS_TOKEN && n.phone) {
      providerMessageId = await sendWhatsApp(n.phone, n.templateKey, n.payload as Record<string, unknown>);
    } else {
      // No provider configured: log so development flows remain visible.
      console.info(`[notify:${n.channel}] ${n.templateKey} → ${n.phone ?? n.email ?? n.userId}`, n.payload);
    }
    await prisma.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId } });
  } catch (e) {
    await prisma.notification.update({ where: { id: n.id }, data: { status: "FAILED", error: String(e) } });
  }
}

async function sendWhatsApp(phone: string, template: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone.replace(/^\+/, ""),
      type: "template",
      template: {
        name: template,
        language: { code: "en" },
        components: [{ type: "body", parameters: Object.values(payload).map((v) => ({ type: "text", text: String(v) })) }],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { messages?: { id: string }[] };
  return body.messages?.[0]?.id;
}
