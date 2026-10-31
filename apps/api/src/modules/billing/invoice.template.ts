import type { invoiceWithDetails } from "./billing.service.js";

type Invoice = Awaited<ReturnType<typeof invoiceWithDetails>>;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function renderInvoiceHtml(inv: Invoice) {
  const addr = inv.patient.addresses[0];
  const rows = inv.items
    .map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.description)}</td><td class="r">${i.quantity}</td><td class="r">${inr(i.unitPrice)}</td><td class="r">${inr(i.discount)}</td><td class="r">${inr(i.amount)}</td></tr>`)
    .join("");
  const tax = Number(inv.igstAmount) > 0
    ? `<tr><td>IGST (${inv.gstPercent}%)</td><td class="r">${inr(inv.igstAmount)}</td></tr>`
    : `<tr><td>CGST (${Number(inv.gstPercent) / 2}%)</td><td class="r">${inr(inv.cgstAmount)}</td></tr><tr><td>SGST (${Number(inv.gstPercent) / 2}%)</td><td class="r">${inr(inv.sgstAmount)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.invoiceNo)}</title>
<style>
body{font-family:system-ui,sans-serif;color:#0f1b4c;max-width:800px;margin:24px auto;padding:0 16px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #c9a14a;padding-bottom:12px}
h1{margin:0;font-size:22px}.muted{color:#555;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{padding:8px;border-bottom:1px solid #e5e5e5;text-align:left;font-size:14px}.r{text-align:right}
.totals{width:320px;margin-left:auto}.grand td{font-weight:700;border-top:2px solid #0f1b4c}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;background:#f3ead6;font-size:12px}
@media print{button{display:none}}
</style></head><body>
<header><div><img src="/brand/movement-hub-logo.jpg" alt="" height="64" onerror="this.remove()"><h1>${esc(inv.branch.name)}</h1>
<div class="muted">${esc(inv.branch.address)}, ${esc(inv.branch.city)}, ${esc(inv.branch.state)} ${esc(inv.branch.pincode)}<br>${inv.branch.gstin ? `GSTIN: ${esc(inv.branch.gstin)}` : ""}</div></div>
<div class="r"><h1>TAX INVOICE</h1><div>${esc(inv.invoiceNo)}</div><div class="muted">${inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString("en-IN") : "Draft"}</div><span class="badge">${esc(inv.status)}</span></div></header>
<p><strong>Bill to:</strong> ${esc(inv.patient.firstName)} ${esc(inv.patient.lastName)} (${esc(inv.patient.patientCode)})<br>
<span class="muted">${esc(inv.patient.phone)}${addr ? ` · ${esc(addr.line1)}, ${esc(addr.city)} ${esc(addr.pincode)}` : ""}</span></p>
<table><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Discount</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals"><tr><td>Subtotal</td><td class="r">${inr(inv.subtotal)}</td></tr>
${Number(inv.discountAmount) > 0 ? `<tr><td>Discount${inv.discountReason ? ` (${esc(inv.discountReason)})` : ""}</td><td class="r">-${inr(inv.discountAmount)}</td></tr>` : ""}
<tr><td>Taxable</td><td class="r">${inr(inv.taxableAmount)}</td></tr>${tax}
<tr class="grand"><td>Total</td><td class="r">${inr(inv.totalAmount)}</td></tr>
<tr><td>Paid</td><td class="r">${inr(inv.paidAmount)}</td></tr><tr><td><strong>Balance due</strong></td><td class="r"><strong>${inr(inv.dueAmount)}</strong></td></tr></table>
${inv.notes ? `<p class="muted">${esc(inv.notes)}</p>` : ""}
<p class="muted">Thank you for choosing Movement Hub – Physiotherapy &amp; Rehab.</p>
<button onclick="print()">Print / Save as PDF</button></body></html>`;
}
