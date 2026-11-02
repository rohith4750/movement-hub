import { Router } from "../../router";
import { z } from "zod";
import { prisma, type Prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http";
import { audit } from "../../lib/audit";
import { unprocessable } from "../../lib/http-error";
import { dateOnly, dayRange } from "../../lib/time";
import { assertPatientAccess, authorize, scopePatient } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { computeTotals, createInvoice, invoiceWithDetails } from "./billing.service";
import { renderInvoiceHtml } from "./invoice.template";

export const invoiceRouter = Router();

const itemBody = z.object({
  type: z.enum(["CONSULTATION", "THERAPY_SESSION", "PACKAGE", "HOME_VISIT", "TRAVEL_CHARGE", "OTHER"]),
  description: z.string().min(2),
  quantity: z.number().int().min(1).default(1),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  appointmentId: z.string().uuid().optional(),
  patientPackageId: z.string().uuid().optional(),
});

const invoiceBody = z.object({
  patientId: z.string().uuid(),
  items: z.array(itemBody).min(1),
  discountAmount: z.number().nonnegative().default(0),
  discountReason: z.string().optional(),
  notes: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  interState: z.boolean().default(false),
  issue: z.boolean().default(false),
});

const listQuery = paginationQuery.extend({
  status: z.enum(["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED", "REFUNDED"]).optional(),
  patientId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

invoiceRouter.get(
  "/",
  authorize("ACCOUNTANT", "ADMIN", "RECEPTIONIST", "PATIENT"),
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    const where: Prisma.InvoiceWhereInput = {
      deletedAt: null,
      status: query.status,
      patientId: scopePatient(req, query.patientId),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: dayRange(query.from).gte } : {}), ...(query.to ? { lt: dayRange(query.to).lt } : {}) } } : {}),
      ...(query.search ? { OR: [{ invoiceNo: { contains: query.search, mode: "insensitive" } }, { patient: { firstName: { contains: query.search, mode: "insensitive" } } }] } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.invoice.findMany({ where, ...paging(query), orderBy: { createdAt: "desc" }, include: { patient: { select: { id: true, patientCode: true, firstName: true, lastName: true } } } }),
      prisma.invoice.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

/** Preview totals without saving — used by the billing form. */
invoiceRouter.post(
  "/preview",
  authorize("ACCOUNTANT", "ADMIN", "RECEPTIONIST"),
  validate({ body: invoiceBody }),
  handler(async (req, res) => {
    const patient = await prisma.patient.findUniqueOrThrow({ where: { id: req.body.patientId } });
    const settings = await prisma.hospitalSetting.findUnique({ where: { branchId: patient.branchId } });
    const { Prisma: P } = await import("@movement-hub/database");
    ok(res, computeTotals(req.body.items, req.body.discountAmount, settings?.gstPercent ?? new P.Decimal(0), req.body.interState));
  }),
);

invoiceRouter.post(
  "/",
  authorize("ACCOUNTANT", "RECEPTIONIST", "ADMIN"),
  validate({ body: invoiceBody }),
  handler(async (req, res) => {
    const { issue, dueDate, ...input } = req.body;
    const inv = await prisma.$transaction((tx) => createInvoice(tx, { ...input, dueDate: dueDate ? dateOnly(dueDate) : undefined }, req.user!.id, issue));
    await audit(req, "CREATE", "Invoice", inv.id, null, inv);
    created(res, inv);
  }),
);

invoiceRouter.get(
  "/:id",
  authorize("ACCOUNTANT", "ADMIN", "RECEPTIONIST", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const inv = await invoiceWithDetails(req.params.id);
    assertPatientAccess(req, inv.patientId);
    ok(res, inv);
  }),
);

/** Only DRAFT invoices can be edited. Issued invoices are immutable. */
invoiceRouter.patch(
  "/:id",
  authorize("ACCOUNTANT", "ADMIN"),
  validate({ params: idParam, body: invoiceBody.omit({ patientId: true, issue: true }).partial() }),
  handler(async (req, res) => {
    const before = await prisma.invoice.findUniqueOrThrow({ where: { id: req.params.id }, include: { items: true } });
    if (before.status !== "DRAFT") throw unprocessable("INVOICE_LOCKED", "Issued invoices cannot be edited. Cancel or refund instead.");
    const inv = await prisma.$transaction(async (tx) => {
      await tx.invoice.delete({ where: { id: before.id } });
      return createInvoice(
        tx,
        {
          patientId: before.patientId,
          items: req.body.items ?? before.items.map((i) => ({ ...i, unitPrice: Number(i.unitPrice), discount: Number(i.discount), appointmentId: i.appointmentId ?? undefined, patientPackageId: i.patientPackageId ?? undefined })),
          discountAmount: req.body.discountAmount ?? Number(before.discountAmount),
          discountReason: req.body.discountReason ?? before.discountReason ?? undefined,
          notes: req.body.notes ?? before.notes ?? undefined,
          dueDate: req.body.dueDate ? dateOnly(req.body.dueDate) : before.dueDate ?? undefined,
          interState: req.body.interState,
        },
        req.user!.id,
      );
    });
    await audit(req, "UPDATE", "Invoice", inv.id, before, inv);
    ok(res, inv);
  }),
);

invoiceRouter.post(
  "/:id/issue",
  authorize("ACCOUNTANT", "RECEPTIONIST", "ADMIN"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: req.params.id } });
    if (inv.status !== "DRAFT") throw unprocessable("INVALID_STATUS", `Invoice is ${inv.status}`);
    const updated = await prisma.invoice.update({ where: { id: inv.id }, data: { status: "ISSUED", issuedAt: new Date() } });
    await audit(req, "UPDATE", "Invoice", inv.id, { status: inv.status }, { status: "ISSUED" });
    ok(res, updated);
  }),
);

invoiceRouter.post(
  "/:id/cancel",
  authorize("ACCOUNTANT", "ADMIN"),
  validate({ params: idParam, body: z.object({ reason: z.string().min(3) }) }),
  handler(async (req, res) => {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: req.params.id } });
    if (inv.paidAmount.gt(0)) throw unprocessable("HAS_PAYMENTS", "Invoice has payments. Refund them first.");
    if (inv.status === "CANCELLED") throw unprocessable("INVALID_STATUS", "Already cancelled");
    const updated = await prisma.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED", notes: `${inv.notes ?? ""}\n[Cancelled] ${req.body.reason}`.trim() } });
    await audit(req, "UPDATE", "Invoice", inv.id, { status: inv.status }, { status: "CANCELLED", reason: req.body.reason });
    ok(res, updated);
  }),
);

/** Printable invoice (HTML; browser "Save as PDF"). */
invoiceRouter.get(
  "/:id/pdf",
  authorize("ACCOUNTANT", "ADMIN", "RECEPTIONIST", "PATIENT"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const inv = await invoiceWithDetails(req.params.id);
    assertPatientAccess(req, inv.patientId);
    res.type("html").send(renderInvoiceHtml(inv));
  }),
);
