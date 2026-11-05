import Ionicons from "@expo/vector-icons/Ionicons";
import { keepPreviousData, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { QuickPlanForm } from "@/components/clinical-plan-form";
import { DobAgeFields, RegularPhysioField, useOwnTherapistId } from "@/components/form";
import { CategoryBadge, VisitLine } from "@/components/patient-visits";
import { MultiDateCalendar } from "@/components/multi-date-calendar";
import { slotStyles, SlotLegend } from "@/components/slot-legend";
import { Badge, Button, Card, Chips, Empty, ErrorBox, Field, H2, Input, KeyValue, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api, ApiError, fieldErrors } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { addDays, ageFrom, clinicDay, clinicHour, date, dayParts, fullName, hhmm, label, time, today } from "@/lib/format";
import { useActivePlans, useAppointment, usePatient, useTherapists } from "@/lib/queries";
import { qk } from "@/lib/query-keys";
import { refresh, useAction } from "@/lib/refresh";
import type { AppointmentType, AvailabilityRow, PatientListItem, PatientPackage } from "@/lib/types";
import { colors, radius, space } from "@/theme";

const TYPES: { value: AppointmentType; label: string; hint: string }[] = [
  { value: "INITIAL_CONSULTATION", label: "First consultation", hint: "Assessment and treatment plan" },
  { value: "FOLLOW_UP_CONSULTATION", label: "Follow-up", hint: "Review progress" },
  { value: "THERAPY_SESSION", label: "Therapy session", hint: "Treatment under a plan" },
  { value: "HOME_VISIT", label: "Home visit", hint: "Treatment at the patient's address" },
];
const DAYS = 14;
const PERIODS = [
  { key: "Morning", test: (h: number) => h < 12 },
  { key: "Afternoon", test: (h: number) => h >= 12 && h < 17 },
  { key: "Evening", test: (h: number) => h >= 17 },
];

type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: "MON", label: "Mon" },
  { value: "TUE", label: "Tue" },
  { value: "WED", label: "Wed" },
  { value: "THU", label: "Thu" },
  { value: "FRI", label: "Fri" },
  { value: "SAT", label: "Sat" },
  { value: "SUN", label: "Sun" },
];
const DAY_CODES: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
/** Clinic (IST) date and HH:mm for a slot start. */
const clinicParts = (iso: string) => ({ date: clinicDay(iso), time: hhmm(iso) });
/** Whole days from one YYYY-MM-DD to another. */
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
const dayCode = (d: string) => DAY_CODES[new Date(`${d}T12:00:00Z`).getUTCDay()];

type Preview = { items: { date: string; startAt: string; slotId: string | null; ok: boolean; reason: string | null }[]; available: number; packageRemaining: number | null };

type Step = "patient" | "visit" | "details" | "time" | "confirm";
const STEP_LABEL: Record<Step, string> = { patient: "Patient", visit: "Visit", details: "Details", time: "Date & time", confirm: "Confirm" };

/**
 * Staff booking as a step-by-step flow: Patient → Visit → Details (only when the visit type needs it)
 * → Date & time → Confirm. Every step moves forward on its own once its choice is made, and anything
 * missing (new patient, treatment plan, home address) can be added right here — no dead ends.
 * Opened with ?patientId=… from a patient, ?reschedule=<appointmentId> to move a visit, or
 * ?walkIn=1 for a patient who is at the clinic now (today only, checked in as it's booked).
 */
