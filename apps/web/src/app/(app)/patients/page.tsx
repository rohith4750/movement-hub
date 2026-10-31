"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarPlus, Trash2, UserPlus } from "lucide-react";
import { PatientForm } from "@/components/patient-form";
import { ConfirmDelete, Empty, ErrorText, Modal, PageHeader, Pager, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { date, fullName, label } from "@/lib/format";
import type { Patient } from "@/lib/types";

export default function PatientsPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canDelete = hasRole(user, "ADMIN");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Patient | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["patients", search, page], queryFn: () => api.page<Patient>("/patients", { search, page }) });
  const remove = useMutation({
    mutationFn: (p: Patient) => api.del(`/patients/${p.id}`),
    onSuccess: () => { qc.invalidateQueries(); setDeleting(null); },
  });

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle={data ? `${data.meta.total} registered patients` : undefined}
        actions={hasRole(user, "ADMIN", "RECEPTIONIST") && <button className="btn-primary" onClick={() => setOpen(true)}><UserPlus size={16} /> Add patient</button>}
      />
      <div className="card">
        <input className="input mb-4 max-w-sm" placeholder="Search name, phone or code…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        {isLoading ? <Spinner /> : error ? <ErrorText error={error} /> : !data?.data.length ? <Empty>No patients found.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Code</th><th>Name</th><th>Gender</th><th>Phone</th><th>Active plan</th><th>Package</th><th>Registered</th><th /></tr></thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id} className="hover:bg-navy-50/50">
                    <td className="font-mono text-xs">{p.patientCode}</td>
                    <td><Link href={`/patients/${p.id}`} className="font-semibold text-navy-700 hover:underline">{fullName(p)}</Link></td>
                    <td>{label(p.gender)}</td>
                    <td>{p.phone}</td>
                    <td>{p.treatmentPlans?.[0]?.title ?? "—"}</td>
                    <td>{p.packages?.[0] ? `${p.packages[0].remainingSessions} left` : "—"}</td>
                    <td>{date(p.createdAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {hasRole(user, "ADMIN", "RECEPTIONIST") && (
                          <Link href={`/appointments/book?patientId=${p.id}`} className="btn-ghost px-2 py-1 text-xs" title="Book appointment"><CalendarPlus size={14} /></Link>
                        )}
                        {canDelete && (
                          <button className="btn-ghost px-2 py-1 text-xs text-rose-600" title="Delete patient" onClick={() => { remove.reset(); setDeleting(p); }}><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={page} totalPages={data.meta.totalPages} onChange={setPage} />}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add patient" wide>
        <PatientForm onCreated={() => setOpen(false)} onCancel={() => setOpen(false)} />
      </Modal>

      <ConfirmDelete
        open={!!deleting}
        title={`Delete ${deleting ? fullName(deleting) : ""}?`}
        message={
          <>
            <b>{deleting && fullName(deleting)}</b> ({deleting?.patientCode}) will be removed from the patient list and search, any active package is cancelled, and their app login stops working.
            Past consultations, sessions and invoices are kept for medical and tax records.
            <br /><br />Patients with upcoming appointments or unpaid invoices can&apos;t be deleted until those are cleared.
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        busy={remove.isPending}
        error={remove.error}
      />
    </>
  );
}
