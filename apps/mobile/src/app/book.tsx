import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Button, Card, Chips, Empty, ErrorBox, Field, H2, Input, KeyValue, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { date, dayParts, fullName, label, time, today } from "@/lib/format";
import type { Appointment, AppointmentType, AvailabilityRow, PatientDetail, PatientListItem, PatientPackage, Therapist, TreatmentPlan } from "@/lib/types";
import { colors, radius, space } from "@/theme";

const TYPES: { value: AppointmentType; label: string }[] = [
  { value: "INITIAL_CONSULTATION", label: "First consultation" },
  { value: "FOLLOW_UP_CONSULTATION", label: "Follow-up" },
  { value: "THERAPY_SESSION", label: "Therapy session" },
  { value: "HOME_VISIT", label: "Home visit" },
];
const DAYS = 14;
const clinicHour = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).getUTCHours();
const PERIODS = [
  { key: "Morning", test: (h: number) => h < 12 },
  { key: "Afternoon", test: (h: number) => h >= 12 && h < 17 },
  { key: "Evening", test: (h: number) => h >= 17 },
];

/**
 * Staff booking (reception / admin): patient → visit → physio & time → confirm.
 * Opened with ?patientId=… from a patient, or ?reschedule=<appointmentId> to move a visit.
 * Choices use "null = not chosen" so defaults are derived, not copied by effects.
 */