export default function Book() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const params = useLocalSearchParams<{ reschedule?: string; patientId?: string; type?: string; walkIn?: string; therapistId?: string; date?: string }>();
  const rescheduleId = typeof params.reschedule === "string" ? params.reschedule : undefined;
  const fixedPatient = typeof params.patientId === "string" ? params.patientId : undefined;
  const [walkInChoice, setWalkIn] = useState(params.walkIn === "1");
  const [slotGone, setSlotGone] = useState<string | null>(null);

  const original = useAppointment(rescheduleId);

  const [search, setSearch] = useState("");
  const [patientChoice, setPatientChoice] = useState<string | null>(null);
  const [typeChoice, setTypeChoice] = useState<AppointmentType | null>(null);
  const [planChoice, setPlanChoice] = useState<string | null>(null);
  const [pkgChoice, setPkgChoice] = useState<string | null>(null);
  const [addressChoice, setAddressChoice] = useState<string | null>(null);
  const [therapistChoice, setTherapistChoice] = useState<string | null>(typeof params.therapistId === "string" ? params.therapistId : null);
  const [dayChoice, setDayChoice] = useState<string | null>(typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null);
  const [slot, setSlot] = useState<{ id: string; startAt: string; therapist: string; therapistId: string } | null>(null);
  // A therapy series: "weekly" repeats chosen weekdays for N weeks; "dates" lets staff tap the exact dates on a calendar.
  const [mode, setMode] = useState<"once" | "weekly" | "dates">("once");
  const [pickedDates, setPickedDates] = useState<string[] | null>(null);
  // The time chosen for each picked date (date -> slot id). A date without one uses the same time as the first session.
  const [timePick, setTimePick] = useState<Record<string, string>>({});
  const [repeatDays, setRepeatDays] = useState<Weekday[] | null>(null);
  const [weeksChoice, setWeeksChoice] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [registering, setRegistering] = useState(false);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);

  const patientId = original.data?.patient.id ?? fixedPatient ?? patientChoice ?? "";
  const initialType = TYPES.some((t) => t.value === params.type) ? (params.type as AppointmentType) : null;
  const typePicked = original.data?.type ?? typeChoice ?? initialType;
  const type: AppointmentType = typePicked ?? "INITIAL_CONSULTATION";
  const isConsult = type === "INITIAL_CONSULTATION";
  const needsPlan = type === "THERAPY_SESSION";
  const usesPackage = type === "THERAPY_SESSION" || type === "HOME_VISIT";
  // Home visits are always planned ahead; a reschedule keeps the original's source.
  const walkIn = walkInChoice && !rescheduleId && type !== "HOME_VISIT";

  const patients = useQuery({
    queryKey: qk.patients.list("book", { search: search.trim() }),
    queryFn: () => api.page<PatientListItem>("/patients", { search: search.trim() || undefined, limit: 8 }),
    enabled: !patientId && !rescheduleId,
    placeholderData: keepPreviousData,
  });
  const patient = usePatient(patientId || undefined);
  const plans = useActivePlans(!rescheduleId && patientId ? patientId : undefined);
  const pkgs = useQuery({
    queryKey: qk.patientPackages.activeFor(patientId),
    queryFn: () => api.page<PatientPackage>("/patient-packages", { patientId, status: "ACTIVE" }),
    select: (r) => r.data,
    enabled: !!patientId && !rescheduleId,
  });
  const therapists = useTherapists({ homeVisit: type === "HOME_VISIT" });

  const planList = useMemo(() => plans.data ?? [], [plans.data]);
  const pkgList = useMemo(() => pkgs.data ?? [], [pkgs.data]);
  const addresses = useMemo(() => patient.data?.addresses ?? [], [patient.data]);
  const planId = isConsult ? "" : planChoice ?? (planList.length === 1 ? planList[0].id : "");
  const plan = planList.find((p) => p.id === planId);
  const packageId = !usesPackage ? "" : pkgChoice ?? (needsPlan && pkgList.length === 1 ? pkgList[0].id : "");
  const addressId = addressChoice ?? (addresses.find((a) => a.isDefault) ?? addresses[0])?.id ?? "";
  const ownTherapistId = useOwnTherapistId();
  // Default physio: the plan's physio, then the patient's regular physio, then (for a physio booking) themselves.
  const wanted = therapistChoice ?? plan?.therapist.id ?? original.data?.therapist.id ?? patient.data?.primaryTherapist?.id ?? ownTherapistId ?? "";
  const therapistId = !wanted || (therapists.data ?? []).some((t) => t.id === wanted) ? wanted : "";

  const summary = useQuery({
    queryKey: qk.availabilitySummary({ type, therapistId }),
    queryFn: () => api.get<{ date: string; free: number }[]>("/availability/summary", { from: today(), days: DAYS, type, therapistId: therapistId || undefined }),
    enabled: !walkIn,
  });
  // Start on the first day that has free times, not on a full "today". A walk-in is always today.
  const firstFree = summary.data?.find((d) => d.free > 0)?.date;
  const day = walkIn ? today() : dayChoice ?? firstFree ?? today();
  const avail = useQuery({
    queryKey: qk.availability({ day, type, therapistId, walkIn }),
    queryFn: () => api.get<AvailabilityRow[]>("/availability", { date: day, type, therapistId: therapistId || undefined, walkIn: walkIn ? "true" : undefined }),
    // Times fill up while the front desk is choosing: keep this list current.
    refetchInterval: 60_000,
  });
  const freeCount = (avail.data ?? []).reduce((n, t) => n + t.slots.length, 0);

  /* ─────────── Steps ─────────── */

  // Details are needed only when the visit type has something to choose (plan, package, address).
  const needsDetails = !rescheduleId && !isConsult;
  const steps: Step[] = rescheduleId ? ["time", "confirm"] : [...(fixedPatient ? [] : (["patient"] as Step[])), "visit", ...(needsDetails ? (["details"] as Step[]) : []), "time", "confirm"];
  const [stepState, setStep] = useState<Step>(rescheduleId ? "time" : fixedPatient ? "visit" : "patient");
  const step: Step = steps.includes(stepState) ? stepState : steps[0];
  const index = steps.indexOf(step);
  const next = () => setStep(steps[Math.min(index + 1, steps.length - 1)]);
  const back = () => (index > 0 ? setStep(steps[index - 1]) : router.canGoBack() ? router.back() : router.replace("/appointments"));

  const detailsProblem = needsPlan && !planId
    ? "Therapy sessions need an active treatment plan"
    : type === "HOME_VISIT" && !addressId
      ? "Add the patient's address for the home visit"
      : null;

  const missing = !rescheduleId && !patientId
    ? "Choose the patient"
    : !rescheduleId && detailsProblem
      ? detailsProblem
      : !slot
        ? "Choose a date and time"
        : null;

  const resetSlot = () => setSlot(null);

  /* ─────────── Repeat weekly (therapy sessions) ─────────── */

  const canRepeat = !rescheduleId && !walkIn && type === "THERAPY_SESSION" && !!planId;
  const repeating = canRepeat && mode !== "once" && !!slot;
  const slotParts = slot ? clinicParts(slot.startAt) : null;
  const days: Weekday[] = repeatDays ?? (slotParts ? [dayCode(slotParts.date)] : []);
  const defaultWeeks = plan ? Math.min(12, Math.max(1, Math.ceil(plan.prescribedSessions / Math.max(1, plan.frequencyPerWeek)))) : 4;
  const weeks = weeksChoice ?? defaultWeeks;

  // Pick dates: the chosen time starts the list; staff add or remove days on the calendar (up to 12 weeks ahead).
  const picked = (pickedDates ?? (slotParts ? [slotParts.date] : [])).slice().sort();
  const pickMin = today();
  const pickMax = addDays(pickMin, 83);
  const togglePicked = (ymd: string) => setPickedDates(picked.includes(ymd) ? picked.filter((x) => x !== ymd) : [...picked, ymd]);
  const byDates = mode === "dates";
  // The availability check works on a weekday + weeks range. For hand-picked dates ask about every day from the first
  // to the last chosen one (the server allows up to 12 weeks) and keep only the dates that were tapped.
  const spanWeeks = picked.length ? Math.min(12, Math.max(1, Math.ceil((dayDiff(picked[0], picked[picked.length - 1]) + 1) / 7))) : 1;
  const query = byDates
    ? { from: picked[0], weekdays: WEEKDAYS.map((d) => d.value), weeks: spanWeeks }
    : { from: slotParts?.date, weekdays: days, weeks };
  const preview = useQuery({
    queryKey: qk.recurringPreview({ patientId, therapistId: slot?.therapistId, time: slotParts?.time, from: query.from, days: query.weekdays.join(","), weeks: query.weeks, packageId }),
    queryFn: () =>
      api.post<Preview>("/appointments/recurring/preview", {
        patientId,
        therapistId: slot!.therapistId,
        time: slotParts!.time,
        from: query.from,
        weekdays: query.weekdays,
        weeks: query.weeks,
        patientPackageId: packageId || undefined,
      }),
    enabled: repeating && (byDates ? picked.length > 0 : days.length > 0),
  });
  const previewItems = (preview.data?.items ?? []).filter((i) => !byDates || picked.includes(i.date));

  // Pick dates also shows each date's free times for the chosen physio, so a date can have its own time.
  // They are asked for after the check above, because that check creates the physio's slots for far-away dates.
  const timeQueries = useQueries({
    queries: picked.map((d) => ({
      queryKey: qk.availability({ day: d, type, therapistId: slot?.therapistId ?? "", walkIn: false }),
      queryFn: () => api.get<AvailabilityRow[]>("/availability", { date: d, type, therapistId: slot!.therapistId }),
      enabled: repeating && byDates && !!slot && preview.isSuccess,
    })),
  });
  const datePlans = picked.map((d, i) => {
    const free = timeQueries[i]?.data?.find((r) => r.therapistId === slot?.therapistId)?.slots ?? [];
    const same = preview.data?.items.find((x) => x.date === d);
    const want = timePick[d];
    const slotId = want && free.some((f) => f.slotId === want) ? want : same?.ok && same.slotId ? same.slotId : null;
    return { date: d, free, slotId, loading: (!timeQueries[i]?.data && !timeQueries[i]?.isError) || preview.isFetching };
  });
  const repeatSlotIds = byDates ? datePlans.map((p) => p.slotId).filter((x): x is string => !!x) : previewItems.filter((i) => i.ok && i.slotId).map((i) => i.slotId!);
  const availableCount = byDates ? repeatSlotIds.length : previewItems.filter((i) => i.ok).length;
  const toggleDay = (d: Weekday) => setRepeatDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);

  const book = useAction(
    async (): Promise<string> => {
      if (!slot) throw new Error("Choose a time");
      if (rescheduleId) return (await api.post<{ id: string }>(`/appointments/${rescheduleId}/reschedule`, { newSlotId: slot.id })).id;
      if (repeating) {
        if (!repeatSlotIds.length) throw new Error("No free dates in this series");
        const list = await api.post<{ id: string }[]>("/appointments/recurring", {
          patientId,
          treatmentPlanId: planId,
          patientPackageId: packageId || undefined,
          slotIds: repeatSlotIds,
          notes: notes.trim() || undefined,
        });
        return list[0].id;
      }
      const base = { patientId, slotId: slot.id, treatmentPlanId: planId || undefined, patientPackageId: packageId || undefined, notes: notes.trim() || undefined };
      if (type === "HOME_VISIT") return (await api.post<{ appointmentId: string }>("/home-visits", { ...base, addressId })).appointmentId;
      return (await api.post<{ id: string }>("/appointments", { ...base, type, source: walkIn ? "WALK_IN" : "SCHEDULED" })).id;
    },
    {
      refresh: ["appointments"],
      onSuccess: (id) => router.replace({ pathname: "/appointment/[id]", params: { id } }),
      // Someone else took the time while we were confirming: show fresh times and go back a step.
      onError: (e) => {
        if (e instanceof ApiError && (e.code === "SLOT_UNAVAILABLE" || e.code === "SLOT_IN_PAST")) {
          setSlotGone(slot ? `${time(slot.startAt)} with ${slot.therapist} was just taken. Please pick another time.` : e.message);
          setSlot(null);
          void refresh(qc, "appointments");
          setStep("time");
        }
      },
    },
  );

  if (!hasRole(user, "ADMIN", "RECEPTIONIST")) {
    return (
      <Screen edges={["top", "bottom"]}>
        <TopBar title="Book appointment" onBack={() => router.back()} />
        <Empty icon="lock-closed-outline" title="Reception or admin only" message="Ask the front desk to book or move appointments." />
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title={rescheduleId ? "Reschedule" : "Book appointment"} onBack={back} />

      {/* Progress: tap a finished step to go back to it */}
      <View style={styles.stepper}>
        {steps.map((st, i) => {
          const done = i < index;
          const on = i === index;
          return (
            <Pressable key={st} disabled={!done} onPress={() => setStep(st)} accessibilityRole="button" accessibilityState={{ selected: on }} style={styles.stepItem}>
              <View style={styles.stepTrack}>
                <View style={[styles.stepLine, i === 0 && { opacity: 0 }, (done || on) && styles.stepLineOn]} />
                <View style={[styles.stepDot, (on || done) && styles.stepDotOn]}>
                  {done ? (
                    <Ionicons name="checkmark" size={15} color={colors.navy950} />
                  ) : (
                    <Text weight="bold" style={{ fontSize: 13, color: on ? colors.navy950 : colors.muted }}>{i + 1}</Text>
                  )}
                </View>
                <View style={[styles.stepLine, i === steps.length - 1 && { opacity: 0 }, done && styles.stepLineOn]} />
              </View>
              <Text weight="semibold" style={{ fontSize: 11, color: on ? colors.navy800 : colors.muted }} numberOfLines={1}>{STEP_LABEL[st]}</Text>
            </Pressable>
          );
        })}
      </View>

      {rescheduleId && original.data ? (
        <Card style={{ backgroundColor: colors.navy50 }}>
          <Text weight="semibold">{fullName(original.data.patient)} · {label(original.data.type)}</Text>
          <Muted>Now: {date(original.data.startAt)}, {time(original.data.startAt)} with {original.data.therapist.user.name}</Muted>
        </Card>
      ) : null}

      {/* Chosen so far */}
      {!rescheduleId && step !== "patient" && patient.data ? (
        <Card style={{ backgroundColor: colors.navy50 }}>
          <Text weight="semibold">{fullName(patient.data)}{ageFrom(patient.data.dateOfBirth) !== null ? ` · ${ageFrom(patient.data.dateOfBirth)} yrs` : ""}</Text>
          <Muted style={{ fontSize: 12 }}>
            {patient.data.patientCode}
            {step !== "visit" && typePicked ? ` · ${label(type)}` : ""}
            {plan && step !== "details" ? ` · ${plan.title}` : ""}
            {walkIn && step !== "visit" ? " · Walk-in" : ""}
          </Muted>
        </Card>
      ) : null}

      {/* 1. Patient */}
      {step === "patient" ? (
        <Card>
          <H2>Who is the appointment for?</H2>
          {registering ? (
            <QuickPatientForm
              onCreated={(id) => {
                setRegistering(false);
                setPatientChoice(id);
                setStep("visit");
              }}
              onCancel={() => setRegistering(false)}
            />
          ) : (
            <>
              <Input value={search} onChangeText={setSearch} placeholder="Search name, phone or MH-P code" autoCorrect={false} />
              {patients.isLoading ? (
                <Loading />
              ) : (
                (patients.data?.data ?? []).map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      setPatientChoice(p.id);
                      setPlanChoice(null);
                      setPkgChoice(null);
                      setAddressChoice(null);
                      setTherapistChoice(null);
                      resetSlot();
                      setStep("visit");
                    }}
                    accessibilityRole="button"
                    style={styles.pick}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Row style={{ justifyContent: "space-between" }}>
                        <Text weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{fullName(p)}</Text>
                        <CategoryBadge visits={p.visits} />
                      </Row>
                      <Muted style={{ fontSize: 12 }}>{p.patientCode}{ageFrom(p.dateOfBirth) !== null ? ` · ${ageFrom(p.dateOfBirth)} yrs` : ""}{p.primaryTherapist ? ` · ${p.primaryTherapist.user.name}` : ""}</Muted>
                      <VisitLine visits={p.visits} />
                    </View>
                  </Pressable>
                ))
              )}
              {patients.data?.data.length === 0 ? <Muted style={{ fontSize: 12 }}>No patient found.</Muted> : null}
              <Button title="Register new patient" variant="ghost" icon="person-add-outline" onPress={() => setRegistering(true)} />
            </>
          )}
        </Card>
      ) : null}

      {/* 2. Visit type — picking one moves on */}
      {step === "visit" ? (
        <Card>
          <H2>What kind of visit?</H2>
          {TYPES.map((t) => {
            const on = typePicked === t.value;
            return (
              <Pressable
                key={t.value}
                onPress={() => {
                  setTypeChoice(t.value);
                  setTherapistChoice(null);
                  setDayChoice(null);
                  resetSlot();
                  setStep(t.value === "INITIAL_CONSULTATION" ? "time" : "details");
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.typeRow, on && styles.typeOn]}
              >
                <View style={{ flex: 1 }}>
                  <Text weight="semibold" style={{ color: colors.navy700 }}>{t.label}</Text>
                  <Muted style={{ fontSize: 12 }}>{t.hint}</Muted>
                </View>
                <Text style={{ color: colors.gold700, fontSize: 18 }}>›</Text>
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {/* 3. Details for this visit type */}
      {step === "details" ? (
        <Card>
          <H2>{label(type)} details</H2>

          {creatingPlan ? (
            <>
              <Text weight="semibold">New treatment plan</Text>
              <QuickPlanForm
                patientId={patientId}
                onCreated={(id) => {
                  setCreatingPlan(false);
                  setPlanChoice(id);
                  setTherapistChoice(null);
                  void plans.refetch();
                }}
                onCancel={() => setCreatingPlan(false)}
              />
            </>
          ) : (
            <Field label={`Treatment plan${needsPlan ? " *" : " (optional)"}`}>
              {plans.isLoading ? (
                <Loading />
              ) : (
                <View style={{ gap: space.sm }}>
                  {planList.length ? (
                    <Chips
                      value={planId}
                      onChange={(v) => {
                        setPlanChoice(v);
                        setTherapistChoice(null);
                        resetSlot();
                      }}
                      options={[...(needsPlan ? [] : [{ value: "", label: "None" }]), ...planList.map((p) => ({ value: p.id, label: `${p.title} · ${p.therapist.user.name}` }))]}
                    />
                  ) : (
                    <Muted style={{ fontSize: 12 }}>No active treatment plan yet.</Muted>
                  )}
                  <Button title={planList.length ? "Create another plan" : "Create treatment plan"} variant="ghost" small icon="add-circle-outline" onPress={() => setCreatingPlan(true)} />
                </View>
              )}
            </Field>
          )}

          {!creatingPlan && usesPackage && pkgList.length ? (
            <Field label="Payment">
              <Chips value={packageId} onChange={setPkgChoice} options={[{ value: "", label: "Pay per visit" }, ...pkgList.map((p) => ({ value: p.id, label: `${p.package.name} · ${p.remainingSessions} left` }))]} />
            </Field>
          ) : null}

          {!creatingPlan && type === "HOME_VISIT" ? (
            <Field label="Visit address *">
              {addingAddress ? (
                <QuickAddressForm
                  patientId={patientId}
                  onCreated={(id) => {
                    setAddingAddress(false);
                    setAddressChoice(id);
                  }}
                  onCancel={() => setAddingAddress(false)}
                />
              ) : (
                <View style={{ gap: space.sm }}>
                  {addresses.length ? (
                    <Chips value={addressId} onChange={setAddressChoice} options={addresses.map((a) => ({ value: a.id, label: `${a.label}: ${a.line1}` }))} />
                  ) : (
                    <Muted style={{ fontSize: 12 }}>No address on file yet.</Muted>
                  )}
                  <Button title="Add address" variant="ghost" small icon="location-outline" onPress={() => setAddingAddress(true)} />
                </View>
              )}
            </Field>
          ) : null}

          {!creatingPlan && !addingAddress ? (
            <>
              {detailsProblem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{detailsProblem}</Muted> : null}
              <Button title="Next: date & time" icon="arrow-forward-outline" onPress={next} disabled={!!detailsProblem} />
            </>
          ) : null}
        </Card>
      ) : null}

      {/* 4. Physio, date & time — picking a time moves on */}
      {step === "time" ? (
        <Card>
          <H2>{rescheduleId ? "New date & time" : "Physiotherapist & time"}</H2>
          {!rescheduleId && type !== "HOME_VISIT" ? (
            <Chips<"ahead" | "walkin">
              value={walkIn ? "walkin" : "ahead"}
              onChange={(v) => {
                setWalkIn(v === "walkin");
                setDayChoice(null);
                resetSlot();
              }}
              options={[{ value: "ahead", label: "Booked ahead" }, { value: "walkin", label: "Walk-in (here now)" }]}
            />
          ) : null}
          {walkIn ? <Muted style={{ fontSize: 12 }}>Today only. The patient is checked in as soon as you book, and the slot that is running now can be used.</Muted> : null}
          {slotGone ? (
            <Muted style={{ fontSize: 12, color: colors.warning }}>{slotGone}</Muted>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            <Pressable onPress={() => { setTherapistChoice(""); setDayChoice(null); resetSlot(); }} style={[styles.chip, !therapistId && styles.chipOn]}>
              <Text weight="semibold" style={{ fontSize: 13, color: !therapistId ? colors.white : colors.navy700 }}>Any physio</Text>
            </Pressable>
            {(therapists.data ?? []).map((t) => {
              const on = therapistId === t.id;
              return (
                <Pressable key={t.id} onPress={() => { setTherapistChoice(t.id); setDayChoice(null); resetSlot(); }} style={[styles.chip, on && styles.chipOn]}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colorTag ?? colors.gold500 }} />
                  <Text weight="semibold" style={{ fontSize: 13, color: on ? colors.white : colors.navy700 }}>{t.user.name}</Text>
                  {plan?.therapist.id === t.id ? <Text weight="bold" style={{ fontSize: 9, color: on ? colors.gold300 : colors.gold700 }}>PLAN</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {walkIn ? null : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 2 }}>
            {summary.isLoading ? <Loading /> : null}
            {(summary.data ?? []).map(({ date: d, free }) => {
              const on = d === day;
              const p = dayParts(d);
              return (
                <Pressable key={d} onPress={() => { setDayChoice(d); resetSlot(); }} accessibilityRole="button" accessibilityLabel={`${p.weekday} ${p.day} ${p.month}, ${free} free`} style={[styles.day, on && styles.dayOn, !free && !on && styles.dayFull]}>
                  <Text style={{ fontSize: 11, color: on ? colors.gold300 : colors.muted }}>{p.weekday}</Text>
                  <Text weight="bold" style={{ fontSize: 18, color: on ? colors.white : colors.navy700 }}>{p.day}</Text>
                  <Text style={{ fontSize: 10, color: on ? colors.navy100 : free ? colors.success : colors.muted }}>{free ? `${free} free` : "Full"}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          )}

          <SlotLegend />
          {avail.isLoading ? (
            <Loading />
          ) : avail.error ? (
            <ErrorBox error={avail.error} onRetry={() => avail.refetch()} />
          ) : freeCount === 0 ? (
            <Empty
              icon="time-outline"
              title={walkIn ? "No free time left today" : summary.data && !firstFree ? "No free times in the next 2 weeks" : "No free times this day"}
              message={walkIn ? "Every physio is booked for the rest of today. Book the patient ahead instead." : therapistId ? "Pick a green day or choose “Any physio”." : summary.data && !firstFree ? "Generate more slots for the physios in Therapists." : "Pick a day marked in green."}
            />
          ) : (
            (avail.data ?? [])
              .filter((t) => t.slots.length || t.taken?.length)
              .map((t) => {
                // Free and taken times in one grid, so the day reads like the whiteboard.
                const cells = [
                  ...t.slots.map((s) => ({ key: s.slotId, slotId: s.slotId as string | null, startAt: s.startAt, state: "free" as const })),
                  ...(t.taken ?? []).map((s) => ({ key: s.startAt, slotId: null, startAt: s.startAt, state: s.status === "BOOKED" ? ("booked" as const) : ("off" as const) })),
                ].sort((a, b) => a.startAt.localeCompare(b.startAt));
                return (
                  <View key={t.therapistId} style={{ gap: space.sm, marginTop: space.xs }}>
                    <Row gap={6}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colorTag ?? colors.gold500 }} />
                      <Text weight="semibold" style={{ flex: 1 }}>{t.therapistName}</Text>
                      {t.onLeave ? <Badge status="CANCELLED" text="On leave" /> : !t.slots.length ? <Badge status="NO_SHOW" text="Full" /> : <Muted style={{ fontSize: 12 }}>{t.slots.length} free{t.counts ? ` · ${t.counts.booked} booked` : ""}</Muted>}
                    </Row>
                    {PERIODS.map(({ key, test }) => {
                      const list = cells.filter((s) => test(clinicHour(s.startAt)));
                      if (!list.length) return null;
                      return (
                        <View key={key} style={{ gap: 6 }}>
                          <Muted style={{ fontSize: 11 }}>{key.toUpperCase()}</Muted>
                          <View style={styles.slots}>
                            {list.map((s) => {
                              const on = !!s.slotId && slot?.id === s.slotId;
                              const free = s.state === "free";
                              return (
                                <Pressable
                                  key={s.key}
                                  disabled={!free}
                                  onPress={() => {
                                    if (!s.slotId) return;
                                    setSlot({ id: s.slotId, startAt: s.startAt, therapist: t.therapistName, therapistId: t.therapistId });
                                    setSlotGone(null);
                                    setRepeatDays(null);
                                    setPickedDates(null);
                                    setTimePick({});
                                    setStep("confirm");
                                  }}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: on, disabled: !free }}
                                  accessibilityLabel={`${time(s.startAt)} ${free ? "available" : s.state === "booked" ? "booked" : "unavailable"}`}
                                  style={[styles.slot, free ? slotStyles.free : s.state === "booked" ? slotStyles.booked : slotStyles.off, on && slotStyles.selected]}
                                >
                                  <Text weight="semibold" style={{ fontSize: 13, color: on ? colors.white : free ? colors.navy700 : colors.muted, textDecorationLine: free ? "none" : "line-through" }}>{time(s.startAt)}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                );
              })
          )}
        </Card>
      ) : null}

      {/* 5. Confirm */}
      {step === "confirm" ? (
        <Card gold>
          <H2>Confirm</H2>
          <KeyValue k="Patient" v={patient.data ? fullName(patient.data) : original.data ? fullName(original.data.patient) : "—"} />
          <KeyValue k="Visit" v={label(type)} />
          {!rescheduleId ? <KeyValue k="Source" v={walkIn ? "Walk-in (checked in on booking)" : "Booked ahead"} /> : null}
          {!rescheduleId && !isConsult ? <KeyValue k="Plan" v={plan?.title ?? (needsPlan ? "Required" : "None")} /> : null}
          {type === "HOME_VISIT" && !rescheduleId ? <KeyValue k="Address" v={addresses.find((a) => a.id === addressId)?.line1 ?? "—"} /> : null}
          <KeyValue k="When" v={slot ? `${date(slot.startAt)}, ${time(slot.startAt)}` : "—"} />
          <KeyValue k="Physio" v={slot?.therapist ?? "—"} />
          {canRepeat && slot ? (
            <View style={{ gap: space.sm }}>
              <Chips<"once" | "weekly" | "dates">
                value={mode}
                onChange={setMode}
                options={[
                  { value: "once", label: "One session" },
                  { value: "weekly", label: "Repeat weekly" },
                  { value: "dates", label: "Pick dates" },
                ]}
              />
              {byDates ? (
                <>
                  <Field label={`Tap the dates you want · ${picked.length} selected`}>
                    <MultiDateCalendar selected={picked} onToggle={togglePicked} min={pickMin} max={pickMax} />
                  </Field>
                  <Muted style={{ fontSize: 12 }}>Each date starts at {time(slot.startAt)} with {slot.therapist}. Tap another time to change it for that date, or tap the date on the calendar again to remove it.</Muted>
                  {!picked.length ? (
                    <Muted style={{ fontSize: 12, color: colors.warning }}>Pick at least one date.</Muted>
                  ) : preview.error ? (
                    <ErrorBox error={preview.error} onRetry={() => preview.refetch()} />
                  ) : (
                    <View style={{ gap: space.md }}>
                      {datePlans.map((p) => (
                        <View key={p.date} style={{ gap: 6 }}>
                          <Row style={{ justifyContent: "space-between" }}>
                            <Text weight="semibold" style={{ color: colors.navy700 }}>{dayParts(p.date).weekday}, {date(`${p.date}T06:00:00Z`)}</Text>
                            {p.slotId ? (
                              <Text weight="bold" style={{ color: colors.success }}>✓ {time(p.free.find((f) => f.slotId === p.slotId)?.startAt ?? preview.data?.items.find((x) => x.slotId === p.slotId)?.startAt)}</Text>
                            ) : p.loading ? null : (
                              <Muted style={{ fontSize: 12, color: colors.warning }}>Pick a time</Muted>
                            )}
                          </Row>
                          {p.loading && !p.free.length ? (
                            <Muted style={{ fontSize: 12 }}>Loading times…</Muted>
                          ) : !p.free.length ? (
                            <Muted style={{ fontSize: 12, color: colors.warning }}>{slot.therapist} has no free times this day.</Muted>
                          ) : (
                            <View style={styles.slots}>
                              {p.free.map((f) => {
                                const on = p.slotId === f.slotId;
                                return (
                                  <Pressable
                                    key={f.slotId}
                                    onPress={() => setTimePick((m) => ({ ...m, [p.date]: f.slotId }))}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: on }}
                                    accessibilityLabel={`${time(f.startAt)} on ${p.date}`}
                                    style={[styles.slot, slotStyles.free, on && slotStyles.selected]}
                                  >
                                    <Text weight="semibold" style={{ fontSize: 13, color: on ? colors.white : colors.navy700 }}>{time(f.startAt)}</Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      ))}
                      <Muted style={{ fontSize: 12 }}>{availableCount} of {picked.length} dates have a time. Only those will be booked.</Muted>
                      {preview.data && preview.data.packageRemaining !== null && availableCount > preview.data.packageRemaining ? (
                        <Muted style={{ fontSize: 12, color: colors.warning }}>
                          The package has only {preview.data.packageRemaining} session{preview.data.packageRemaining === 1 ? "" : "s"} left — sessions beyond that will need to be paid per visit.
                        </Muted>
                      ) : null}
                    </View>
                  )}
                </>
              ) : mode === "weekly" ? (
                <>
                  <Field label="On these days">
                    <View style={styles.multi}>
                      {WEEKDAYS.map((d) => {
                        const on = days.includes(d.value);
                        return (
                          <Pressable key={d.value} onPress={() => toggleDay(d.value)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.dayChip, on && styles.dayChipOn]}>
                            <Text weight="semibold" style={{ fontSize: 13, color: on ? colors.white : colors.navy700 }}>{d.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </Field>
                  <Field label={`For ${weeks} week${weeks === 1 ? "" : "s"}`}>
                    <Row gap={space.sm}>
                      <Button title="−" variant="ghost" small onPress={() => setWeeksChoice(Math.max(1, weeks - 1))} disabled={weeks <= 1} />
                      <Text weight="bold" style={{ minWidth: 28, textAlign: "center", color: colors.navy700 }}>{weeks}</Text>
                      <Button title="+" variant="ghost" small onPress={() => setWeeksChoice(Math.min(12, weeks + 1))} disabled={weeks >= 12} />
                      <Muted style={{ fontSize: 12, flex: 1 }}>Same time ({time(slot.startAt)}) with {slot.therapist}</Muted>
                    </Row>
                  </Field>
                  {!days.length ? (
                    <Muted style={{ fontSize: 12, color: colors.warning }}>Pick at least one day.</Muted>
                  ) : preview.isLoading ? (
                    <Loading label="Checking dates…" />
                  ) : preview.error ? (
                    <ErrorBox error={preview.error} onRetry={() => preview.refetch()} />
                  ) : preview.data ? (
                    <View style={{ gap: 4 }}>
                      {preview.data.items.map((i) => (
                        <Row key={i.date} style={{ justifyContent: "space-between" }}>
                          <Text style={{ color: i.ok ? colors.navy700 : colors.muted }}>{date(i.startAt)}, {time(i.startAt)}</Text>
                          {i.ok ? (
                            <Text weight="bold" style={{ color: colors.success }}>✓</Text>
                          ) : (
                            <Muted style={{ fontSize: 12, color: colors.warning, flexShrink: 1, textAlign: "right", marginLeft: space.sm }}>{i.reason}</Muted>
                          )}
                        </Row>
                      ))}
                      <Muted style={{ fontSize: 12 }}>{preview.data.available} of {preview.data.items.length} dates are free. Only the free ones will be booked.</Muted>
                      {preview.data.packageRemaining !== null && preview.data.available > preview.data.packageRemaining ? (
                        <Muted style={{ fontSize: 12, color: colors.warning }}>
                          The package has only {preview.data.packageRemaining} session{preview.data.packageRemaining === 1 ? "" : "s"} left — sessions beyond that will need to be paid per visit.
                        </Muted>
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}
          {!rescheduleId ? (
            <Field label="Notes (optional)">
              <Input value={notes} onChangeText={setNotes} multiline maxLength={500} placeholder="Reason for visit, special requests" />
            </Field>
          ) : null}
          <ErrorBox error={book.error} />
          {missing ? <Muted style={{ fontSize: 12, color: colors.warning }}>{missing}</Muted> : null}
          <Button
            title={rescheduleId ? "Move appointment" : repeating ? `Book ${repeatSlotIds.length} session${repeatSlotIds.length === 1 ? "" : "s"}` : "Confirm booking"}
            icon="checkmark-circle-outline"
            onPress={() => book.mutate()}
            disabled={!!missing || (repeating && (!repeatSlotIds.length || preview.isFetching))}
            loading={book.isPending}
          />
          <Button title="Change time" variant="ghost" small onPress={() => setStep("time")} />
        </Card>
      ) : null}
    </Screen>
  );
}

/* ─────────── Inline forms so booking never has to stop ─────────── */

type Gender = "MALE" | "FEMALE" | "OTHER";

function QuickPatientForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ firstName: "", lastName: "", phone: "", dateOfBirth: "" });
  const [gender, setGender] = useState<Gender>("FEMALE");
  const [patientType, setPatientType] = useState<"REGULAR" | "WALK_IN">("REGULAR");
  const ownTherapist = useOwnTherapistId();
  const [physio, setPhysio] = useState<string | null>(null);
  const primaryTherapistId = physio ?? ownTherapist;
  const save = useAction(
    () =>
      api.post<{ id: string }>("/patients", {
        firstName: f.firstName.trim() || undefined,
        lastName: f.lastName.trim() || undefined,
        gender,
        patientType,
        dateOfBirth: f.dateOfBirth || undefined,
        phone: f.phone.trim(),
        primaryTherapistId: primaryTherapistId || null,
        consentGiven: true,
      }),
    { refresh: ["patients"], onSuccess: (p) => onCreated(p.id) },
  );
  const problem = f.phone.replace(/\D/g, "").length < 10 ? "Enter a valid 10-digit mobile number" : null;
  const server = fieldErrors(save.error); // e.g. "This mobile number is already in use"

  return (
    <View style={{ gap: space.md }}>
      <Row gap={space.sm}>
        <View style={{ flex: 1 }}><Field label="First name"><Input value={f.firstName} onChangeText={(t) => setF({ ...f, firstName: t })} autoFocus /></Field></View>
        <View style={{ flex: 1 }}><Field label="Last name"><Input value={f.lastName} onChangeText={(t) => setF({ ...f, lastName: t })} /></Field></View>
      </Row>
      <Field label="Mobile *" error={server.phone}><Input value={f.phone} onChangeText={(t) => setF({ ...f, phone: t })} keyboardType="phone-pad" placeholder="98765 43210" /></Field>
      <Field label="Patient type">
        <Chips<"REGULAR" | "WALK_IN"> value={patientType} onChange={setPatientType} options={[{ value: "REGULAR", label: "Regular" }, { value: "WALK_IN", label: "Walk-in" }]} />
      </Field>
      <Field label="Gender">
        <Chips<Gender> value={gender} onChange={setGender} options={[{ value: "FEMALE", label: "Female" }, { value: "MALE", label: "Male" }, { value: "OTHER", label: "Other" }]} />
      </Field>
      <DobAgeFields dob={f.dateOfBirth} onDob={(v) => setF({ ...f, dateOfBirth: v })} />
      <RegularPhysioField value={primaryTherapistId} onChange={setPhysio} />
      <ErrorBox error={save.error} />
      {problem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
      <Row>
        <Button title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button title="Register & continue" onPress={() => save.mutate()} disabled={!!problem} loading={save.isPending} style={{ flex: 1 }} />
      </Row>
    </View>
  );
}

function QuickAddressForm({ patientId, onCreated, onCancel }: { patientId: string; onCreated: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ line1: "", city: "", state: "", pincode: "" });
  const save = useAction(
    () => api.post<{ id: string }>(`/patients/${patientId}/addresses`, { label: "Home", line1: f.line1.trim(), city: f.city.trim(), state: f.state.trim(), pincode: f.pincode.trim(), isDefault: true }),
    {
      // The new address must be in the patient record before it's selected, so wait for it.
      onSuccess: (a) => void qc.invalidateQueries({ queryKey: qk.patient(patientId) }).then(() => onCreated(a.id)),
    },
  );
  const problem = f.line1.trim().length < 2 ? "Enter the address" : !f.city.trim() ? "Enter the city" : !f.state.trim() ? "Enter the state" : !/^\d{6}$/.test(f.pincode.trim()) ? "Enter a 6-digit pincode" : null;

  return (
    <View style={{ gap: space.sm }}>
      <Input value={f.line1} onChangeText={(t) => setF({ ...f, line1: t })} placeholder="House / street" autoFocus />
      <Row gap={space.sm}>
        <View style={{ flex: 1 }}><Input value={f.city} onChangeText={(t) => setF({ ...f, city: t })} placeholder="City" /></View>
        <View style={{ flex: 1 }}><Input value={f.state} onChangeText={(t) => setF({ ...f, state: t })} placeholder="State" /></View>
      </Row>
      <Input value={f.pincode} onChangeText={(t) => setF({ ...f, pincode: t.replace(/\D/g, "").slice(0, 6) })} placeholder="Pincode" keyboardType="number-pad" />
      <ErrorBox error={save.error} />
      {problem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
      <Row>
        <Button title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button title="Save address" onPress={() => save.mutate()} disabled={!!problem} loading={save.isPending} style={{ flex: 1 }} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  pick: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  stepper: { flexDirection: "row" },
  stepItem: { flex: 1, alignItems: "center", gap: 4 },
  stepTrack: { flexDirection: "row", alignItems: "center", width: "100%" },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.border },
  stepLineOn: { backgroundColor: colors.gold500 },
  stepDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  stepDotOn: { backgroundColor: colors.gold500, borderColor: colors.gold500 },
  typeRow: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  typeOn: { borderColor: colors.gold500, backgroundColor: colors.gold100 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.navy700, borderColor: colors.navy700 },
  day: { width: 60, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", backgroundColor: colors.white },
  dayOn: { backgroundColor: colors.navy700, borderColor: colors.navy700 },
  dayFull: { backgroundColor: "#DDE1EC", borderColor: colors.divider },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  slot: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, minWidth: 86, alignItems: "center" },
  slotOn: { backgroundColor: colors.navy700, borderColor: colors.navy700 },
  multi: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, minWidth: 48, alignItems: "center" },
  dayChipOn: { backgroundColor: colors.navy700, borderColor: colors.navy700 },
});
