"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertCircle, ArrowLeft, CalendarCheck, ClipboardList, Clock, CreditCard, Home, Stethoscope, User, UserPlus, Users } from "lucide-react";
import { PatientForm } from "@/components/patient-form";
import { Empty, ErrorText, Field, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { date, fullName, label, time, today } from "@/lib/format";
import type { Appointment, AvailabilityRow, Patient, PatientPackage, Therapist, TreatmentPlan } from "@/lib/types";

type VisitType = "INITIAL_CONSULTATION" | "FOLLOW_UP_CONSULTATION" | "THERAPY_SESSION" | "HOME_VISIT";

const TYPES: { value: VisitType; label: string; hint: string; icon: typeof User }[] = [
  { value: "INITIAL_CONSULTATION", label: "First consultation", hint: "Assessment + treatment plan", icon: Stethoscope },
  { value: "FOLLOW_UP_CONSULTATION", label: "Follow-up", hint: "Review progress", icon: ClipboardList },
  { value: "THERAPY_SESSION", label: "Therapy session", hint: "Needs an active plan", icon: CalendarCheck },
  { value: "HOME_VISIT", label: "Home visit", hint: "Physio visits the patient", icon: Home },
];
const DAYS_SHOWN = 14;
const IST_MS = 330 * 60_000;

/** Clinic-time hour of an ISO timestamp, for Morning / Afternoon / Evening grouping. */
const clinicHour = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).getUTCHours();
const PERIODS = [
  { key: "Morning", test: (h: number) => h < 12 },
  { key: "Afternoon", test: (h: number) => h >= 12 && h < 17 },
  { key: "Evening", test: (h: number) => h >= 17 },
];

export default function BookAppointmentPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <BookAppointment />
    </Suspense>
  );
}

/**
 * Full-page booking.
 *   /appointments/book                      → new booking
 *   /appointments/book?patientId=…          → new booking for a patient
 *   /appointments/book?type=HOME_VISIT      → preselect type
 *   /appointments/book?reschedule=<apptId>  → pick a new slot for an existing appointment
 *
 * Choices are stored as "null = not chosen yet" so sensible defaults (the patient's only plan,
 * the plan's physiotherapist, their package, their default address) are derived, not copied by effects.
 */