export default function Book() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const params = useLocalSearchParams<{ reschedule?: string; patientId?: string; type?: string }>();
  const rescheduleId = typeof params.reschedule === "string" ? params.reschedule : undefined;
  const fixedPatient = typeof params.patientId === "string" ? params.patientId : undefined;

  const original = useQuery({ queryKey: ["appointment", rescheduleId], queryFn: () => api.get<Appointment>(`/appointments/${rescheduleId}`), enabled: !!rescheduleId });

  const [search, setSearch] = useState("");
  const [patientChoice, setPatientChoice] = useState<string | null>(null);
  const [typeChoice, setTypeChoice] = useState<AppointmentType | null>(null);
  const [planChoice, setPlanChoice] = useState<string | null>(null);
  const [pkgChoice, setPkgChoice] = useState<string | null>(null);
  const [addressChoice, setAddressChoice] = useState<string | null>(null);
  const [therapistChoice, setTherapistChoice] = useState<string | null>(null);
  const [day, setDay] = useState(today());
  const [slot, setSlot] = useState<{ id: string; startAt: string; therapist: string } | null>(null);
  const [notes, setNotes] = useState("");

  const patientId = original.data?.patient.id ?? fixedPatient ?? patientChoice ?? "";
  const initialType = TYPES.some((t) => t.value === params.type) ? (params.type as AppointmentType) : "INITIAL_CONSULTATION";
  const type: AppointmentType = original.data?.type ?? typeChoice ?? initialType;
  const isConsult = type === "INITIAL_CONSULTATION";
  const needsPlan = type === "THERAPY_SESSION";
  const usesPackage = type === "THERAPY_SESSION" || type === "HOME_VISIT";

  const patients = useQuery({
    queryKey: ["patients", "book", search],
    queryFn: () => api.page<PatientListItem>("/patients", { search: search.trim() || undefined, limit: 8 }),
    enabled: !patientId && !rescheduleId,
  });
  const patient = useQuery({ queryKey: ["patient", patientId], queryFn: () => api.get<PatientDetail>(`/patients/${patientId}`), enabled: !!patientId });
  const plans = useQuery({ queryKey: ["plans", patientId, "active"], queryFn: () => api.page<TreatmentPlan>("/treatment-plans", { patientId, status: "ACTIVE" }), enabled: !!patientId && !rescheduleId });
  const pkgs = useQuery({ queryKey: ["patient-packages", patientId, "active"], queryFn: () => api.page<PatientPackage>("/patient-packages", { patientId, status: "ACTIVE" }), enabled: !!patientId && !rescheduleId });
  const therapists = useQuery({ queryKey: ["therapists", type === "HOME_VISIT"], queryFn: () => api.get<Therapist[]>("/therapists", { homeVisit: type === "HOME_VISIT" || undefined }) });

  const planList = useMemo(() => plans.data?.data ?? [], [plans.data]);
  const pkgList = useMemo(() => pkgs.data?.data ?? [], [pkgs.data]);
  const addresses = useMemo(() => patient.data?.addresses ?? [], [patient.data]);
  const planId = isConsult ? "" : planChoice ?? (planList.length === 1 ? planList[0].id : "");
  const plan = planList.find((p) => p.id === planId);
  const packageId = !usesPackage ? "" : pkgChoice ?? (needsPlan && pkgList.length === 1 ? pkgList[0].id : "");
  const addressId = addressChoice ?? (addresses.find((a) => a.isDefault) ?? addresses[0])?.id ?? "";
  const wanted = therapistChoice ?? plan?.therapist.id ?? original.data?.therapist.id ?? "";
  const therapistId = !wanted || (therapists.data ?? []).some((t) => t.id === wanted) ? wanted : "";

  const summary = useQuery({
    queryKey: ["availability-summary", type, therapistId],
    queryFn: () => api.get<{ date: string; free: number }[]>("/availability/summary", { from: today(), days: DAYS, type, therapistId: therapistId || undefined }),
  });
  const avail = useQuery({
    queryKey: ["availability", day, type, therapistId],
    queryFn: () => api.get<AvailabilityRow[]>("/availability", { date: day, type, therapistId: therapistId || undefined }),
  });
  const freeCount = (avail.data ?? []).reduce((n, t) => n + t.slots.length, 0);

  const book = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!slot) throw new Error("Choose a time");
      if (rescheduleId) return (await api.post<{ id: string }>(`/appointments/${rescheduleId}/reschedule`, { newSlotId: slot.id })).id;
      const base = { patientId, slotId: slot.id, treatmentPlanId: planId || undefined, patientPackageId: packageId || undefined, notes: notes.trim() || undefined };
      if (type === "HOME_VISIT") return (await api.post<{ appointmentId: string }>("/home-visits", { ...base, addressId })).appointmentId;
      return (await api.post<{ id: string }>("/appointments", { ...base, type })).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["availability"] });
      qc.invalidateQueries({ queryKey: ["availability-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      router.replace({ pathname: "/appointment/[id]", params: { id } });
    },
  });

  const missing = !rescheduleId && !patientId
    ? "Choose the patient"
    : !rescheduleId && needsPlan && !planId
      ? "Therapy sessions need an active treatment plan"
      : !rescheduleId && type === "HOME_VISIT" && !addressId
        ? "The patient has no address for a home visit"
        : !slot
          ? "Choose a date and time"
          : null;

  if (!hasRole(user, "ADMIN", "RECEPTIONIST")) {
    return (
      <Screen edges={["top", "bottom"]}>
        <TopBar title="Book appointment" onBack={() => router.back()} />
        <Empty icon="lock-closed-outline" title="Reception or admin only" message="Ask the front desk to book or move appointments." />
      </Screen>
    );
  }

  const resetSlot = () => setSlot(null);

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title={rescheduleId ? "Reschedule" : "Book appointment"} onBack={() => (router.canGoBack() ? router.back() : router.replace("/appointments"))} />

      {rescheduleId && original.data ? (
        <Card style={{ backgroundColor: colors.navy50 }}>
          <Text weight="semibold">{fullName(original.data.patient)} · {label(original.data.type)}</Text>
          <Muted>Now: {date(original.data.startAt)}, {time(original.data.startAt)} with {original.data.therapist.user.name}</Muted>
        </Card>
      ) : null}

      {/* 1. Patient */}
      {!rescheduleId ? (
        <Card>
          <H2>1. Patient</H2>
          {patientId ? (
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text weight="semibold">{patient.data ? fullName(patient.data) : "Loading…"}</Text>
                {patient.data ? <Muted style={{ fontSize: 12 }}>{patient.data.patientCode} · {patient.data.phone}</Muted> : null}
              </View>
              {!fixedPatient ? (
                <Button
                  title="Change"
                  variant="ghost"
                  small
                  onPress={() => {
                    setPatientChoice(null);
                    setPlanChoice(null);
                    setPkgChoice(null);
                    setAddressChoice(null);
                    setTherapistChoice(null);
                    resetSlot();
                  }}
                />
              ) : null}
            </Row>
          ) : (
            <>
              <Input value={search} onChangeText={setSearch} placeholder="Search name, phone or MH-P code" autoCorrect={false} />
              {patients.isLoading ? (
                <Loading />
              ) : (
                (patients.data?.data ?? []).map((p) => (
                  <Pressable key={p.id} onPress={() => setPatientChoice(p.id)} accessibilityRole="button" style={styles.pick}>
                    <Text weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{fullName(p)}</Text>
                    <Muted style={{ fontSize: 12 }}>{p.patientCode}</Muted>
                  </Pressable>
                ))
              )}
              {patients.data?.data.length === 0 ? <Muted style={{ fontSize: 12 }}>No match. Register new patients on the web portal.</Muted> : null}
            </>
          )}
        </Card>
      ) : null}

      {/* 2. Visit */}
      {!rescheduleId ? (
        <Card>
          <H2>2. Visit</H2>
          <Chips<AppointmentType>
            value={type}
            onChange={(v) => {
              setTypeChoice(v);
              setTherapistChoice(null);
              resetSlot();
            }}
            options={TYPES}
          />
          {isConsult ? <Muted style={{ fontSize: 12 }}>The physiotherapist writes the treatment plan during this visit.</Muted> : null}
          {!isConsult && patientId ? (
            <Field label={`Treatment plan${needsPlan ? " *" : " (optional)"}`}>
              {plans.isLoading ? (
                <Loading />
              ) : planList.length ? (
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
                <Muted style={{ fontSize: 12 }}>No active plan. Book a first consultation instead.</Muted>
              )}
            </Field>
          ) : null}
          {usesPackage && pkgList.length ? (
            <Field label="Payment">
              <Chips value={packageId} onChange={setPkgChoice} options={[{ value: "", label: "Pay per visit" }, ...pkgList.map((p) => ({ value: p.id, label: `${p.package.name} · ${p.remainingSessions} left` }))]} />
            </Field>
          ) : null}
          {type === "HOME_VISIT" && patientId ? (
            <Field label="Visit address">
              {addresses.length ? (
                <Chips value={addressId} onChange={setAddressChoice} options={addresses.map((a) => ({ value: a.id, label: `${a.label}: ${a.line1}` }))} />
              ) : (
                <Muted style={{ fontSize: 12 }}>No address on file. Add one on the web portal.</Muted>
              )}
            </Field>
          ) : null}
        </Card>
      ) : null}

      {/* 3. Physio, date & time */}
      <Card>
        <H2>{rescheduleId ? "New date & time" : "3. Physiotherapist & time"}</H2>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          <Pressable onPress={() => { setTherapistChoice(""); resetSlot(); }} style={[styles.chip, !therapistId && styles.chipOn]}>
            <Text weight="semibold" style={{ fontSize: 13, color: !therapistId ? colors.white : colors.navy700 }}>Any physio</Text>
          </Pressable>
          {(therapists.data ?? []).map((t) => {
            const on = therapistId === t.id;
            return (
              <Pressable key={t.id} onPress={() => { setTherapistChoice(t.id); resetSlot(); }} style={[styles.chip, on && styles.chipOn]}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colorTag ?? colors.gold500 }} />
                <Text weight="semibold" style={{ fontSize: 13, color: on ? colors.white : colors.navy700 }}>{t.user.name}</Text>
                {plan?.therapist.id === t.id ? <Text weight="bold" style={{ fontSize: 9, color: on ? colors.gold300 : colors.gold700 }}>PLAN</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 2 }}>
          {summary.isLoading ? <Loading /> : null}
          {(summary.data ?? []).map(({ date: d, free }) => {
            const on = d === day;
            const p = dayParts(d);
            return (
              <Pressable key={d} onPress={() => { setDay(d); resetSlot(); }} accessibilityRole="button" accessibilityLabel={`${p.weekday} ${p.day} ${p.month}, ${free} free`} style={[styles.day, on && styles.dayOn, !free && !on && styles.dayFull]}>
                <Text style={{ fontSize: 11, color: on ? colors.gold300 : colors.muted }}>{p.weekday}</Text>
                <Text weight="bold" style={{ fontSize: 18, color: on ? colors.white : colors.navy700 }}>{p.day}</Text>
                <Text style={{ fontSize: 10, color: on ? colors.navy100 : free ? colors.success : colors.muted }}>{free ? `${free} free` : "Full"}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {avail.isLoading ? (
          <Loading />
        ) : avail.error ? (
          <ErrorBox error={avail.error} onRetry={() => avail.refetch()} />
        ) : freeCount === 0 ? (
          <Empty icon="time-outline" title="No free times this day" message={therapistId ? "Pick a green day or choose “Any physio”." : "Pick a day marked in green."} />
        ) : (
          (avail.data ?? [])
            .filter((t) => t.slots.length)
            .map((t) => (
              <View key={t.therapistId} style={{ gap: space.sm, marginTop: space.xs }}>
                <Row gap={6}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colorTag ?? colors.gold500 }} />
                  <Text weight="semibold">{t.therapistName}</Text>
                </Row>
                {PERIODS.map(({ key, test }) => {
                  const list = t.slots.filter((s) => test(clinicHour(s.startAt)));
                  if (!list.length) return null;
                  return (
                    <View key={key} style={{ gap: 6 }}>
                      <Muted style={{ fontSize: 11 }}>{key.toUpperCase()}</Muted>
                      <View style={styles.slots}>
                        {list.map((s) => {
                          const on = slot?.id === s.slotId;
                          return (
                            <Pressable key={s.slotId} onPress={() => setSlot({ id: s.slotId, startAt: s.startAt, therapist: t.therapistName })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.slot, on && styles.slotOn]}>
                              <Text weight="semibold" style={{ fontSize: 13, color: on ? colors.white : colors.navy700 }}>{time(s.startAt)}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))
        )}
      </Card>

      {!rescheduleId ? (
        <Card>
          <Field label="Notes (optional)">
            <Input value={notes} onChangeText={setNotes} multiline maxLength={500} placeholder="Reason for visit, special requests" />
          </Field>
        </Card>
      ) : null}

      <Card gold>
        <H2>Summary</H2>
        <KeyValue k="Patient" v={patient.data ? fullName(patient.data) : original.data ? fullName(original.data.patient) : "—"} />
        <KeyValue k="Visit" v={label(type)} />
        <KeyValue k="When" v={slot ? `${date(slot.startAt)}, ${time(slot.startAt)}` : "—"} />
        <KeyValue k="Physio" v={slot?.therapist ?? "—"} />
        {!rescheduleId && !isConsult ? <KeyValue k="Plan" v={plan?.title ?? (needsPlan ? "Required" : "None")} /> : null}
        <ErrorBox error={book.error} />
        {missing ? <Muted style={{ fontSize: 12, color: colors.warning }}>{missing}</Muted> : null}
        <Button title={rescheduleId ? "Move appointment" : "Confirm booking"} icon="checkmark-circle-outline" onPress={() => book.mutate()} disabled={!!missing} loading={book.isPending} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pick: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.navy700, borderColor: colors.navy700 },
  day: { width: 60, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", backgroundColor: colors.white },
  dayOn: { backgroundColor: colors.navy700, borderColor: colors.navy700 },
  dayFull: { backgroundColor: "#F1F5F9", borderColor: colors.navy50 },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  slot: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, minWidth: 86, alignItems: "center" },
  slotOn: { backgroundColor: colors.navy700, borderColor: colors.navy700 },
});
