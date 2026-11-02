import { prisma, type Prisma } from "@movement-hub/database";

export type Tx = Prisma.TransactionClient | typeof prisma;

const PREFIX = {
  patient: () => "MH-P",
  appointment: () => "MH-A",
  plan: () => "MH-TP",
  invoice: () => `MH-INV-${new Date().getFullYear()}`,
  receipt: () => "MH-RC",
};

/**
 * Human-readable sequential numbers, e.g. MH-A-000123.
 * Based on the highest number already issued (not a row count), so deleting records never
 * causes a number to be reused. Unique constraints still guard against concurrent races.
 */
export async function nextCode(tx: Tx, kind: keyof typeof PREFIX) {
  const prefix = `${PREFIX[kind]()}-`;
  const latest = {
    patient: () => tx.patient.findFirst({ where: { patientCode: { startsWith: prefix } }, orderBy: { patientCode: "desc" }, select: { patientCode: true } }).then((r) => r?.patientCode),
    appointment: () => tx.appointment.findFirst({ where: { appointmentNo: { startsWith: prefix } }, orderBy: { appointmentNo: "desc" }, select: { appointmentNo: true } }).then((r) => r?.appointmentNo),
    plan: () => tx.treatmentPlan.findFirst({ where: { planNo: { startsWith: prefix } }, orderBy: { planNo: "desc" }, select: { planNo: true } }).then((r) => r?.planNo),
    invoice: () => tx.invoice.findFirst({ where: { invoiceNo: { startsWith: prefix } }, orderBy: { invoiceNo: "desc" }, select: { invoiceNo: true } }).then((r) => r?.invoiceNo),
    receipt: () => tx.payment.findFirst({ where: { receiptNo: { startsWith: prefix } }, orderBy: { receiptNo: "desc" }, select: { receiptNo: true } }).then((r) => r?.receiptNo),
  };
  const last = await latest[kind]();
  const n = last ? Number(last.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(6, "0")}`;
}
