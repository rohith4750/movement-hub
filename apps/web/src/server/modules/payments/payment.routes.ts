import { Router, raw } from "../../router";
import crypto from "node:crypto";
import Razorpay from "razorpay";
import { z } from "zod";
import { Prisma, prisma } from "@movement-hub/database";
import { env } from "../../config/env";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http";
import { audit } from "../../lib/audit";
import { nextCode } from "../../lib/codes";
import { badRequest, unauthorized, unprocessable } from "../../lib/http-error";
import { dayRange } from "../../lib/time";
import { assertPatientAccess, authorize, isPatient } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { assertBillAccess, billingScope, refreshInvoiceBalance } from "../billing/billing.service";
import { renderReceiptHtml } from "../billing/documents";
import { notifyPatient } from "../notifications/notification.service";

export const paymentRouter = Router();
export const refundRouter = Router();
/** Receives the raw request body so the raw body is available for signature checks. */
export const razorpayWebhookRouter = Router();

const razorpay = env.RAZORPAY_KEY_ID ? new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET }) : null;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

function hmac(secret: string, body: string | Buffer) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function payableInvoice(invoiceId: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (!["ISSUED", "PARTIALLY_PAID"].includes(inv.status)) throw unprocessable("NOT_PAYABLE", `Invoice is ${inv.status}`);
  return inv;
}

/** Mark a payment SUCCESS and recompute the invoice — idempotent. */
async function confirmPayment(paymentId: string, data: Prisma.PaymentUpdateInput) {
  const p = await prisma.$transaction(async (tx) => {
    const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (current.status === "SUCCESS") return current;
    const updated = await tx.payment.update({ where: { id: paymentId }, data: { ...data, status: "SUCCESS", paidAt: new Date() } });
    await refreshInvoiceBalance(tx, updated.invoiceId);
    return updated;
  });
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
  await notifyPatient(inv.patientId, "PAYMENT_CONFIRMATION", "payment_confirmation", { amount: p.amount.toString(), receiptNo: p.receiptNo, invoiceNo: inv.invoiceNo });
  return p;
}

/* ─────────────── List / offline ─────────────── */

