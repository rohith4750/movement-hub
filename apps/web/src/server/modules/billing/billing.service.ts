import { Prisma, prisma, type InvoiceItemType, type InvoiceStatus } from "@movement-hub/database";
import { nextCode } from "../../lib/codes";
import { HttpError, unprocessable } from "../../lib/http-error";

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

/* ─────────────── Whose bill is it? ─────────────── */

/** Who is creating or viewing a bill. */
export interface Biller {
  id: string;
  role: string;
  therapistId: string | null;
}

/**
 * Each bill belongs to one physiotherapist: they see it, collect its payments, and it counts in
 * their collections. A physio billing someone always bills for themselves. When the Super Admin
 * bills, it goes to the physio they chose, else the physio who did the billed visit, else the
 * physio of the billed package's plan, else the patient's regular physio.
 */
export async function resolveInvoiceTherapist(tx: Tx, input: { patientId: string; items: InvoiceItemInput[]; therapistId?: string | null }, by: Biller) {
  if (by.role === "PHYSIOTHERAPIST" && by.therapistId) return by.therapistId;
  if (input.therapistId) {
    const t = await tx.therapist.findFirst({ where: { id: input.therapistId, isActive: true }, select: { id: true } });
    if (!t) throw unprocessable("THERAPIST_NOT_FOUND", "Physiotherapist not found or inactive");
    return t.id;
  }
  const apptIds = input.items.map((i) => i.appointmentId).filter((x): x is string => !!x);
  if (apptIds.length) {
    const a = await tx.appointment.findFirst({ where: { id: { in: apptIds } }, orderBy: { startAt: "desc" }, select: { therapistId: true } });
    if (a) return a.therapistId;
  }
  const pkgIds = input.items.map((i) => i.patientPackageId).filter((x): x is string => !!x);
  if (pkgIds.length) {
    const pp = await tx.patientPackage.findFirst({ where: { id: { in: pkgIds }, treatmentPlanId: { not: null } }, select: { treatmentPlan: { select: { therapistId: true } } } });
    if (pp?.treatmentPlan) return pp.treatmentPlan.therapistId;
  }
  const p = await tx.patient.findUnique({ where: { id: input.patientId }, select: { primaryTherapistId: true } });
  return p?.primaryTherapistId ?? null;
}

/** Physios work with their own patients' bills only; the Super Admin sees all (optionally one physio's). */
export function billingScope(user: { role: string; therapistId: string | null } | undefined, requested?: string): string | undefined {
  if (user?.role === "PHYSIOTHERAPIST") return user.therapistId ?? "__none__";
  return requested;
}

/** The signed-in user as a biller. */
export const billerOf = (req: { user?: { id: string; role: string; therapistId: string | null } }): Biller => ({ id: req.user!.id, role: req.user!.role, therapistId: req.user!.therapistId });

/** Stop a physio from opening or changing another physio's bill. */
export function assertBillAccess(user: { role: string; therapistId: string | null } | undefined, invoice: { therapistId: string | null }) {
  if (user?.role === "PHYSIOTHERAPIST" && invoice.therapistId !== user.therapistId) {
    throw new HttpError(403, "NOT_YOUR_BILL", "This bill belongs to another physiotherapist's patient.");
  }
}

export interface InvoiceInput {
  patientId: string;
  /** Super Admin may choose the physio; ignored for physios (they always bill for themselves). */
  therapistId?: string | null;
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

export async function createInvoice(tx: Tx, input: InvoiceInput, by: Biller, issue = false) {
  const patient = await tx.patient.findUniqueOrThrow({ where: { id: input.patientId } });
  const settings = await tx.hospitalSetting.findUnique({ where: { branchId: patient.branchId } });
  const t = computeTotals(input.items, input.discountAmount ?? 0, settings?.gstPercent ?? D(0), input.interState);
  const therapistId = await resolveInvoiceTherapist(tx, input, by);
  return tx.invoice.create({
    data: {
      invoiceNo: await nextCode(tx, "invoice"),
      branchId: patient.branchId,
      patientId: patient.id,
      therapistId,
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
      createdById: by.id,
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
      therapist: { select: { id: true, user: { select: { name: true } } } },
      payments: { include: { refunds: true }, orderBy: { createdAt: "asc" } },
      patient: { select: { id: true, patientCode: true, firstName: true, lastName: true, phone: true, email: true, addresses: { where: { isDefault: true }, take: 1 } } },
      branch: { select: { name: true, address: true, city: true, state: true, pincode: true, gstin: true, phone: true, email: true } },
    },
  });
}
