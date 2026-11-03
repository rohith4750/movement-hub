/**
 * Branded, print-ready documents: the GST tax invoice and the payment receipt. Self-contained
 * HTML (logo embedded, no external files) so the same page prints from a browser and turns into a
 * PDF on the phone. Laid out for A4.
 */
import { LOGO_DATA_URI } from "../../lib/brand-logo";

/* ─────────────── helpers ─────────────── */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (v: unknown) => `₹${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TZ = "Asia/Kolkata";
const fmtDate = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const METHOD: Record<string, string> = { CASH: "Cash", CARD: "Card", UPI: "UPI", NET_BANKING: "Net banking", RAZORPAY: "Online (Razorpay)" };

const titleCase = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const methodName = (m: string) => METHOD[m] ?? titleCase(m);

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const twoDigits = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const threeDigits = (n: number) => `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? " " : ""}` : ""}${n % 100 ? twoDigits(n % 100) : ""}`;
/** Indian numbering: crore, lakh, thousand. */
function intWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${intWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}
/** "₹1,250.50" → "Rupees One Thousand Two Hundred Fifty and Fifty Paise Only". */
export function amountInWords(v: unknown) {
  const amount = Math.round(Number(v ?? 0) * 100) / 100;
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  return `Rupees ${intWords(rupees)}${paise ? ` and ${twoDigits(paise)} Paise` : ""} Only`;
}

/* ─────────────── shared layout ─────────────── */

export interface Clinic {
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
}

