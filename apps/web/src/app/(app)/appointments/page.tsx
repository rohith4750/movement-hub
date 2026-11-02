"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { ConfirmDelete, Empty, ErrorText, Field, Modal, PageHeader, Pager, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { date, fullName, label, time, today } from "@/lib/format";
import type { Appointment } from "@/lib/types";
import { refresh } from "@/lib/invalidate";

const STATUSES = ["", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"];

export default function AppointmentsPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isPatient = user?.role === "PATIENT";
  const [day, setDay] = useState(isPatient ? "" : today());
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);

  const list = useQuery({
    queryKey: ["appointments", day, status, page],
    queryFn: () => api.page<Appointment>("/appointments", { date: day || undefined, status: status || undefined, page, sort: isPatient ? "startAt:desc" : undefined }),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.patch(`/appointments/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appointments"] }),
  });

  const [deleting, setDeleting] = useState<Appointment | null>(null);
  const remove = useMutation({
    mutationFn: (a: Appointment) => api.del(`/appointments/${a.id}`),
    onSuccess: () => { refresh(qc, "appointments"); setDeleting(null); },
  });

  const canManage = hasRole(user, "RECEPTIONIST", "ADMIN");
  const isAdmin = hasRole(user, "ADMIN");

  return (
    <>
      <PageHeader
        title={isPatient ? "My appointments" : "Appointments"}
        actions={(canManage || isPatient) && <Link href="/appointments/book" className="btn-primary"><CalendarPlus size={16} /> Book appointment</Link>}
      />
      <div className="card">
        <div className="mb-4 flex flex-wrap gap-3">
          <input type="date" className="input max-w-44" value={day} onChange={(e) => { setDay(e.target.value); setPage(1); }} />
          {day && <button className="btn-ghost" onClick={() => setDay("")}>All dates</button>}
          <select className="input max-w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? label(s) : "All statuses"}</option>)}
          </select>
        </div>
        <ErrorText error={act.error} />
        {list.isLoading ? <Spinner /> : !list.data?.data.length ? <Empty>No appointments.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>No.</th>{!isPatient && <th>Patient</th>}<th>Therapist</th><th>Type</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {list.data.data.map((a) => {
                  const open = ["SCHEDULED", "CONFIRMED"].includes(a.status);
                  return (
                    <tr key={a.id}>
                      <td><div className="font-semibold">{time(a.startAt)}</div><div className="text-xs text-navy-500">{date(a.startAt)}</div></td>
                      <td className="font-mono text-xs">{a.appointmentNo}</td>
                      {!isPatient && <td><Link className="hover:underline" href={`/patients/${a.patient.id}`}>{fullName(a.patient)}</Link></td>}
                      <td><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: a.therapist.colorTag ?? "#c9a14a" }} />{a.therapist.user.name}</td>
                      <td>{label(a.type)}{a.therapySession?.sessionNumber ? ` #${a.therapySession.sessionNumber}` : ""}</td>
                      <td><StatusBadge status={a.status} /></td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-1">
                          {canManage && a.status === "SCHEDULED" && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act.mutate({ id: a.id, action: "confirm" })}>Confirm</button>}
                          {canManage && open && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act.mutate({ id: a.id, action: "check-in" })}>Check in</button>}
                          {hasRole(user, "PHYSIOTHERAPIST") && a.type.includes("CONSULTATION") && !a.consultation && !["CANCELLED", "NO_SHOW", "RESCHEDULED", "COMPLETED"].includes(a.status) && (
                            <Link href={`/consultations/new?appointmentId=${a.id}`} className="btn-gold px-2 py-1 text-xs">Consult</Link>
                          )}
                          {hasRole(user, "PHYSIOTHERAPIST") && a.therapySession && ["SCHEDULED", "IN_PROGRESS"].includes(a.therapySession.status) && (
                            <Link href={`/therapy-sessions?open=${a.therapySession.id}`} className="btn-gold px-2 py-1 text-xs">Session</Link>
                          )}
                          {hasRole(user, "PHYSIOTHERAPIST") && a.consultation && a.status === "IN_PROGRESS" && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act.mutate({ id: a.id, action: "complete" })}>Complete</button>}
                          {(canManage || isPatient) && open && <Link href={`/appointments/book?reschedule=${a.id}`} className="btn-ghost px-2 py-1 text-xs">Reschedule</Link>}
                          {(canManage || isPatient) && open && <button className="btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => setCancelling(a)}>Cancel</button>}
                          {canManage && open && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act.mutate({ id: a.id, action: "no-show" })}>No-show</button>}
                          {(canManage || hasRole(user, "PHYSIOTHERAPIST")) && (
                            <Link href={`/appointments/${a.id}`} className="btn-ghost px-2 py-1 text-xs" title="View / edit appointment"><Pencil size={14} /> Edit</Link>
                          )}
                          {(isAdmin || (canManage && !["COMPLETED", "IN_PROGRESS", "CHECKED_IN"].includes(a.status) && !a.consultation)) && (
                            <button className="btn-ghost border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50" title="Delete appointment" onClick={() => { remove.reset(); setDeleting(a); }}><Trash2 size={14} /> Delete</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pager page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />}
      </div>
      <CancelModal appt={cancelling} onClose={() => setCancelling(null)} />
      <ConfirmDelete
        open={!!deleting}
        title={`Delete ${deleting?.appointmentNo ?? ""}?`}
        message={
          <>
            This permanently removes the {label(deleting?.type).toLowerCase()} for <b>{fullName(deleting?.patient)}</b> on {date(deleting?.startAt)} at {time(deleting?.startAt)} with {deleting?.therapist.user.name}.
            {deleting && (["COMPLETED", "IN_PROGRESS", "CHECKED_IN"].includes(deleting.status) || deleting.consultation) ? (
              <>
                <br /><br /><b className="text-rose-700">This visit already happened.</b> Its consultation / session notes are deleted too, and any package session it used is given back. Treatment plans written from it are kept.
              </>
            ) : (
              <>
                {" "}The time slot becomes free again and any pending reminder is stopped.
                <br /><br />Use <b>Cancel</b> instead if you want to keep a record that the appointment existed.
              </>
            )}
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

function CancelModal({ appt, onClose }: { appt: Appointment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/appointments/${appt!.id}/cancel`, { reason }),
    onSuccess: () => { refresh(qc, "appointments"); setReason(""); onClose(); },
  });
  return (
    <Modal open={!!appt} onClose={onClose} title={`Cancel ${appt?.appointmentNo ?? ""}`}>
      <div className="space-y-3">
        <Field label="Reason"><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorText error={m.error} />
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Keep</button><button className="btn-primary bg-rose-600 hover:bg-rose-700" disabled={reason.length < 2 || m.isPending} onClick={() => m.mutate()}>Cancel appointment</button></div>
      </div>
    </Modal>
  );
}
