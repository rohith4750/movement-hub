"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Empty, ErrorText, Field, Modal, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { fullName, time } from "@/lib/format";

interface Session {
  id: string;
  sessionNumber: number | null;
  status: string;
  painBefore: number | null;
  notes: string | null;
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null };
  therapist: { id: string; user: { name: string } };
  coverReason: string | null;
  coveredByName: string | null;
  appointment: { startAt: string; appointmentNo: string };
  treatmentPlan: { title: string; prescribedSessions: number; items: { id: string; category: string; name: string; sets: number | null; reps: number | null; durationMinutes: number | null }[] } | null;
  patientPackage: { remainingSessions: number; package: { name: string } } | null;
}

export default function TherapySessionsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Sessions />
    </Suspense>
  );
}

function Sessions() {
  const user = useAuth((s) => s.user);
  const searchParams = useSearchParams();
  const openId = searchParams?.get("open") ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["sessions", "today"], queryFn: () => api.get<Session[]>("/therapy-sessions/today"), refetchInterval: 2 * 60_000 });

  useEffect(() => {
    if (openId) setSelected(openId);
  }, [openId]);

  const current = q.data?.find((s) => s.id === selected) ?? null;

  return (
    <>
      <PageHeader title="Today's therapy sessions" subtitle={user?.role === "PHYSIOTHERAPIST" ? "Your patients for today" : "All therapists"} />
      <div className="card">
        {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty>No therapy sessions today.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th><th>Patient</th><th>Plan</th><th>Session</th><th>Therapist</th><th>Package</th><th>Status</th><th /></tr></thead>
              <tbody>
                {q.data.map((s) => (
                  <tr key={s.id}>
                    <td className="font-semibold">{time(s.appointment.startAt)}</td>
                    <td>{fullName(s.patient)}<div className="text-xs text-navy-500">{s.patient.patientCode}</div></td>
                    <td>{s.treatmentPlan?.title ?? "—"}</td>
                    <td>{s.sessionNumber ?? "—"}{s.treatmentPlan ? ` / ${s.treatmentPlan.prescribedSessions}` : ""}</td>
                    <td>{s.therapist.user.name}</td>
                    <td>{s.patientPackage ? `${s.patientPackage.remainingSessions} left` : "Pay per visit"}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td>{hasRole(user, "PHYSIOTHERAPIST") && ["SCHEDULED", "IN_PROGRESS"].includes(s.status) && <button className="btn-gold px-3 py-1 text-xs" onClick={() => setSelected(s.id)}>{s.status === "SCHEDULED" ? "Start" : "Continue"}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {current && <SessionModal session={current} onClose={() => setSelected(null)} />}
    </>
  );
}

type Ex = { name: string; sets?: number; reps?: number; durationMinutes?: number };

function SessionModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [painBefore, setPainBefore] = useState(session.painBefore ?? 5);
  const [painAfter, setPainAfter] = useState(3);
  const [progressRating, setProgressRating] = useState(3);
  const [notes, setNotes] = useState(session.notes ?? "");
  const [homeAdvice, setHomeAdvice] = useState("");
  const [exercises, setExercises] = useState<Ex[]>(
    session.treatmentPlan?.items.filter((i) => i.category === "Exercise Therapy").map((i) => ({ name: i.name, sets: i.sets ?? undefined, reps: i.reps ?? undefined })) ?? [],
  );
  const user = useAuth((s) => s.user);
  const [coverReason, setCoverReason] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["sessions"] });

  // Any physiotherapist (or Super Admin) can run a session; if it isn't theirs they must say why.
  const isOwner = user?.role === "SUPER_ADMIN" || user?.therapistId === session.therapist.id;
  const needsReason = !isOwner && !session.coverReason;
  const reasonMissing = needsReason && coverReason.trim().length < 3;
  const reason = coverReason.trim() || undefined;

  const start = useMutation({ mutationFn: () => api.post(`/therapy-sessions/${session.id}/start`, { painBefore, coverReason: reason }), onSuccess: refresh });
  const complete = useMutation({
    mutationFn: () => api.post<{ package: { remainingSessions: number } | null; plan: { id: string; planNo: string; prescribedSessions: number; readyToComplete: boolean } | null }>(`/therapy-sessions/${session.id}/complete`, { painBefore, coverReason: reason, painAfter, progressRating, notes: notes || undefined, homeAdvice: homeAdvice || undefined, exercises: exercises.filter((e) => e.name) }),
    onSuccess: (r) => {
      refresh();
      qc.invalidateQueries({ queryKey: ["plans"] });
      if (r.plan) qc.invalidateQueries({ queryKey: ["plan", r.plan.id] });
      const pkgNote = r.package ? ` ${r.package.remainingSessions} package session(s) remaining.` : "";
      onClose();
      if (r.plan?.readyToComplete) {
        // Last prescribed session done — offer to go straight to the plan and complete the treatment.
        if (confirm(`Session completed.${pkgNote}

All ${r.plan.prescribedSessions} prescribed sessions of plan ${r.plan.planNo} are done. Open the plan to complete the treatment?`)) {
          router.push(`/treatment-plans/${r.plan.id}`);
        }
      } else if (r.package) alert(`Session completed.${pkgNote}`);
    },
  });

  return (
    <Modal open onClose={onClose} title={`${fullName(session.patient)} · Session ${session.sessionNumber ?? ""}`} wide>
      <div className="space-y-4">
        {session.coverReason && (
          <div className="rounded-lg bg-gold-100 p-3 text-sm text-navy-500">
            Taken over by {session.coveredByName ?? "another physiotherapist"} instead of {session.therapist.user.name}: {session.coverReason}
          </div>
        )}
        {needsReason && (
          <Field label={`Reason for taking this session from ${session.therapist.user.name} *`}>
            <textarea className="input" rows={2} value={coverReason} onChange={(e) => setCoverReason(e.target.value)} placeholder="e.g. Assigned physio is on leave / running late" />
          </Field>
        )}
        {session.treatmentPlan && (
          <div className="rounded-lg bg-navy-50 p-3 text-sm">
            <b>{session.treatmentPlan.title}</b>
            <ul className="mt-1 list-disc pl-5 text-navy-500">
              {session.treatmentPlan.items.map((i) => <li key={i.id}>{i.category}: {i.name}{i.durationMinutes ? ` · ${i.durationMinutes} min` : ""}</li>)}
            </ul>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={`Pain before: ${painBefore}/10`}><input type="range" min={0} max={10} className="w-full accent-[#1b2160]" value={painBefore} onChange={(e) => setPainBefore(Number(e.target.value))} /></Field>
          {session.status === "IN_PROGRESS" && <Field label={`Pain after: ${painAfter}/10`}><input type="range" min={0} max={10} className="w-full accent-[#c9a14a]" value={painAfter} onChange={(e) => setPainAfter(Number(e.target.value))} /></Field>}
          {session.status === "IN_PROGRESS" && <Field label={`Progress: ${progressRating}/5`}><input type="range" min={1} max={5} className="w-full" value={progressRating} onChange={(e) => setProgressRating(Number(e.target.value))} /></Field>}
        </div>

        {session.status === "SCHEDULED" ? (
          <>
            <ErrorText error={start.error} />
            <div className="flex justify-end"><button className="btn-primary" disabled={start.isPending || reasonMissing} onClick={() => start.mutate()}>Start session</button></div>
          </>
        ) : (
          <>
            <div>
              <span className="label">Exercises performed</span>
              {exercises.map((e, i) => (
                <div key={i} className="mb-2 grid grid-cols-12 gap-2">
                  <input className="input col-span-6" placeholder="Exercise" value={e.name} onChange={(ev) => setExercises(exercises.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
                  <input className="input col-span-2" type="number" placeholder="Sets" value={e.sets ?? ""} onChange={(ev) => setExercises(exercises.map((x, j) => (j === i ? { ...x, sets: ev.target.value ? Number(ev.target.value) : undefined } : x)))} />
                  <input className="input col-span-2" type="number" placeholder="Reps" value={e.reps ?? ""} onChange={(ev) => setExercises(exercises.map((x, j) => (j === i ? { ...x, reps: ev.target.value ? Number(ev.target.value) : undefined } : x)))} />
                  <button className="btn-ghost col-span-2" onClick={() => setExercises(exercises.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
              ))}
              <button className="inline-flex items-center gap-1 text-sm font-semibold text-gold-700" onClick={() => setExercises([...exercises, { name: "" }])}><Plus size={14} /> Add exercise</button>
            </div>
            <Field label="Session notes"><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Field label="Home advice"><textarea className="input" rows={2} value={homeAdvice} onChange={(e) => setHomeAdvice(e.target.value)} /></Field>
            {session.patientPackage && <p className="text-xs text-navy-500">Completing deducts 1 session from {session.patientPackage.package.name} ({session.patientPackage.remainingSessions} left).</p>}
            <ErrorText error={complete.error} />
            <div className="flex justify-end"><button className="btn-gold" disabled={complete.isPending || reasonMissing} onClick={() => complete.mutate()}>Complete session</button></div>
          </>
        )}
      </div>
    </Modal>
  );
}