const listQuery = paginationQuery.extend({
  therapistId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  method: z.enum(["CASH", "CARD", "UPI", "NET_BANKING", "RAZORPAY"]).optional(),
  status: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

paymentRouter.get(
  "/",
  authorize("ACCOUNTANT", "ADMIN", "PATIENT"),
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const where: Prisma.PaymentWhereInput = {
      invoiceId: query.invoiceId,
      method: query.method,
      status: query.status,
      ...(isPatient(req) ? { invoice: { patientId: req.user!.patientId! } } : {}),
      // Payments visible across the clinic (or filtered if therapistId provided)
      ...(query.therapistId ? { invoice: { therapistId: query.therapistId } } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: dayRange(query.from).gte } : {}), ...(query.to ? { lt: dayRange(query.to).lt } : {}) } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.payment.findMany({ where, ...paging(query), orderBy: { createdAt: "desc" }, include: { invoice: { select: { invoiceNo: true, patient: { select: { firstName: true, lastName: true, patientCode: true } } } } } }),
      prisma.payment.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

paymentRouter.post(
  "/",
  authorize("ACCOUNTANT", "RECEPTIONIST", "ADMIN"),
  validate({
    body: z.object({
      invoiceId: z.string().uuid(),
      method: z.enum(["CASH", "CARD", "UPI", "NET_BANKING"]),
      amount: z.number().positive(),
      referenceNo: z.string().optional(),
    }),
  }),
  handler(async (req, res) => {
    const inv = await payableInvoice(req.body.invoiceId);
    assertBillAccess(req.user, inv);
    // One transaction with the invoice row locked: two payments recorded at the same moment are
    // checked one after the other against the real balance, so the invoice can't be overpaid.
    const p = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${inv.id} FOR UPDATE`;
      const cur = await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      if (!["ISSUED", "PARTIALLY_PAID"].includes(cur.status)) throw unprocessable("NOT_PAYABLE", `Invoice is ${cur.status}`);
      if (D(req.body.amount).gt(cur.dueAmount)) throw unprocessable("OVERPAYMENT", `Amount exceeds balance due (${cur.dueAmount})`);
      const payment = await tx.payment.create({
        data: {
          receiptNo: await nextCode(tx, "receipt"),
          invoiceId: inv.id,
          method: req.body.method,
          amount: req.body.amount,
          referenceNo: req.body.referenceNo,
          receivedById: req.user!.id,
          status: "SUCCESS",
          paidAt: new Date(),
        },
      });
      await refreshInvoiceBalance(tx, inv.id);
      await audit(req, "CREATE", "Payment", payment.id, null, payment, tx);
      return payment;
    });
    await notifyPatient(inv.patientId, "PAYMENT_CONFIRMATION", "payment_confirmation", { amount: p.amount.toString(), receiptNo: p.receiptNo, invoiceNo: inv.invoiceNo });
    created(res, p);
  }),
);

/* ─────────────── Razorpay ─────────────── */

paymentRouter.post(
  "/razorpay/order",
  authorize("RECEPTIONIST", "PATIENT", "ACCOUNTANT"),
  validate({ body: z.object({ invoiceId: z.string().uuid() }) }),
  handler(async (req, res) => {
    if (!razorpay) throw unprocessable("PAYMENTS_DISABLED", "Online payments are not configured");
    const inv = await payableInvoice(req.body.invoiceId);
    assertPatientAccess(req, inv.patientId);
    assertBillAccess(req.user, inv);
    const order = await razorpay.orders.create({ amount: Math.round(Number(inv.dueAmount) * 100), currency: "INR", receipt: inv.invoiceNo, notes: { invoiceId: inv.id } });
    const payment = await prisma.$transaction(async (tx) =>
      tx.payment.create({ data: { receiptNo: await nextCode(tx, "receipt"), invoiceId: inv.id, method: "RAZORPAY", amount: inv.dueAmount, razorpayOrderId: order.id } }),
    );
    ok(res, { paymentId: payment.id, orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID });
  }),
);

paymentRouter.post(
  "/razorpay/verify",
  authorize("RECEPTIONIST", "PATIENT", "ACCOUNTANT"),
  validate({ body: z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }) }),
  handler(async (req, res) => {
    const { razorpay_order_id: orderId, razorpay_payment_id: rpPaymentId, razorpay_signature: sig } = req.body;
    if (!safeEqual(hmac(env.RAZORPAY_KEY_SECRET, `${orderId}|${rpPaymentId}`), sig)) throw badRequest("Payment signature mismatch", "INVALID_SIGNATURE");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { razorpayOrderId: orderId }, include: { invoice: true } });
    assertPatientAccess(req, payment.invoice.patientId);
    ok(res, await confirmPayment(payment.id, { razorpayPaymentId: rpPaymentId, razorpaySignature: sig }));
  }),
);

razorpayWebhookRouter.post(
  "/",
  raw({ type: "application/json" }),
  handler(async (req, res) => {
    const sig = req.get("x-razorpay-signature") ?? "";
    if (!env.RAZORPAY_WEBHOOK_SECRET || !safeEqual(hmac(env.RAZORPAY_WEBHOOK_SECRET, req.body as Buffer), sig)) throw unauthorized("Invalid webhook signature");
    const event = JSON.parse((req.body as Buffer).toString("utf8")) as {
      event: string;
      payload: { payment?: { entity: { id: string; order_id: string } }; refund?: { entity: { id: string; status: string } } };
    };
    const entity = event.payload.payment?.entity;
    if (entity) {
      const payment = await prisma.payment.findUnique({ where: { razorpayOrderId: entity.order_id } });
      if (payment && event.event === "payment.captured") await confirmPayment(payment.id, { razorpayPaymentId: entity.id });
      if (payment && event.event === "payment.failed" && payment.status === "PENDING") await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    }
    if (event.payload.refund && event.event === "refund.processed") {
      await prisma.refund.updateMany({ where: { razorpayRefundId: event.payload.refund.entity.id }, data: { status: "PROCESSED", processedAt: new Date() } });
    }
    res.json({ received: true });
  }),
);

/* ─────────────── Details, receipts, refunds ─────────────── */

paymentRouter.get(
  "/:id",
  authorize("ACCOUNTANT", "ADMIN", "RECEPTIONIST", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: req.params.id }, include: { refunds: true, invoice: { include: { patient: { select: { id: true, firstName: true, lastName: true, patientCode: true } } } } } });
    assertPatientAccess(req, p.invoice.patientId);
    assertBillAccess(req.user, p.invoice);
    ok(res, p);
  }),
);

paymentRouter.get(
  "/:id/receipt",
  authorize("ACCOUNTANT", "ADMIN", "RECEPTIONIST", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const p = await prisma.payment.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        refunds: { where: { status: { not: "FAILED" } }, select: { amount: true } },
        invoice: { include: { patient: true, branch: true, therapist: { select: { user: { select: { name: true } } } } } },
      },
    });
    assertPatientAccess(req, p.invoice.patientId);
    assertBillAccess(req.user, p.invoice);
    if (p.status !== "SUCCESS" && p.status !== "PARTIALLY_REFUNDED") throw unprocessable("NOT_PAID", "Receipt is available after successful payment");
    const receiver = p.receivedById ? await prisma.user.findUnique({ where: { id: p.receivedById }, select: { name: true } }) : null;
    res.type("html").send(
      renderReceiptHtml({
        ...p,
        receivedBy: receiver?.name ?? (p.method === "RAZORPAY" ? "Online (Razorpay)" : null),
        refunded: p.refunds.reduce((s, r) => s + Number(r.amount), 0),
      }),
    );
  }),
);

paymentRouter.post(
  "/:id/refunds",
  authorize("ACCOUNTANT", "ADMIN"),
  validate({ params: idParam, body: z.object({ amount: z.number().positive(), reason: z.string().min(3) }) }),
  handler(async (req, res) => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: req.params.id }, include: { refunds: true, invoice: { select: { therapistId: true } } } });
    assertBillAccess(req.user, p.invoice);
    if (!["SUCCESS", "PARTIALLY_REFUNDED"].includes(p.status)) throw unprocessable("NOT_REFUNDABLE", `Payment is ${p.status}`);
    const refunded = p.refunds.filter((r) => r.status !== "FAILED").reduce((s, r) => s.add(r.amount), D(0));
    const refundable = p.amount.sub(refunded);
    if (D(req.body.amount).gt(refundable)) throw unprocessable("OVER_REFUND", `Maximum refundable is ${refundable}`);

    let razorpayRefundId: string | undefined;
    if (p.method === "RAZORPAY" && p.razorpayPaymentId && razorpay) {
      const r = await razorpay.payments.refund(p.razorpayPaymentId, { amount: Math.round(req.body.amount * 100), notes: { reason: req.body.reason } });
      razorpayRefundId = r.id;
    }
    const refund = await prisma.$transaction(async (tx) => {
      const r = await tx.refund.create({
        data: {
          paymentId: p.id, amount: req.body.amount, reason: req.body.reason, processedById: req.user!.id, razorpayRefundId,
          status: p.method === "RAZORPAY" ? "PENDING" : "PROCESSED", processedAt: p.method === "RAZORPAY" ? undefined : new Date(),
        },
      });
      const fully = refundable.sub(req.body.amount).lte(0);
      await tx.payment.update({ where: { id: p.id }, data: { status: fully ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
      await refreshInvoiceBalance(tx, p.invoiceId);
      return r;
    });
    await audit(req, "CREATE", "Refund", refund.id, null, refund);
    created(res, refund);
  }),
);

refundRouter.get(
  "/",
  authorize("ACCOUNTANT", "ADMIN"),
  validate({ query: paginationQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof paginationQuery>>(req);
    const [data, total] = await Promise.all([
      prisma.refund.findMany({ ...paging(query), orderBy: { createdAt: "desc" }, include: { payment: { select: { receiptNo: true, method: true, invoice: { select: { invoiceNo: true } } } } } }),
      prisma.refund.count(),
    ]);
    ok(res, data, meta(query, total));
  }),
);

