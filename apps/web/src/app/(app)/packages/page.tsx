"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Empty, ErrorText, Field, Modal, PageHeader, Pager, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { date, fullName, inr, label } from "@/lib/format";
import type { PackageDef, PatientPackage } from "@/lib/types";
import { refresh } from "@/lib/invalidate";

export default function PackagesPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isPatient = user?.role === "PATIENT";
  const isAdmin = hasRole(user, "ADMIN");
  const [editing, setEditing] = useState<Partial<PackageDef> | null>(null);
  const [status, setStatus] = useState("ACTIVE");
  const [page, setPage] = useState(1);

  const catalogue = useQuery({ queryKey: ["packages", isAdmin], queryFn: () => api.get<PackageDef[]>("/packages", { includeInactive: isAdmin || undefined }) });
  const sold = useQuery({ queryKey: ["patient-packages", status, page], queryFn: () => api.page<PatientPackage>("/patient-packages", { status: status || undefined, page }) });

  const buy = useMutation({
    mutationFn: (packageId: string) => api.post("/patient-packages", { packageId }),
    onSuccess: () => { refresh(qc, "packageSale"); alert("Package added. Pay the invoice from Billing to confirm."); },
  });

  return (
    <>
      <PageHeader title="Treatment packages" actions={isAdmin && <button className="btn-primary" onClick={() => setEditing({ tier: "CUSTOM", sessionCount: 10, validityDays: 60, price: "0", includesHomeVisit: false })}>New package</button>} />
      <ErrorText error={buy.error} />
      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {catalogue.data?.map((p) => (
          <div key={p.id} className={`card flex flex-col ${p.tier === "PREMIUM" ? "border-gold-500 ring-2 ring-gold-100" : ""} ${!p.isActive ? "opacity-50" : ""}`}>
            <div className="text-xs font-bold uppercase tracking-widest text-gold-700">{label(p.tier)}</div>
            <h3 className="mt-1 text-lg font-bold">{p.name}</h3>
            <div className="my-3 text-3xl font-bold text-navy-700">{inr(p.price)}</div>
            <ul className="flex-1 space-y-1 text-sm">
              <li className="flex gap-2"><Check size={16} className="text-gold-500" /> {p.sessionCount} sessions</li>
              <li className="flex gap-2"><Check size={16} className="text-gold-500" /> Valid {p.validityDays} days</li>
              <li className="flex gap-2"><Check size={16} className="text-gold-500" /> {inr(Number(p.price) / p.sessionCount)} per session</li>
              {p.includesHomeVisit && <li className="flex gap-2"><Check size={16} className="text-gold-500" /> Home visits included</li>}
            </ul>
            {p.description && <p className="mt-2 text-xs text-navy-500">{p.description}</p>}
            {isPatient && <button className="btn-gold mt-4" disabled={buy.isPending} onClick={() => buy.mutate(p.id)}>Buy package</button>}
            {isAdmin && <button className="btn-ghost mt-4" onClick={() => setEditing(p)}>Edit</button>}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold">{isPatient ? "My packages" : "Patient packages"}</h2>
          <select className="input max-w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {["", "ACTIVE", "EXHAUSTED", "EXPIRED", "CANCELLED"].map((s) => <option key={s} value={s}>{s ? label(s) : "All"}</option>)}
          </select>
        </div>
        {sold.isLoading ? <Spinner /> : !sold.data?.data.length ? <Empty>No packages.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>{!isPatient && <th>Patient</th>}<th>Package</th><th>Used</th><th>Remaining</th><th>Valid until</th><th>Paid</th><th>Status</th></tr></thead>
              <tbody>
                {sold.data.data.map((p) => (
                  <tr key={p.id}>
                    {!isPatient && <td>{fullName(p.patient)}<div className="text-xs text-navy-500">{p.patient.patientCode}</div></td>}
                    <td>{p.package.name}</td>
                    <td>{p.usedSessions}/{p.totalSessions}</td>
                    <td className="font-bold">{p.remainingSessions}</td>
                    <td>{date(p.expiryDate)}</td>
                    <td>{inr(p.pricePaid)}</td>
                    <td><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sold.data && <Pager page={page} totalPages={sold.data.meta.totalPages} onChange={setPage} />}
      </div>
      {editing && <PackageEditor pkg={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PackageEditor({ pkg, onClose }: { pkg: Partial<PackageDef>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: pkg.name ?? "", tier: pkg.tier ?? "CUSTOM", description: pkg.description ?? "", sessionCount: pkg.sessionCount ?? 10, validityDays: pkg.validityDays ?? 60, price: Number(pkg.price ?? 0), includesHomeVisit: pkg.includesHomeVisit ?? false, isActive: pkg.isActive ?? true });
  const save = useMutation({
    mutationFn: async () => {
      const { isActive, ...body } = f;
      const data = { ...body, description: body.description || undefined };
      if (pkg.id) {
        await api.patch(`/packages/${pkg.id}`, data);
        if (isActive !== pkg.isActive) await api.patch(`/packages/${pkg.id}/status`, { isActive });
      } else await api.post("/packages", data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["packages"] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={pkg.id ? "Edit package" : "New package"}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
        <Field label="Tier"><select className="input" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}>{["BASIC", "STANDARD", "PREMIUM", "CUSTOM"].map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Price (₹)"><input className="input" type="number" value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} /></Field>
        <Field label="Sessions"><input className="input" type="number" value={f.sessionCount} onChange={(e) => setF({ ...f, sessionCount: Number(e.target.value) })} /></Field>
        <Field label="Validity (days)"><input className="input" type="number" value={f.validityDays} onChange={(e) => setF({ ...f, validityDays: Number(e.target.value) })} /></Field>
        <div className="col-span-2"><Field label="Description"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.includesHomeVisit} onChange={(e) => setF({ ...f, includesHomeVisit: e.target.checked })} /> Includes home visits</label>
        {pkg.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Offered for sale</label>}
        <div className="col-span-2"><ErrorText error={save.error} /></div>
        <div className="col-span-2 flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!f.name || save.isPending} onClick={() => save.mutate()}>Save</button></div>
      </div>
    </Modal>
  );
}
