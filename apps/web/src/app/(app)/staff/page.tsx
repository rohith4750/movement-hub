"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Smartphone, Trash2 } from "lucide-react";
import { PinBadge, PinFields, pinProblem, SetPinModal } from "@/components/pin";
import { ConfirmDelete, Empty, ErrorText, Field, Modal, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { dateTime, label } from "@/lib/format";

interface Staff { id: string; name: string; email: string; phone: string; role: string; isActive: boolean; lastLoginAt: string | null; hasPin: boolean }

export default function StaffPage() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const isSuper = hasRole(me, "SUPER_ADMIN") && me?.role === "SUPER_ADMIN";
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Staff | null>(null);
  const [pinFor, setPinFor] = useState<Staff | null>(null);
  const q = useQuery({ queryKey: ["users"], queryFn: () => api.page<Staff>("/users", { limit: 100 }) });
  const remove = useMutation({
    mutationFn: (u: Staff) => api.del(`/users/${u.id}`),
    onSuccess: () => { qc.invalidateQueries(); setDeleting(null); },
  });

  const withoutPin = q.data?.data.filter((u) => !u.hasPin).length ?? 0;

  return (
    <>
      <PageHeader
        title="Staff accounts"
        subtitle="Web portal: email/phone + password · Mobile app: personal 6-digit PIN"
        actions={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Add Super Admin</button>}
      />
      {withoutPin > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <Smartphone size={16} /> {withoutPin} staff member{withoutPin > 1 ? "s" : ""} can&apos;t use the mobile app yet. Use <b>Set PIN</b> to give them access.
        </div>
      )}
      <div className="card">
        {q.isLoading ? <Spinner /> : !q.data?.data.length ? <Empty>No staff.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th>Mobile app</th><th>Last login</th><th /></tr></thead>
            <tbody>
              {q.data.data.map((u) => {
                const canPin = u.role !== "SUPER_ADMIN" || isSuper;
                return (
                  <tr key={u.id}>
                    <td className="font-semibold">{u.name}{u.id === me?.id && <span className="ml-2 text-xs font-normal text-navy-500">(you)</span>}</td>
                    <td>{label(u.role)}</td><td>{u.email}</td><td>{u.phone}</td>
                    <td><PinBadge hasPin={u.hasPin} /></td>
                    <td>{dateTime(u.lastLoginAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {canPin && (
                          <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setPinFor(u)}>
                            <KeyRound size={14} /> {u.hasPin ? "Reset PIN" : "Set PIN"}
                          </button>
                        )}
                        {u.id !== me?.id && (
                          <button className="btn-ghost px-3 py-1 text-xs text-rose-600" onClick={() => { remove.reset(); setDeleting(u); }}>
                            <Trash2 size={14} /> Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
      {adding && <AddStaff onClose={() => setAdding(false)} />}
      <SetPinModal user={pinFor} onClose={() => setPinFor(null)} />
      <ConfirmDelete
        open={!!deleting}
        title={`Delete ${deleting?.name ?? ""}?`}
        message={<>This removes <b>{deleting?.name}</b> ({label(deleting?.role)}) from Movement Hub. They will be logged out of the web and the app and can no longer sign in. Their past records (appointments, consultations, invoices) are kept for history.</>}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        busy={remove.isPending}
        error={remove.error}
      />
    </>
  );
}

function AddStaff({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", email: "", phone: "", role: "SUPER_ADMIN", password: "" });
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const m = useMutation({ mutationFn: () => api.post("/users", { ...f, pin }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); onClose(); } });
  const invalid = !f.name.trim() || !f.email.trim() || !f.phone.trim() || f.password.length < 8 || !!pinProblem(pin, confirm);
  return (
    <Modal open onClose={onClose} title="Add Super Admin">
      <div className="space-y-3">
        <Field label="Name *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email *"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Mobile number *"><input className="input" inputMode="tel" placeholder="98765 43210" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-700">This creates a <b>Super Admin</b> (full access). Physiotherapists are added from the <b>Therapists</b> page so their schedule is set up.</p>

        <div className="rounded-lg border border-navy-100 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">Web portal sign-in</div>
          <Field label="Temporary password * (min 8 characters)"><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        </div>
        <div className="rounded-lg border border-gold-300 bg-gold-100/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gold-700"><Smartphone size={13} /> Mobile app sign-in</div>
          <PinFields pin={pin} confirm={confirm} onPin={setPin} onConfirm={setConfirm} />
        </div>

        <ErrorText error={m.error} />
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={invalid || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Creating…" : "Create"}</button></div>
      </div>
    </Modal>
  );
}
