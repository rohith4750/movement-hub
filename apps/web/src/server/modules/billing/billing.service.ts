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
export async function resolveInvoiceTherapist(tx: Tx, input: { patientId: string; items: InvoiceItemInput[]; therapistId?: string | null; keepTherapist?: boolean }, by: Biller) {
  // `keepTherapist`: editing a draft that already has an owner, so a physio editing a colleague's draft does not take it over.
  if (by.role === "PHYSIOTHERAPIST" && by.therapistId && !input.keepTherapist) return by.therapistId;
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

/** Staff can see clinic bills; optionally filtered by a specific physio. */
export function billingScope(user: { role: string; therapistId: string | null } | undefined, requested?: string): string | undefined {
  return requested;
}

/** The signed-in user as a biller. */
export const billerOf = (req: { user?: { id: string; role: string; therapistId: string | null } }): Biller => ({ id: req.user!.id, role: req.user!.role, therapistId: req.user!.therapistId });

/** Staff can view and manage clinic bills. */
export function assertBillAccess(user: { role: string; therapistId: string | null } | undefined, invoice: { therapistId: string | null }) {
  // All clinic staff can access bills
}

export interface InvoiceInput {
  patientId: string;
  /** Super Admin may choose the physio; ignored for physios (they always bill for themselves). */
  therapistId?: string | null;
  /** Editing a draft: keep the physio it already belongs to (see resolveInvoiceTherapist). */
  keepTherapist?: boolean;
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

/** The calculated money fields, the line rows and the owning physio for an invoice input. */
async function invoiceParts(tx: Tx, input: InvoiceInput, by: Biller) {
  const patient = await tx.patient.findUniqueOrThrow({ where: { id: input.patientId } });
  const settings = await tx.hospitalSetting.findUnique({ where: { branchId: patient.branchId } });
  const t = computeTotals(input.items, input.discountAmount ?? 0, settings?.gstPercent ?? D(0), input.interState);
  const therapistId = await resolveInvoiceTherapist(tx, input, by);
  const money = {
    therapistId,
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
  };
  const lines = t.lines.map((l) => ({
    type: l.type,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discount ?? 0,
    amount: l.amount,
    appointmentId: l.appointmentId,
    patientPackageId: l.patientPackageId,
  }));
  return { patient, money, lines };
}

export async function createInvoice(tx: Tx, input: InvoiceInput, by: Biller, issue = false) {
  const { patient, money, lines } = await invoiceParts(tx, input, by);
  return tx.invoice.create({
    data: {
      ...money,
      invoiceNo: await nextCode(tx, "invoice"),
      branchId: patient.branchId,
      patientId: patient.id,
      status: issue ? "ISSUED" : "DRAFT",
      issuedAt: issue ? new Date() : undefined,
      createdById: by.id,
      items: { create: lines },
    },
    include: { items: true },
  });
}

/**
 * Edit a DRAFT in place: same invoice, same number, new lines and totals. (Editing used to delete and
 * recreate it, which changed the id and number and broke the link from the visit it was drafted for.)
 */
export async function updateDraftInvoice(tx: Tx, invoiceId: string, input: InvoiceInput, by: Biller) {
  const { money, lines } = await invoiceParts(tx, input, by);
  return tx.invoice.update({
    where: { id: invoiceId },
    data: { ...money, items: { deleteMany: {}, create: lines } },
    include: { items: true },
  });
}

/**
 * A draft bill for a booked visit, so the front desk does not have to build one by hand: it holds what
 * the visit normally costs (the clinic's price for each treatment in the plan, else the flat fee in
 * settings) and stays a DRAFT until staff check it, edit it if needed and issue it.
 *
 * Nothing is drafted when the visit is already on a bill, is paid for by a package, or the clinic has
 * not set a price yet (a bill of zero would be noise). Returns the draft, or null when none was made.
 */
export async function draftInvoiceForAppointment(appointmentId: string) {
  return prisma.$transaction(async (tx) => {
    const a = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        therapySession: { select: { patientPackageId: true } },
        treatmentPlan: { select: { items: { select: { category: true } } } },
        invoiceItems: { select: { id: true }, take: 1 },
      },
    });
    if (!a || a.invoiceItems.length) return null;
    if (["CANCELLED", "RESCHEDULED", "NO_SHOW"].includes(a.status)) return null;
    if (a.therapySession?.patientPackageId) return null; // the package already paid for it

    const settings = await tx.hospitalSetting.findUnique({ where: { branchId: a.branchId } });
    if (!settings) return null;

    let items: InvoiceItemInput[] = [];
    if (a.type === "THERAPY_SESSION") {
      const categories = [...new Set((a.treatmentPlan?.items ?? []).map((i) => i.category))];
      const priced = categories.length
        ? await tx.treatmentPrice.findMany({ where: { category: { in: categories }, isActive: true, price: { gt: 0 } }, orderBy: [{ sortOrder: "asc" }, { category: "asc" }] })
        : [];
      items = priced.length
        ? priced.map((p) => ({ type: "THERAPY_SESSION" as const, description: p.category, quantity: 1, unitPrice: Number(p.price) }))
        : [{ type: "THERAPY_SESSION" as const, description: "Therapy session", quantity: 1, unitPrice: Number(settings.therapySessionFee) }];
    } else if (a.type === "HOME_VISIT") {
      items = [{ type: "HOME_VISIT", description: "Home visit", quantity: 1, unitPrice: Number(settings.homeVisitFee) }];
    } else {
      items = [{ type: "CONSULTATION", description: a.type === "FOLLOW_UP_CONSULTATION" ? "Follow-up consultation" : "Consultation", quantity: 1, unitPrice: Number(settings.consultationFee) }];
    }
    items = items.filter((i) => i.unitPrice > 0).map((i) => ({ ...i, appointmentId: a.id }));
    if (!items.length) return null;

    // Billed to the visit's physio (createInvoice finds them from the linked appointment).
    return createInvoice(tx, { patientId: a.patientId, items }, { id: a.bookedById, role: "ADMIN", therapistId: null });
  });
}

/**
 * Removes the unissued draft bills of a visit that is cancelled or deleted. Issued, paid and cancelled
 * bills are never touched: those are financial records.
 */
export async function discardDraftBills(tx: Tx, appointmentId: string) {
  const drafts = await tx.invoice.findMany({ where: { status: "DRAFT", deletedAt: null, items: { some: { appointmentId } } }, select: { id: true } });
  if (drafts.length) await tx.invoice.deleteMany({ where: { id: { in: drafts.map((d) => d.id) } } });
  return drafts.length;
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
      items: { include: { appointment: { select: { id: true, appointmentNo: true, startAt: true, type: true } } } },
      therapist: { select: { id: true, user: { select: { name: true } } } },
      payments: { include: { refunds: true }, orderBy: { createdAt: "asc" } },
      patient: { select: { id: true, patientCode: true, firstName: true, lastName: true, phone: true, email: true, addresses: { where: { isDefault: true }, take: 1 } } },
      branch: { select: { name: true, address: true, city: true, state: true, pincode: true, gstin: true, phone: true, email: true } },
    },
  });
}