function BookAppointment() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isPatient = user?.role === "PATIENT";
  const rescheduleId = params?.get("reschedule") ?? undefined;
  const fixedPatient = params?.get("patientId") ?? undefined;
  const typeParam = TYPES.some((t) => t.value === params?.get("type")) ? (params?.get("type") as VisitType) : null;

  const [search, setSearch] = useState("");
  const [patientChoice, setPatientChoice] = useState<string | null>(null);
  const [patientMode, setPatientMode] = useState<"existing" | "new">("existing");
  const [typeChoice, setTypeChoice] = useState<VisitType | null>(null);
  const [planChoice, setPlanChoice] = useState<string | null>(null);
  const [packageChoice, setPackageChoice] = useState<string | null>(null);
  const [addressChoice, setAddressChoice] = useState<string | null>(null);
  const [therapistChoice, setTherapistChoice] = useState<string | null>(null); // "" = any
  const [day, setDay] = useState(today());
  const [slot, setSlot] = useState<{ id: string; startAt: string; therapist: string } | null>(null);
  const [distanceKm, setDistanceKm] = useState("");
  const [notes, setNotes] = useState("");
  const [creatingPlan, setCreatingPlan] = useState(false);

  const original = useQuery({ queryKey: ["appointment", rescheduleId], queryFn: () => api.get<Appointment>(`/appointments/${rescheduleId}`), enabled: !!rescheduleId });

  /* ── derived core values ── */
  const patientId = original.data?.patient.id ?? fixedPatient ?? (isPatient ? user?.patientId ?? "" : patientChoice ?? "");
  const type: VisitType = (original.data?.type as VisitType | undefined) ?? typeChoice ?? typeParam ?? "INITIAL_CONSULTATION";
  const isConsult = type === "INITIAL_CONSULTATION";
  const needsPlan = type === "THERAPY_SESSION";
  const usesPackage = type === "THERAPY_SESSION" || type === "HOME_VISIT";

  const patients = useQuery({
    queryKey: ["patients", "search", search],
    queryFn: () => api.page<Patient>("/patients", { search, limit: 9 }),
    enabled: !fixedPatient && !isPatient && !rescheduleId,
  });
  const selectedPatient = useQuery({ queryKey: ["patient-lite", patientId], queryFn: () => api.get<Patient>(`/patients/${patientId}`), enabled: !!patientId && !isPatient });
  const plans = useQuery({ queryKey: ["plans", patientId, "active"], queryFn: () => api.page<TreatmentPlan>("/treatment-plans", { patientId, status: "ACTIVE" }), enabled: !!patientId && !rescheduleId });
  const pkgs = useQuery({ queryKey: ["patient-packages", patientId, "active"], queryFn: () => api.page<PatientPackage>("/patient-packages", { patientId, status: "ACTIVE" }), enabled: !!patientId && !rescheduleId });
  const addresses = useQuery({
    queryKey: ["addresses", patientId],
    queryFn: () => api.get<{ id: string; label: string; line1: string; city: string; isDefault: boolean }[]>(`/patients/${patientId}/addresses`),
    enabled: !!patientId && type === "HOME_VISIT" && !rescheduleId,
  });
  const therapists = useQuery({
    queryKey: ["therapists", type === "HOME_VISIT"],
    queryFn: () => api.get<Therapist[]>("/therapists", { homeVisit: type === "HOME_VISIT" || undefined }),
  });

  const planList = useMemo(() => plans.data?.data ?? [], [plans.data]);
  const pkgList = useMemo(() => pkgs.data?.data ?? [], [pkgs.data]);
  const planId = isConsult ? "" : planChoice ?? (planList.length === 1 ? planList[0].id : "");
  const plan = planList.find((p) => p.id === planId);
  const packageId = !usesPackage ? "" : packageChoice ?? (needsPlan && pkgList.length === 1 ? pkgList[0].id : "");
  const pkg = pkgList.find((p) => p.id === packageId);
  const addressList = addresses.data ?? [];
  const addressId = addressChoice ?? (addressList.find((a) => a.isDefault) ?? addressList[0])?.id ?? "";
  // Physio: user's choice → the plan's physio → (reschedule) the current physio → any
  const therapistId = therapistChoice ?? plan?.therapist.id ?? original.data?.therapist.id ?? "";
  const therapistOk = !therapistId || (therapists.data ?? []).some((t) => t.id === therapistId);
  const effectiveTherapist = therapistOk ? therapistId : "";

  const summary = useQuery({
    queryKey: ["availability-summary", type, effectiveTherapist],
    queryFn: () => api.get<{ date: string; free: number }[]>("/availability/summary", { from: today(), days: DAYS_SHOWN, type, therapistId: effectiveTherapist || undefined }),
  });
  const avail = useQuery({
    queryKey: ["availability", day, type, effectiveTherapist],
    queryFn: () => api.get<AvailabilityRow[]>("/availability", { date: day, type, therapistId: effectiveTherapist || undefined }),
  });
  const freeCount = (avail.data ?? []).reduce((n, t) => n + t.slots.length, 0);

  const resetSlot = () => setSlot(null);
  const choosePatient = (id: string) => {
    setPatientChoice(id);
    setPlanChoice(null);
    setPackageChoice(null);
    setAddressChoice(null);
    setTherapistChoice(null);
    resetSlot();
  };

  const book = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!slot) throw new Error("Choose a time slot");
      if (rescheduleId) return (await api.post<{ id: string }>(`/appointments/${rescheduleId}/reschedule`, { newSlotId: slot.id })).id;
      const base = {
        patientId: isPatient ? undefined : patientId,
        slotId: slot.id,
        treatmentPlanId: planId || undefined,
        patientPackageId: packageId || undefined,
        notes: notes.trim() || undefined,
      };
      if (type === "HOME_VISIT") return (await api.post<{ appointmentId: string }>("/home-visits", { ...base, addressId, distanceKm: distanceKm ? Number(distanceKm) : undefined })).appointmentId;
      return (await api.post<{ id: string }>("/appointments", { ...base, type })).id;
    },
    onSuccess: (appointmentId) => {
      qc.invalidateQueries();
      // Open the booked appointment itself (the list only shows today by default).
      router.push(isPatient ? "/appointments" : `/appointments/${appointmentId}?booked=1`);
    },
  });

  // What is still missing — shown next to the Confirm button instead of a silent disabled state.
  const missing = !rescheduleId && !patientId
    ? "Select or register the patient"
    : !rescheduleId && needsPlan && !planId
      ? "Therapy sessions need an active treatment plan"
      : !rescheduleId && type === "HOME_VISIT" && !addressId
        ? "Add the patient's address for a home visit"
        : !slot
          ? "Choose a date and time"
          : null;

  const canCreatePlan = hasRole(user, "PHYSIOTHERAPIST", "ADMIN");
  const step = (n: number) => (isPatient || fixedPatient || rescheduleId ? n - 1 : n);

  return (
    <>
      <PageHeader
        title={rescheduleId ? "Reschedule appointment" : "Book appointment"}
        subtitle={
          rescheduleId && original.data
            ? `${original.data.appointmentNo} · ${fullName(original.data.patient)} · currently ${date(original.data.startAt)}, ${time(original.data.startAt)} with ${original.data.therapist.user.name}`
            : "Patient → visit type → physiotherapist & time → confirm"
        }
        actions={<Link href="/appointments" className="btn-ghost"><ArrowLeft size={16} /> Back to appointments</Link>}
      />

      <div className="grid gap-6 xl:grid-cols-5">
        {/* ───────── Left: who & what ───────── */}
        <div className="space-y-6 xl:col-span-2">
          {!rescheduleId && !fixedPatient && !isPatient && (
            <section className="card">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-bold">1. Patient</h2>
                <div className="grid grid-cols-2 rounded-lg bg-navy-50 p-1 text-xs font-semibold">
                  <button type="button" onClick={() => setPatientMode("existing")} className={clsx("flex items-center gap-1 rounded-md px-3 py-1.5", patientMode === "existing" ? "bg-white text-navy-700 shadow" : "text-navy-500")}>
                    <Users size={13} /> Existing
                  </button>
                  <button type="button" onClick={() => setPatientMode("new")} className={clsx("flex items-center gap-1 rounded-md px-3 py-1.5", patientMode === "new" ? "bg-white text-navy-700 shadow" : "text-navy-500")}>
                    <UserPlus size={13} /> New
                  </button>
                </div>
              </div>

              {patientMode === "existing" ? (
                <>
                  <input className="input" placeholder="Search name, phone or patient code" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <div className="mt-3 max-h-60 space-y-1 overflow-y-auto">
                    {patients.isLoading ? <Spinner /> : patients.data?.data.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => choosePatient(p.id)}
                        className={clsx("flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm", patientId === p.id ? "border-gold-500 bg-gold-100" : "border-navy-100 hover:border-gold-300")}
                      >
                        <span className="font-medium">{fullName(p)}</span>
                        <span className="shrink-0 text-xs text-navy-500">{p.patientCode} · {p.phone}</span>
                      </button>
                    ))}
                    {patients.data?.data.length === 0 && (
                      <div className="p-4 text-center text-sm text-navy-500">
                        No patients match.{" "}
                        <button type="button" className="font-semibold text-gold-700" onClick={() => setPatientMode("new")}>Register a new patient →</button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <PatientForm
                  compact
                  submitLabel="Register & select"
                  onCancel={() => setPatientMode("existing")}
                  onCreated={(p) => {
                    choosePatient(p.id);
                    setSearch(p.phone);
                    setPatientMode("existing");
                  }}
                />
              )}
            </section>
          )}

          {!rescheduleId && (
            <section className="card space-y-4">
              <h2 className="font-bold">{step(2)}. Visit</h2>
              <div className="grid grid-cols-2 gap-2">
                {TYPES.map(({ value, label: l, hint, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setTypeChoice(value);
                      setTherapistChoice(null);
                      resetSlot();
                    }}
                    className={clsx("rounded-lg border p-3 text-left transition", type === value ? "border-gold-500 bg-gold-100" : "border-navy-100 hover:border-gold-300")}
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-navy-700"><Icon size={16} /> {l}</div>
                    <div className="mt-0.5 text-xs text-navy-500">{hint}</div>
                  </button>
                ))}
              </div>

              {isConsult ? (
                <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-500">The physiotherapist assesses the patient and writes the treatment plan during this visit.</p>
              ) : (
                <div>
                  <Field label={`Treatment plan${needsPlan ? " *" : " (optional)"}`}>
                    <select
                      className="input"
                      value={planId}
                      onChange={(e) => {
                        setPlanChoice(e.target.value);
                        setTherapistChoice(null);
                        resetSlot();
                      }}
                      disabled={!patientId}
                    >
                      <option value="">{!patientId ? "Select the patient first" : plans.isLoading ? "Loading plans…" : planList.length ? (needsPlan ? "Select plan" : "None") : "No active plan"}</option>
                      {planList.map((p) => (
                        <option key={p.id} value={p.id}>{p.title} · {p.therapist.user.name}</option>
                      ))}
                    </select>
                  </Field>
                  {patientId && canCreatePlan && !creatingPlan && (
                    <button type="button" className="mt-2 text-xs font-semibold text-gold-700" onClick={() => setCreatingPlan(true)}>+ Create treatment plan</button>
                  )}
                  {patientId && !canCreatePlan && !planList.length && !plans.isLoading && needsPlan && (
                    <p className="mt-2 text-xs text-navy-500">This patient has no plan yet. Book a first consultation; the physiotherapist writes the plan there.</p>
                  )}
                  {creatingPlan && (
                    <QuickPlanForm
                      patientId={patientId}
                      defaultTherapistId={effectiveTherapist || undefined}
                      onCancel={() => setCreatingPlan(false)}
                      onCreated={(id) => {
                        setCreatingPlan(false);
                        setPlanChoice(id);
                        setTherapistChoice(null);
                      }}
                    />
                  )}
                </div>
              )}

              {usesPackage && (
                <Field label="Payment">
                  <select className="input" value={packageId} onChange={(e) => setPackageChoice(e.target.value)} disabled={!patientId}>
                    <option value="">Pay per visit</option>
                    {pkgList.map((p) => <option key={p.id} value={p.id}>{p.package.name} · {p.remainingSessions} sessions left</option>)}
                  </select>
                </Field>
              )}

              {type === "HOME_VISIT" && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Field label="Visit address *">
                      <select className="input" value={addressId} onChange={(e) => setAddressChoice(e.target.value)} disabled={!patientId}>
                        {!addressList.length && <option value="">No address on file</option>}
                        {addressList.map((a) => <option key={a.id} value={a.id}>{a.label}: {a.line1}, {a.city}</option>)}
                      </select>
                    </Field>
                    {patientId && !addresses.isLoading && !addressList.length && !isPatient && (
                      <Link href={`/patients/${patientId}`} className="mt-1 inline-block text-xs font-semibold text-gold-700">Add address on the patient profile →</Link>
                    )}
                  </div>
                  {!isPatient && <Field label="Distance (km)"><input className="input" type="number" min={0} value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} /></Field>}
                </div>
              )}

              <Field label="Notes"><textarea className="input" rows={2} placeholder="Reason for visit, special requests…" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </section>
          )}
        </div>

        {/* ───────── Right: physio, date & time ───────── */}
        <div className="space-y-6 xl:col-span-3">
          <section className="card">
            <h2 className="mb-3 font-bold">{rescheduleId ? "New date & time" : `${step(3)}. Physiotherapist, date & time`}</h2>

            {/* Physiotherapist */}
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { setTherapistChoice(""); resetSlot(); }}
                className={clsx("rounded-full border px-3 py-1.5 text-sm", !effectiveTherapist ? "border-navy-700 bg-navy-700 text-white" : "border-navy-100 hover:border-gold-300")}
              >
                Any physiotherapist
              </button>
              {therapists.data?.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setTherapistChoice(t.id); resetSlot(); }}
                  className={clsx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", effectiveTherapist === t.id ? "border-navy-700 bg-navy-700 text-white" : "border-navy-100 hover:border-gold-300")}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.colorTag ?? "#c9a14a" }} />
                  {t.user.name}
                  {plan?.therapist.id === t.id && <span className={clsx("rounded px-1 text-[10px] font-bold", effectiveTherapist === t.id ? "bg-gold-500 text-navy-900" : "bg-gold-100 text-gold-700")}>PLAN</span>}
                </button>
              ))}
            </div>

            {/* Dates with free-slot counts */}
            <div className="mb-1 flex items-center justify-between">
              <span className="label">Date</span>
              <input type="date" className="input w-40 py-1 text-xs" min={today()} value={day} onChange={(e) => { if (e.target.value) { setDay(e.target.value); resetSlot(); } }} />
            </div>
            <div className="grid grid-cols-7 gap-2">
              {(summary.data ?? []).map(({ date: d, free }) => {
                const dt = new Date(`${d}T12:00:00Z`);
                const on = day === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setDay(d); resetSlot(); }}
                    className={clsx(
                      "rounded-lg border px-1 py-2 text-center text-xs transition",
                      on ? "border-gold-500 bg-gold-100 font-bold" : free ? "border-navy-100 hover:border-gold-300" : "border-navy-50 bg-slate-50 text-navy-500/50",
                    )}
                    title={free ? `${free} free slots` : "Fully booked / closed"}
                  >
                    <div>{dt.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}</div>
                    <div className="text-base">{dt.getUTCDate()}</div>
                    <div className={clsx("text-[10px]", free ? "text-emerald-700" : "text-navy-500/60")}>{free ? `${free} free` : "Full"}</div>
                  </button>
                );
              })}
              {summary.isLoading && <div className="col-span-7"><Spinner /></div>}
            </div>

            {/* Times */}
            <div className="mt-5">
              <span className="label">
                {date(`${day}T06:00:00Z`)} · {avail.data ? `${freeCount} free` : "loading"}
              </span>
              {avail.isLoading ? <Spinner /> : avail.error ? <ErrorText error={avail.error} /> : freeCount === 0 ? (
                <Empty>No free slots on this day{effectiveTherapist ? " for this physiotherapist" : ""}. Pick a date marked in green{effectiveTherapist ? " or choose “Any physiotherapist”" : ""}.</Empty>
              ) : (
                <div className="space-y-3">
                  {avail.data?.filter((t) => t.slots.length).map((t) => (
                    <div key={t.therapistId} className="rounded-lg border border-navy-50 p-3">
                      <div className="mb-2 text-sm font-semibold">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.colorTag ?? "#c9a14a" }} />
                        {t.therapistName} <span className="font-normal text-navy-500">· {t.specializations.join(", ")}</span>
                      </div>
                      {PERIODS.map(({ key, test }) => {
                        const list = t.slots.filter((s) => test(clinicHour(s.startAt)));
                        if (!list.length) return null;
                        return (
                          <div key={key} className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="w-20 text-xs font-semibold uppercase tracking-wide text-navy-500">{key}</span>
                            {list.map((s) => (
                              <button
                                key={s.slotId}
                                type="button"
                                onClick={() => setSlot({ id: s.slotId, startAt: s.startAt, therapist: t.therapistName })}
                                className={clsx("rounded-md border px-3 py-1.5 text-sm", slot?.id === s.slotId ? "border-navy-700 bg-navy-700 text-white" : "border-navy-100 hover:border-gold-500")}
                              >
                                {time(s.startAt)}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ───────── Summary & confirm ───────── */}
          <section className="card border-gold-300">
            <h2 className="mb-3 font-bold">Summary</h2>
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <SummaryItem icon={User} k="Patient" v={isPatient ? user?.name : selectedPatient.data ? `${fullName(selectedPatient.data)} (${selectedPatient.data.patientCode})` : original.data ? fullName(original.data.patient) : "Not selected"} />
              <SummaryItem icon={CalendarCheck} k="Visit" v={label(type)} />
              <SummaryItem icon={Clock} k="When" v={slot ? `${date(slot.startAt)}, ${time(slot.startAt)} · ${slot.therapist}` : "Pick a time"} />
              {!rescheduleId && !isConsult && <SummaryItem icon={ClipboardList} k="Plan" v={plan?.title ?? (needsPlan ? "Required" : "None")} />}
              {!rescheduleId && usesPackage && <SummaryItem icon={CreditCard} k="Payment" v={pkg ? `${pkg.package.name} (${pkg.remainingSessions} left)` : "Pay per visit"} />}
            </div>
            <div className="mt-4"><ErrorText error={book.error} /></div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              {missing && <span className="mr-auto flex items-center gap-1 text-xs font-medium text-amber-700"><AlertCircle size={14} /> {missing}</span>}
              <Link href="/appointments" className="btn-ghost">Cancel</Link>
              <button className="btn-primary" disabled={!!missing || book.isPending} onClick={() => book.mutate()}>
                {book.isPending ? "Saving…" : rescheduleId ? "Move appointment" : "Confirm booking"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function SummaryItem({ icon: Icon, k, v }: { icon: typeof User; k: string; v?: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={16} className="mt-0.5 shrink-0 text-gold-700" />
      <div>
        <div className="text-xs text-navy-500">{k}</div>
        <div className="font-semibold">{v || "—"}</div>
      </div>
    </div>
  );
}

const PLAN_CATEGORIES = ["Exercise Therapy", "Manual Therapy", "Electrotherapy", "Taping", "Dry Needling", "Hot/Cold Therapy", "Traction", "Education"];
type PlanItem = { category: string; name: string };

/** Compact treatment-plan form used inline on the booking page. Creates the plan already active. */
function QuickPlanForm({ patientId, defaultTherapistId, onCreated, onCancel }: { patientId: string; defaultTherapistId?: string; onCreated: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isPhysio = user?.role === "PHYSIOTHERAPIST";
  const therapists = useQuery({ queryKey: ["therapists"], queryFn: () => api.get<{ id: string; user: { name: string } }[]>("/therapists"), enabled: !isPhysio });
  const [f, setF] = useState({ title: "", diagnosis: "", prescribedSessions: 10, frequencyPerWeek: 3, sessionMinutes: 30, therapistId: defaultTherapistId ?? "" });
  const [items, setItems] = useState<PlanItem[]>([{ category: "Exercise Therapy", name: "" }]);

  useEffect(() => {
    if (defaultTherapistId && !f.therapistId) setF((x) => ({ ...x, therapistId: defaultTherapistId }));
  }, [defaultTherapistId, f.therapistId]);

  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/treatment-plans", {
        patientId,
        title: f.title.trim(),
        diagnosis: f.diagnosis.trim() || undefined,
        prescribedSessions: Number(f.prescribedSessions),
        frequencyPerWeek: Number(f.frequencyPerWeek),
        sessionMinutes: Number(f.sessionMinutes),
        therapistId: isPhysio ? undefined : f.therapistId,
        activate: true,
        items: items.filter((i) => i.name.trim()).map((i, n) => ({ ...i, name: i.name.trim(), sortOrder: n })),
      }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      onCreated(p.id);
    },
  });

  const valid = f.title.trim().length >= 2 && items.some((i) => i.name.trim()) && (isPhysio || f.therapistId);

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-gold-300 bg-gold-100/40 p-3">
      <div className="text-sm font-bold">New treatment plan</div>
      <Field label="Plan title *"><input className="input" placeholder="e.g. Lower back rehab" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
      <Field label="Diagnosis"><input className="input" value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></Field>
      {!isPhysio && (
        <Field label="Treating physiotherapist *">
          <select className="input" value={f.therapistId} onChange={(e) => setF({ ...f, therapistId: e.target.value })}>
            <option value="">Select</option>
            {therapists.data?.map((t) => <option key={t.id} value={t.id}>{t.user.name}</option>)}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Field label="Sessions"><input className="input" type="number" min={1} value={f.prescribedSessions} onChange={(e) => setF({ ...f, prescribedSessions: Number(e.target.value) })} /></Field>
        <Field label="Per week"><input className="input" type="number" min={1} max={14} value={f.frequencyPerWeek} onChange={(e) => setF({ ...f, frequencyPerWeek: Number(e.target.value) })} /></Field>
        <Field label="Minutes"><input className="input" type="number" min={10} step={5} value={f.sessionMinutes} onChange={(e) => setF({ ...f, sessionMinutes: Number(e.target.value) })} /></Field>
      </div>
      <div>
        <span className="label">Treatments *</span>
        {items.map((it, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <select className="input w-40 shrink-0" value={it.category} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}>
              {PLAN_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input className="input" placeholder="e.g. Core strengthening, IFT" value={it.name} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            {items.length > 1 && <button type="button" className="text-rose-600" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        <button type="button" className="text-xs font-semibold text-gold-700" onClick={() => setItems([...items, { category: "Exercise Therapy", name: "" }])}>+ Add treatment</button>
      </div>
      <ErrorText error={save.error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Create & select plan"}</button>
      </div>
    </div>
  );
}