const CSS = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
:root { --navy:#0E1645; --navy2:#1C2670; --gold:#B8913A; --gold-d:#7A5C16; --gold-l:#FBF3DC; --ink:#0A1033; --muted:#3F4768; --line:#7C86AB; --line-s:#BFC6DB; --soft:#E9ECF5; --green:#046C4E; --red:#B91C1C; --amber:#B45309; --r:4px; }
html, body { margin:0; padding:0; }
body { font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color:var(--ink); font-size:12.5px; line-height:1.45; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.page { position:relative; max-width:794px; margin:0 auto; padding:0 0 8px; overflow:hidden; }
.watermark { position:absolute; left:50%; top:52%; width:360px; height:360px; transform:translate(-50%,-50%); opacity:.06; z-index:0; }
.content { position:relative; z-index:1; }
.band { background:var(--navy); color:#fff; border-radius:var(--r); padding:18px 22px; display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:5px solid var(--gold); }
.brand { display:flex; align-items:center; gap:14px; }
.brand img { width:76px; height:76px; border-radius:50%; background:#fff; padding:3px; box-shadow:0 0 0 2px var(--gold); }
.brand .name { font-size:24px; font-weight:800; letter-spacing:3px; }
.brand .tag { color:#E5C67F; font-size:11px; font-weight:700; letter-spacing:2.6px; margin-top:2px; }
.doc { text-align:right; }
.doc .title { font-size:19px; font-weight:800; letter-spacing:2px; }
.doc .no { color:#E5C67F; font-weight:700; font-size:13px; margin-top:4px; }
.doc .date { color:#DDE1F3; font-size:11.5px; margin-top:2px; }
.clinic { color:var(--muted); font-size:11.5px; padding:9px 2px 9px; border-bottom:1px solid var(--line); display:flex; flex-wrap:wrap; gap:4px 14px; }
.clinic b { color:var(--ink); font-weight:700; }
.grid2 { display:flex; gap:12px; margin-top:14px; }
.card { --px:14px; --py:12px; flex:1; border:1.5px solid var(--navy); border-radius:var(--r); padding:var(--py) var(--px); background:#fff; }
.card > .label { background:var(--navy); color:#fff; margin:calc(var(--py) * -1) calc(var(--px) * -1) 10px; padding:6px var(--px); border-radius:2px 2px 0 0; letter-spacing:1.6px; }
.label { font-size:10px; font-weight:800; letter-spacing:1.6px; color:var(--gold-d); text-transform:uppercase; margin-bottom:6px; }
.big { font-size:15px; font-weight:700; }
.muted { color:var(--muted); }
.kv { display:flex; justify-content:space-between; gap:12px; padding:3px 0; border-bottom:1px solid var(--line-s); }
.kv:last-child { border-bottom:none; }
.kv span:first-child { color:var(--muted); }
.kv span:last-child { font-weight:700; text-align:right; }
.kv span.pill, .pill { color:#fff !important; }
.pill { display:inline-block; padding:2px 10px; border-radius:var(--r); font-size:10.5px; font-weight:800; letter-spacing:.8px; color:#fff; }
.pill.PAID { background:var(--green); } .pill.ISSUED, .pill.PARTIALLY_PAID { background:var(--amber); }
.pill.DRAFT { background:#475569; } .pill.CANCELLED, .pill.REFUNDED { background:var(--red); }
table.items { width:100%; border-collapse:separate; border-spacing:0; margin-top:14px; border:1.5px solid var(--navy); border-radius:var(--r); overflow:hidden; }
table.items th { background:var(--navy); color:#fff; font-size:10.5px; letter-spacing:1px; text-transform:uppercase; text-align:left; padding:9px 10px; }
table.items td { padding:9px 10px; border-bottom:1px solid var(--line-s); vertical-align:top; }
table.items td + td, table.items th + th { border-left:1px solid var(--line-s); }
table.items th + th { border-left-color:#2C378A; }
table.items tr:last-child td { border-bottom:none; }
table.items th.r, table.mini th.r { text-align:right; } table.items th.c { text-align:center; }
.r { text-align:right; white-space:nowrap; } .c { text-align:center; }
.desc small { display:block; color:var(--muted); font-size:11px; }
.summary { display:flex; gap:12px; margin-top:12px; align-items:flex-start; }
.words { flex:1; border:1.5px solid var(--gold); background:var(--gold-l); border-radius:var(--r); padding:10px 14px; }
.words .label { margin-bottom:3px; }
.totals { --px:14px; width:300px; border:1.5px solid var(--navy); border-top:5px solid var(--gold); border-radius:var(--r); padding:8px var(--px) 10px; background:#fff; }
.totals .kv { padding:4px 0; }
.totals .grand { background:var(--navy); color:#fff; margin:6px calc(var(--px) * -1); padding:8px var(--px); font-size:15px; border-bottom:none; }
.totals .grand span:first-child, .totals .grand span:last-child { color:#fff; font-weight:800; }
.due span:last-child { color:var(--red); } .clear span:last-child { color:var(--green); }
.section { margin-top:14px; }
table.mini { width:100%; border-collapse:separate; border-spacing:0; border:1.5px solid var(--navy); border-radius:var(--r); overflow:hidden; }
table.mini th { text-align:left; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:var(--navy); background:var(--soft); padding:7px 9px; border-bottom:1.5px solid var(--navy); }
table.mini td { padding:7px 9px; border-bottom:1px solid var(--line-s); }
table.mini tr:last-child td { border-bottom:none; }
.foot { display:flex; justify-content:space-between; align-items:flex-end; gap:20px; margin-top:20px; }
.terms { flex:1; color:var(--muted); font-size:10.5px; }
.terms b { color:var(--ink); }
.sign { width:220px; text-align:center; }
.sign .line { border-top:1.5px solid var(--ink); margin-top:44px; padding-top:5px; font-size:11px; color:var(--muted); }
.sign .for { font-weight:800; font-size:12px; }
.thanks { margin-top:16px; text-align:center; padding:10px; border-radius:var(--r); background:var(--navy); color:#fff; font-size:12px; letter-spacing:.4px; border-top:3px solid var(--gold); }
.thanks b { color:#E5C67F; }
.small { font-size:10px; color:var(--muted); text-align:center; margin-top:6px; }
.stamp { position:absolute; right:26px; top:150px; transform:rotate(-14deg); border:3px solid; border-radius:var(--r); padding:4px 14px; font-size:22px; font-weight:900; letter-spacing:4px; opacity:.9; z-index:2; background:rgba(255,255,255,.6); }
.stamp.inline { position:static; display:inline-block; margin:14px 0 4px 8px; transform:rotate(-8deg); }
.stamp.PAID { color:var(--green); border-color:var(--green); }
.stamp.DRAFT { color:#475569; border-color:#475569; }
.stamp.CANCELLED { color:var(--red); border-color:var(--red); }
.amount-hero { text-align:center; margin-top:16px; padding:16px; border-radius:var(--r); background:#fff; border:1.5px solid var(--navy); border-top:5px solid var(--gold); }
.amount-hero .amt { font-size:34px; font-weight:800; color:var(--navy); letter-spacing:.5px; }
.amount-hero .ok { color:var(--green); font-weight:800; letter-spacing:1.5px; font-size:11px; margin-top:2px; }
.print { position:fixed; right:18px; bottom:18px; background:var(--navy); color:#fff; border:0; border-radius:var(--r); padding:10px 18px; font-weight:700; cursor:pointer; box-shadow:0 4px 12px rgba(10,16,51,.3); }
.closing { break-inside:avoid; page-break-inside:avoid; }
table.items tr, .totals, .words, .card { break-inside:avoid; page-break-inside:avoid; }
@media print {
  .print { display:none; } .page { max-width:none; }
  body { font-size:11.5px; }
  .band { padding:14px 18px; } .brand img { width:64px; height:64px; }
  .grid2, table.items, .summary, .section { margin-top:10px; }
  table.items td, table.items th { padding:7px 9px; }
  .card { --px:12px; --py:10px; } .totals { --px:12px; padding-top:6px; padding-bottom:8px; }
  .foot { margin-top:14px; } .sign .line { margin-top:30px; } .thanks { margin-top:12px; padding:8px; }
}
`;

function header(clinic: Clinic, title: string, number: string, dateLine: string) {
  const contact = [
    `${esc(clinic.address)}, ${esc(clinic.city)}, ${esc(clinic.state)} – ${esc(clinic.pincode)}`,
    clinic.phone ? `<span>☎ <b>${esc(clinic.phone)}</b></span>` : "",
    clinic.email ? `<span>✉ <b>${esc(clinic.email)}</b></span>` : "",
    clinic.gstin ? `<span>GSTIN <b>${esc(clinic.gstin)}</b></span>` : "",
  ].filter(Boolean);
  return `
  <div class="band">
    <div class="brand">
      <img src="${LOGO_DATA_URI}" alt="Movement Hub">
      <div><div class="name">MOVEMENT HUB</div><div class="tag">PHYSIOTHERAPY &amp; REHAB</div></div>
    </div>
    <div class="doc"><div class="title">${esc(title)}</div><div class="no">${esc(number)}</div><div class="date">${dateLine}</div></div>
  </div>
  <div class="clinic">${contact.map((c) => `<span>${c}</span>`).join("")}</div>`;
}

function shell(title: string, body: string, stamp?: string | null) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><div class="page">
<img class="watermark" src="${LOGO_DATA_URI}" alt="">
${stamp ? `<div class="stamp ${esc(stamp)}">${esc(stamp)}</div>` : ""}
<div class="content">${body}</div></div>
<button class="print" onclick="print()">Print / Save as PDF</button></body></html>`;
}

const thanks = `<div class="thanks">Thank you for choosing <b>Movement Hub</b> — wishing you a speedy recovery!</div>`;

/* ─────────────── tax invoice ─────────────── */

export interface InvoiceDoc {
  invoiceNo: string;
  status: string;
  issuedAt: Date | null;
  createdAt: Date;
  dueDate: Date | null;
  subtotal: unknown;
  discountAmount: unknown;
  discountReason: string | null;
  taxableAmount: unknown;
  gstPercent: unknown;
  cgstAmount: unknown;
  sgstAmount: unknown;
  igstAmount: unknown;
  totalAmount: unknown;
  paidAmount: unknown;
  dueAmount: unknown;
  notes: string | null;
  branch: Clinic;
  therapist: { user: { name: string } } | null;
  patient: { firstName: string; lastName: string | null; patientCode: string; phone: string; email: string | null; addresses: { line1: string; line2?: string | null; city: string; pincode: string }[] };
  items: { description: string; type: string; quantity: number; unitPrice: unknown; discount: unknown; amount: unknown }[];
  payments: { receiptNo: string; method: string; amount: unknown; status: string; paidAt: Date | null; referenceNo: string | null }[];
}

export function renderInvoiceHtml(inv: InvoiceDoc) {
  const addr = inv.patient.addresses[0];
  const half = Number(inv.gstPercent) / 2;
  const hasTax = Number(inv.gstPercent) > 0;
  const stamp = inv.status === "PAID" ? "PAID" : inv.status === "DRAFT" ? "DRAFT" : inv.status === "CANCELLED" ? "CANCELLED" : null;
  const rows = inv.items
    .map(
      (i, n) => `<tr><td class="c">${n + 1}</td><td class="desc">${esc(i.description)}<small>${esc(titleCase(i.type))}</small></td>
      <td class="c">${i.quantity}</td><td class="r">${money(i.unitPrice)}</td><td class="r">${Number(i.discount) > 0 ? `−${money(i.discount)}` : "—"}</td><td class="r"><b>${money(i.amount)}</b></td></tr>`,
    )
    .join("");
  const paid = inv.payments.filter((p) => ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status));
  const due = Number(inv.dueAmount);

  const body = `
  ${header(inv.branch, inv.status === "DRAFT" ? "DRAFT INVOICE" : "TAX INVOICE", inv.invoiceNo, inv.issuedAt ? `Issued ${fmtDate(inv.issuedAt)}` : `Created ${fmtDate(inv.createdAt)}`)}
  <div class="grid2">
    <div class="card">
      <div class="label">Billed to</div>
      <div class="big">${esc(inv.patient.firstName)} ${esc(inv.patient.lastName ?? "")}</div>
      <div class="muted">Patient ID ${esc(inv.patient.patientCode)}</div>
      <div>${esc(inv.patient.phone)}${inv.patient.email ? ` · ${esc(inv.patient.email)}` : ""}</div>
      ${addr ? `<div class="muted">${esc(addr.line1)}${addr.line2 ? `, ${esc(addr.line2)}` : ""}, ${esc(addr.city)} ${esc(addr.pincode)}</div>` : ""}
    </div>
    <div class="card">
      <div class="label">Invoice details</div>
      <div class="kv"><span>Invoice no.</span><span>${esc(inv.invoiceNo)}</span></div>
      <div class="kv"><span>Invoice date</span><span>${fmtDate(inv.issuedAt ?? inv.createdAt)}</span></div>
      ${inv.dueDate ? `<div class="kv"><span>Due date</span><span>${fmtDate(inv.dueDate)}</span></div>` : ""}
      ${inv.therapist ? `<div class="kv"><span>Physiotherapist</span><span>${esc(inv.therapist.user.name)}</span></div>` : ""}
      <div class="kv"><span>Status</span><span><span class="pill ${esc(inv.status)}">${esc(titleCase(inv.status))}</span></span></div>
    </div>
  </div>

  <table class="items">
    <thead><tr><th class="c" style="width:34px">#</th><th>Description</th><th class="c" style="width:44px">Qty</th><th class="r">Rate</th><th class="r">Discount</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="summary">
    <div class="words">
      <div class="label">Amount in words</div>
      <div><b>${esc(amountInWords(inv.totalAmount))}</b></div>
      ${inv.discountReason && Number(inv.discountAmount) > 0 ? `<div class="muted" style="margin-top:6px">Discount: ${esc(inv.discountReason)}</div>` : ""}
      ${inv.notes ? `<div class="muted" style="margin-top:6px">${esc(inv.notes).replace(/\n/g, "<br>")}</div>` : ""}
      ${stamp ? `<div class="stamp inline ${esc(stamp)}">${esc(stamp)}</div>` : ""}
    </div>
    <div class="totals">
      <div class="kv"><span>Subtotal</span><span>${money(inv.subtotal)}</span></div>
      ${Number(inv.discountAmount) > 0 ? `<div class="kv"><span>Discount</span><span>−${money(inv.discountAmount)}</span></div>` : ""}
      ${hasTax ? `<div class="kv"><span>Taxable value</span><span>${money(inv.taxableAmount)}</span></div>` : ""}
      ${hasTax ? (Number(inv.igstAmount) > 0 ? `<div class="kv"><span>IGST @ ${Number(inv.gstPercent)}%</span><span>${money(inv.igstAmount)}</span></div>` : `<div class="kv"><span>CGST @ ${half}%</span><span>${money(inv.cgstAmount)}</span></div><div class="kv"><span>SGST @ ${half}%</span><span>${money(inv.sgstAmount)}</span></div>`) : ""}
      <div class="kv grand"><span>Total</span><span>${money(inv.totalAmount)}</span></div>
      <div class="kv"><span>Paid</span><span>${money(inv.paidAmount)}</span></div>
      <div class="kv ${due > 0 ? "due" : "clear"}"><span><b>${due > 0 ? "Balance due" : "Balance"}</b></span><span>${due > 0 ? money(due) : "Paid in full"}</span></div>
    </div>
  </div>

  ${paid.length ? `<div class="section"><div class="label">Payments received</div><table class="mini"><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>
    ${paid.map((p) => `<tr><td>${esc(p.receiptNo)}</td><td>${fmtDateTime(p.paidAt)}</td><td>${esc(methodName(p.method))}${p.referenceNo ? ` · ${esc(p.referenceNo)}` : ""}</td><td class="r">${money(p.amount)}</td></tr>`).join("")}
  </tbody></table></div>` : ""}

  <div class="closing">
  <div class="foot">
    <div class="terms"><b>Terms</b><br>Payment is due on receipt unless a due date is shown. Package sessions are valid until the package expiry date and are non-transferable. Please keep this invoice for your records.</div>
    <div class="sign"><div class="for">For Movement Hub</div><div class="line">Authorised signatory</div></div>
  </div>
  ${thanks}
  <div class="small">This is a computer-generated ${hasTax ? "tax " : ""}invoice.</div>
  </div>`;
  // The invoice's stamp sits in the "amount in words" box (never over the details); see .stamp.inline.
  return shell(inv.invoiceNo, body, null);
}

/* ─────────────── payment receipt ─────────────── */

export interface ReceiptDoc {
  receiptNo: string;
  amount: unknown;
  method: string;
  referenceNo: string | null;
  status: string;
  paidAt: Date | null;
  receivedBy: string | null;
  refunded: number;
  invoice: {
    invoiceNo: string;
    totalAmount: unknown;
    paidAmount: unknown;
    dueAmount: unknown;
    branch: Clinic;
    therapist: { user: { name: string } } | null;
    patient: { firstName: string; lastName: string | null; patientCode: string; phone: string };
  };
}

export function renderReceiptHtml(r: ReceiptDoc) {
  const inv = r.invoice;
  const due = Number(inv.dueAmount);
  const body = `
  ${header(inv.branch, "PAYMENT RECEIPT", r.receiptNo, fmtDateTime(r.paidAt))}
  <div class="amount-hero">
    <div class="label" style="margin-bottom:2px">Amount received</div>
    <div class="amt">${money(r.amount)}</div>
    <div class="muted">${esc(amountInWords(r.amount))}</div>
    <div class="ok">✓ PAYMENT ${r.status === "SUCCESS" ? "SUCCESSFUL" : esc(titleCase(r.status).toUpperCase())}</div>
  </div>
  <div class="grid2">
    <div class="card">
      <div class="label">Received from</div>
      <div class="big">${esc(inv.patient.firstName)} ${esc(inv.patient.lastName ?? "")}</div>
      <div class="muted">Patient ID ${esc(inv.patient.patientCode)}</div>
      <div>${esc(inv.patient.phone)}</div>
    </div>
    <div class="card">
      <div class="label">Payment details</div>
      <div class="kv"><span>Receipt no.</span><span>${esc(r.receiptNo)}</span></div>
      <div class="kv"><span>Date &amp; time</span><span>${fmtDateTime(r.paidAt)}</span></div>
      <div class="kv"><span>Method</span><span>${esc(methodName(r.method))}</span></div>
      ${r.referenceNo ? `<div class="kv"><span>Reference</span><span>${esc(r.referenceNo)}</span></div>` : ""}
      <div class="kv"><span>Against invoice</span><span>${esc(inv.invoiceNo)}</span></div>
      ${inv.therapist ? `<div class="kv"><span>Physiotherapist</span><span>${esc(inv.therapist.user.name)}</span></div>` : ""}
      ${r.receivedBy ? `<div class="kv"><span>Received by</span><span>${esc(r.receivedBy)}</span></div>` : ""}
    </div>
  </div>
  <div class="summary">
    <div class="words"><div class="label">Note</div><div>This receipt confirms payment towards invoice <b>${esc(inv.invoiceNo)}</b>.${r.refunded > 0 ? ` ${money(r.refunded)} of this payment has been refunded.` : ""}</div></div>
    <div class="totals">
      <div class="kv"><span>Invoice total</span><span>${money(inv.totalAmount)}</span></div>
      <div class="kv"><span>Paid to date</span><span>${money(inv.paidAmount)}</span></div>
      <div class="kv grand ${due > 0 ? "due" : "clear"}"><span>${due > 0 ? "Balance due" : "Balance"}</span><span>${due > 0 ? money(due) : "Paid in full"}</span></div>
    </div>
  </div>
  <div class="closing">
  <div class="foot">
    <div class="terms"><b>Thank you!</b><br>Please keep this receipt for your records. For any billing questions, contact the clinic${inv.branch.phone ? ` on ${esc(inv.branch.phone)}` : ""}.</div>
    <div class="sign"><div class="for">For Movement Hub</div><div class="line">Authorised signatory</div></div>
  </div>
  ${thanks}
  <div class="small">This is a computer-generated receipt.</div>
  </div>`;
  return shell(r.receiptNo, body, r.status === "SUCCESS" || r.status === "PARTIALLY_REFUNDED" ? "PAID" : null);
}
