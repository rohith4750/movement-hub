"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2 } from "lucide-react";
import { Empty, ErrorText, Field, Modal, PageHeader, Pager, Spinner, StatusBadge } from "@/components/ui";
import { api, openDocument } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { date, dateTime, fullName, inr, label } from "@/lib/format";
import type { Invoice, Patient } from "@/lib/types";

declare global {
  interface Window {
    Razorpay?: new (o: Record<string, unknown>) => { open: () => void };
  }
}

interface InvoiceDetail extends Invoice {
  subtotal: string; discountAmount: string; taxableAmount: string; gstPercent: string; cgstAmount: string; sgstAmount: string; igstAmount: string;
  items: { id: string; description: string; quantity: number; unitPrice: string; amount: string }[];
  payments: { id: string; receiptNo: string; method: string; amount: string; status: string; paidAt: string | null }[];
}

export default function BillingPage() {
  const user = useAuth((s) => s.user);
  const isPatient = user?.role === "PATIENT";
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["invoices", status, search, page], queryFn: () => api.page<Invoice>("/invoices", { status: status || undefined, search, page }) });

  return (
    <>
      <PageHeader title={isPatient ? "My bills" : "Billing & payments"} actions={hasRole(user, "ACCOUNTANT", "RECEPTIONIST") && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New invoice</button>} />
      <div className="card">
        <div className="mb-4 flex flex-wrap gap-3">
          {!isPatient && <input className="input max-w-xs" placeholder="Invoice no. or patient" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />}
          <select className="input max-w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {["", "DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED", "REFUNDED"].map((s) => <option key={s} value={s}>{s ? label(s) : "All statuses"}</option>)}
          </select>
        </div>
        {q.isLoading ? <Spinner /> : !q.data?.data.length ? <Empty>No invoices.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Invoice</th>{!isPatient && <th>Patient</th>}<th>Date</th><th className="text-right">Total</th><th className="text-right">Paid</th><th className="text-right">Due</th><th>Status</th><th /></tr></thead>
              <tbody>
                {q.data.data.map((i) => (
                  <tr key={i.id}>
                    <td className="font-mono text-xs">{i.invoiceNo}</td>
                    {!isPatient && <td>{fullName(i.patient)}</td>}
                    <td>{date(i.issuedAt ?? i.createdAt)}</td>
                    <td className="text-right">{inr(i.totalAmount)}</td>
                    <td className="text-right">{inr(i.paidAmount)}</td>
                    <td className="text-right font-bold">{inr(i.dueAmount)}</td>
                    <td><StatusBadge status={i.status} /></td>
                    <td><button className="btn-ghost px-3 py-1 text-xs" onClick={() => setOpenId(i.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.data && <Pager page={page} totalPages={q.data.meta.totalPages} onChange={setPage} />}
      </div>
      {openId && <InvoiceModal id={openId} onClose={() => setOpenId(null)} />}
      {creating && <NewInvoice onClose={() => setCreating(false)} />}
    </>
  );
}

function loadRazorpay() {
  return new Promise<boolean>((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = Object.assign(document.createElement("script"), { src: "https://checkout.razorpay.com/v1/checkout.js", onload: () => resolve(true), onerror: () => resolve(false) });
    document.body.appendChild(s);
  });
}

function InvoiceModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [method, setMethod] = useState("UPI");
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const q = useQuery({ queryKey: ["invoice", id], queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`) });
  const refresh = () => qc.invalidateQueries();

  const pay = useMutation({ mutationFn: () => api.post("/payments", { invoiceId: id, method, amount: Number(amount || q.data?.dueAmount), referenceNo: ref || undefined }), onSuccess: refresh });
  const issue = useMutation({ mutationFn: () => api.post(`/invoices/${id}/issue`), onSuccess: refresh });
  const online = useMutation({
    mutationFn: async () => {
      if (!(await loadRazorpay())) throw new Error("Could not load Razorpay checkout");
      const order = await api.post<{ orderId: string; amount: number; currency: string; keyId: string }>("/payments/razorpay/order", { invoiceId: id });
      await new Promise<void>((resolve, reject) => {
        const rz = new window.Razorpay!({
          key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.orderId,
          name: "Movement Hub", description: q.data?.invoiceNo, image: "/brand/movement-hub-logo.jpg", theme: { color: "#1b2160" },
          handler: (r: Record<string, string>) => api.post("/payments/razorpay/verify", r).then(() => resolve(), reject),
          modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
        });
        rz.open();
      });
    },
    onSuccess: refresh,
  });

  if (!q.data) return <Modal open onClose={onClose} title="Invoice"><Spinner /></Modal>;
  const inv = q.data;
  const payable = ["ISSUED", "PARTIALLY_PAID"].includes(inv.status);

  return (
    <Modal open onClose={onClose} title={inv.invoiceNo} wide>
      <div className="space-y-4 text-sm">
        <div className="flex items-center justify-between"><StatusBadge status={inv.status} /><button className="btn-ghost" onClick={() => openDocument(`/invoices/${id}/pdf`)}><FileText size={14} /> Print / PDF</button></div>
        <div className="table-wrap-sm"><table className="table">
          <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{inv.items.map((i) => <tr key={i.id}><td>{i.description}</td><td className="text-right">{i.quantity}</td><td className="text-right">{inr(i.unitPrice)}</td><td className="text-right">{inr(i.amount)}</td></tr>)}</tbody>
        </table></div>
        <div className="ml-auto w-72 space-y-1">
          <div className="flex justify-between"><span>Subtotal</span><span>{inr(inv.subtotal)}</span></div>
          {Number(inv.discountAmount) > 0 && <div className="flex justify-between"><span>Discount</span><span>-{inr(inv.discountAmount)}</span></div>}
          {Number(inv.igstAmount) > 0 ? <div className="flex justify-between"><span>IGST {inv.gstPercent}%</span><span>{inr(inv.igstAmount)}</span></div> : (
            <><div className="flex justify-between"><span>CGST</span><span>{inr(inv.cgstAmount)}</span></div><div className="flex justify-between"><span>SGST</span><span>{inr(inv.sgstAmount)}</span></div></>
          )}
          <div className="flex justify-between border-t border-navy-100 pt-1 font-bold"><span>Total</span><span>{inr(inv.totalAmount)}</span></div>
          <div className="flex justify-between"><span>Balance due</span><span className="font-bold text-gold-700">{inr(inv.dueAmount)}</span></div>
        </div>

        {inv.payments.length > 0 && (
          <div>
            <h3 className="mb-1 font-bold">Payments</h3>
            {inv.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b border-navy-50 py-1">
                <span>{p.receiptNo} · {p.method} · {dateTime(p.paidAt)}</span>
                <span className="flex items-center gap-2">{inr(p.amount)} <StatusBadge status={p.status} />{p.status === "SUCCESS" && <button className="text-xs underline" onClick={() => openDocument(`/payments/${p.id}/receipt`)}>Receipt</button>}</span>
              </div>
            ))}
          </div>
        )}

        {inv.status === "DRAFT" && hasRole(user, "ACCOUNTANT", "RECEPTIONIST") && <button className="btn-primary" onClick={() => issue.mutate()}>Issue invoice</button>}

        {payable && hasRole(user, "ACCOUNTANT", "RECEPTIONIST") && (
          <div className="rounded-lg bg-navy-50 p-3">
            <h3 className="mb-2 font-bold">Record payment</h3>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Method"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{["CASH", "UPI", "CARD", "NET_BANKING"].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></Field>
              <Field label="Amount"><input className="input" type="number" placeholder={inv.dueAmount} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Reference"><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
            </div>
            <ErrorText error={pay.error} />
            <button className="btn-primary mt-2" disabled={pay.isPending} onClick={() => pay.mutate()}>Record payment</button>
          </div>
        )}
        {payable && (
          <>
            <ErrorText error={online.error} />
            <button className="btn-gold" disabled={online.isPending} onClick={() => online.mutate()}>Pay {inr(inv.dueAmount)} online</button>
          </>
        )}
      </div>
    </Modal>
  );
}

type Line = { type: string; description: string; quantity: number; unitPrice: number };

function NewInvoice({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ type: "CONSULTATION", description: "Initial consultation", quantity: 1, unitPrice: 500 }]);
  const [discount, setDiscount] = useState(0);
  const patients = useQuery({ queryKey: ["patients", "inv", search], queryFn: () => api.page<Patient>("/patients", { search, limit: 6 }) });
  const preview = useQuery({
    queryKey: ["invoice-preview", patientId, lines, discount],
    queryFn: () => api.post<{ totalAmount: string; taxableAmount: string }>("/invoices/preview", { patientId, items: lines, discountAmount: discount }),
    enabled: !!patientId && lines.every((l) => l.description),
  });
  const save = useMutation({
    mutationFn: (issue: boolean) => api.post("/invoices", { patientId, items: lines, discountAmount: discount, issue }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoices"] }); onClose(); },
  });

  return (
    <Modal open onClose={onClose} title="New invoice" wide>
      <div className="space-y-4">
        <Field label="Patient">
          <input className="input" placeholder="Search patient" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">
            {patients.data?.data.map((p) => <button key={p.id} onClick={() => setPatientId(p.id)} className={`rounded-lg border px-3 py-1 text-sm ${patientId === p.id ? "border-gold-500 bg-gold-100" : "border-navy-100"}`}>{fullName(p)}</button>)}
          </div>
        </Field>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <select className="input col-span-3" value={l.type} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
              {["CONSULTATION", "THERAPY_SESSION", "PACKAGE", "HOME_VISIT", "TRAVEL_CHARGE", "OTHER"].map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
            <input className="input col-span-5" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <input className="input col-span-1" type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
            <input className="input col-span-2" type="number" min={0} value={l.unitPrice} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: Number(e.target.value) } : x)))} />
            <button className="btn-ghost col-span-1" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="text-sm font-semibold text-gold-700" onClick={() => setLines([...lines, { type: "THERAPY_SESSION", description: "Therapy session", quantity: 1, unitPrice: 800 }])}>+ Add line</button>
        <div className="flex items-end justify-between">
          <Field label="Discount (₹)"><input className="input w-40" type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></Field>
          {preview.data && <div className="text-right"><div className="text-xs text-navy-500">Taxable {inr(preview.data.taxableAmount)} + GST</div><div className="text-xl font-bold">{inr(preview.data.totalAmount)}</div></div>}
        </div>
        <ErrorText error={save.error ?? preview.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" disabled={!patientId || save.isPending} onClick={() => save.mutate(false)}>Save draft</button>
          <button className="btn-primary" disabled={!patientId || save.isPending} onClick={() => save.mutate(true)}>Issue invoice</button>
        </div>
      </div>
    </Modal>
  );
}
