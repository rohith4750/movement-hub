import { Prisma, prisma, type InvoiceItemType, type InvoiceStatus } from "@movement-hub/database";
import { nextCode } from "../../lib/codes";
import { unprocessable } from "../../lib/http-error";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface InvoiceItemInput {
  type: InvoiceItemType;
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  appointmentId?: string;
  patientPackageId?: string;
}

export interface InvoiceInput {
  patientId: string;
  items: InvoiceItemInput[];
  discountAmount?: number;
  discountReason?: string;
  notes?: string;
  dueDate?: Date;
  interState?: boolean; // IGST instead of CGST+SGST
}

/** Calculates line amounts, discount and GST. GST rate comes from hospital settings. */
export function computeTotals(items: InvoiceItemInput[], discountAmount: number, gstPercent: Prisma.Decimal, interState = false) {
  const lines = items.map((i) => {
    const amount = D(i.unitPrice).mul(i.quantity).sub(i.discount ?? 0);
    if (amount.isNeg()) throw unprocessable("INVALID_DISCOUNT", `Line discount exceeds amount for "${i.description}"`);
    return { ...i, amount: amount.toDecimalPlaces(2) };
  });
  const subtotal = lines.reduce((s, l) => s.add(l.amount), D(0));
  if (D(discountAmount).gt(subtotal)) throw unprocessable("INVALID_DISCOUNT", "Discount exceeds subtotal");
  const taxable = subtotal.sub(discountAmount).toDecimalPlaces(2);
  const tax = taxable.mul(gstPercent).div(100).toDecimalPlaces(2);
  const half = tax.div(2).toDecimalPlaces(2);
  return {
    lines,
    subtotal,
    taxableAmount: taxable,
    gstPercent,
    cgstAmount: interState ? D(0) : half,
    sgstAmount: interState ? D(0) : tax.sub(half),
    igstAmount: interState ? tax : D(0),
    totalAmount: taxable.add(tax).toDecimalPlaces(2),
  };
}

export async function createInvoice(tx: Tx, input: InvoiceInput, createdById: string, issue = false) {
  const patient = await tx.patient.findUniqueOrThrow({ where: { id: input.patientId } });
  const settings = await tx.hospitalSetting.findUnique({ where: { branchId: patient.branchId } });
  const t = computeTotals(input.items, input.discountAmount ?? 0, settings?.gstPercent ?? D(0), input.interState);
  return tx.invoice.create({
    data: {
      invoiceNo: await nextCode(tx, "invoice"),
      branchId: patient.branchId,
      patientId: patient.id,
      status: issue ? "ISSUED" : "DRAFT",
      issuedAt: issue ? new Date() : undefined,
      subtotal: t.subtotal,
      discountAmount: input.discountAmount ?? 0,
      discountReason: input.discountReason,
      taxableAmount: t.taxableAmount,
      gstPercent: t.gstPercent,
      cgstAmount: t.cgstAmount,
      sgstAmount: t.sgstAmount,
      igstAmount: t.igstAmount,
      totalAmount: t.totalAmount,
      dueAmount: t.totalAmount,
      dueDate: input.dueDate,
      notes: input.notes,
      createdById,
      items: {
        create: t.lines.map((l) => ({
          type: l.type,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount ?? 0,
          amount: l.amount,
          appointmentId: l.appointmentId,
          patientPackageId: l.patientPackageId,
        })),
      },
    },
    include: { items: true },
  });
}

/** Recalculate paid/due/status after a payment or refund. */
export async function refreshInvoiceBalance(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: { include: { refunds: true } } } });
  let paid = D(0);
  for (const p of inv.payments) {
    if (p.status === "SUCCESS" || p.status === "PARTIALLY_REFUNDED" || p.status === "REFUNDED") {
      paid = paid.add(p.amount);
      for (const r of p.refunds) if (r.status !== "FAILED") paid = paid.sub(r.amount);
    }
  }
  const due = inv.totalAmount.sub(paid);
  let status: InvoiceStatus = inv.status;
  if (inv.status !== "CANCELLED" && inv.status !== "DRAFT") {
    const anyRefund = inv.payments.some((p) => p.refunds.length > 0);
    status = due.lte(0) ? "PAID" : paid.gt(0) ? "PARTIALLY_PAID" : anyRefund ? "REFUNDED" : "ISSUED";
  }
  return tx.invoice.update({ where: { id: inv.id }, data: { paidAmount: paid, dueAmount: due.isNeg() ? D(0) : due, status } });
}

export async function invoiceWithDetails(id: string) {
  return prisma.invoice.findUniqueOrThrow({
    where: { id },
    include: {
      items: true,
      payments: { include: { refunds: true }, orderBy: { createdAt: "asc" } },
      patient: { select: { id: true, patientCode: true, firstName: true, lastName: true, phone: true, email: true, addresses: { where: { isDefault: true }, take: 1 } } },
      branch: { select: { name: true, address: true, city: true, state: true, pincode: true, gstin: true, phone: true, email: true } },
    },
  });
}
