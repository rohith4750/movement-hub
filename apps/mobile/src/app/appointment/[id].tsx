import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { goBack, SelectField, Sheet } from "@/components/form";
import { Badge, Button, Card, Chips, ErrorBox, Field, H2, Input, KeyValue, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { date, fullName, label, time } from "@/lib/format";
import type { Appointment, AppointmentType } from "@/lib/types";
import { colors, radius, space } from "@/theme";

type Detail = Appointment & { history: { id: string; toStatus: string; fromStatus: string | null; note: string | null; createdAt: string }[] };

interface Consultation {
  id: string;
  chiefComplaint: string | null;
  symptoms: string | null;
  historyOfIllness: string | null;
  clinicalImpression: string | null;
  recommendations: string | null;
  assessment: { painScore: number; painLocation: string | null; observations: string | null; diagnosis?: string | null } | null;
}

interface PlanOption {
  id: string;
  title: string;
  therapist: { user: { name: string } };
}

const EDIT_TYPES: { value: AppointmentType; label: string }[] = [
  { value: "INITIAL_CONSULTATION", label: "First consultation" },
  { value: "FOLLOW_UP_CONSULTATION", label: "Follow-up" },
  { value: "THERAPY_SESSION", label: "Therapy session" },
];
const STARTED = ["COMPLETED", "IN_PROGRESS", "CHECKED_IN"];
const CLOSED = ["CANCELLED", "NO_SHOW", "RESCHEDULED", "COMPLETED"];

export default function AppointmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ["appointment", id], queryFn: () => api.get<Detail>(`/appointments/${id}`), enabled: !!id });
  const a = q.data;

  const isAdmin = hasRole(user, "ADMIN");
  const isFrontDesk = hasRole(user, "ADMIN", "RECEPTIONIST");
  const isTreating = user?.role === "SUPER_ADMIN" || (user?.role === "PHYSIOTHERAPIST" && user.therapistId === a?.therapist.id);
  const canClinical = isAdmin || isTreating;
  const open = a ? ["SCHEDULED", "CONFIRMED"].includes(a.status) : false;
  const isConsult = a?.type === "INITIAL_CONSULTATION" || a?.type === "FOLLOW_UP_CONSULTATION";
  const hasClinical = !!a && (!!a.consultation || STARTED.includes(a.status));
  const canDelete = isAdmin || (isFrontDesk && !!a && !hasClinical);
  const canEditBooking = isFrontDesk && open && a?.type !== "HOME_VISIT" && !a?.consultation;
  const canEditNotes = isFrontDesk || isTreating;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["appointments"] });
    qc.invalidateQueries({ queryKey: ["appointment", id] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["sessions"] });
    qc.invalidateQueries({ queryKey: ["calendar"] });
  };

  /* ── status actions ── */
  const act = useMutation({
    mutationFn: async (action: "confirm" | "check-in" | "no-show" | "complete") => {
      if (action === "no-show" && !(await confirm("Mark as no-show?", "The patient did not come for this visit.", "No-show", true))) return null;
      return api.patch(`/appointments/${id}/${action}`);
    },
    onSuccess: refresh,
  });

  /* ── cancel ── */
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: () => api.post(`/appointments/${id}/cancel`, { reason: reason.trim() }),
    onSuccess: () => {
      refresh();
      setCancelling(false);
      setReason("");
    },
  });

  /* ── delete ── */
  const remove = useMutation({
    mutationFn: async () => {
      const msg = hasClinical
        ? `This visit already happened${a?.consultation ? " and has consultation notes" : ""}. Deleting it permanently removes it${a?.consultation ? " and its notes" : ""} from ${fullName(a?.patient)}'s record. Any package session it used is given back.`
        : `This permanently removes the booking for ${fullName(a?.patient)} and frees the time slot. Use Cancel instead to keep a record.`;
      if (!(await confirm(`Delete ${a?.appointmentNo}?`, msg, "Delete", true))) return false;
      await api.del(`/appointments/${id}`);
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["availability"] });
      qc.invalidateQueries({ queryKey: ["availability-summary"] });
      qc.removeQueries({ queryKey: ["appointment", id] });
      goBack("/appointments");
    },
  });

  /* ── edit appointment (sheet) ── */
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<{ type: AppointmentType; planId: string; notes: string }>({ type: "INITIAL_CONSULTATION", planId: "", notes: "" });
  const plans = useQuery({
    queryKey: ["plans", a?.patient.id, "active"],
    queryFn: () => api.page<PlanOption>("/treatment-plans", { patientId: a!.patient.id, status: "ACTIVE" }),
    enabled: editOpen && canEditBooking && !!a,
    select: (r) => r.data,
  });
  const openEdit = () => {
    if (!a) return;
    setForm({ type: a.type, planId: a.treatmentPlan?.id ?? "", notes: a.notes ?? "" });
    saveAppt.reset();
    setEditOpen(true);
  };
  const saveAppt = useMutation({
    mutationFn: () =>
      api.patch(`/appointments/${id}`, {
        notes: form.notes.trim() || null,
        ...(canEditBooking ? { type: form.type, treatmentPlanId: form.type === "INITIAL_CONSULTATION" ? null : form.planId || null } : {}),
      }),
    onSuccess: () => {
      refresh();
      setEditOpen(false);
    },
  });
  const planMissing = canEditBooking && form.type === "THERAPY_SESSION" && !form.planId;

  /* ── consultation notes ── */
  const consult = useQuery({
    queryKey: ["consultation", a?.consultation?.id],
    queryFn: () => api.get<Consultation>(`/consultations/${a!.consultation!.id}`),
    enabled: !!a?.consultation && canClinical,
  });
  const [consultOpen, setConsultOpen] = useState(false);
  const [c, setC] = useState({ chiefComplaint: "", symptoms: "", historyOfIllness: "", clinicalImpression: "", recommendations: "", observations: "", painScore: 0, painLocation: "", diagnosis: "" });
  const openConsult = () => {
    const d = consult.data;
    if (!d) return;
    setC({
      chiefComplaint: d.chiefComplaint ?? "",
      symptoms: d.symptoms ?? "",
      historyOfIllness: d.historyOfIllness ?? "",
      clinicalImpression: d.clinicalImpression ?? "",
      recommendations: d.recommendations ?? "",
      observations: d.assessment?.observations ?? "",
      painScore: d.assessment?.painScore ?? 0,
      painLocation: d.assessment?.painLocation ?? "",
      diagnosis: d.assessment?.diagnosis ?? "",
    });
    saveConsult.reset();
    setConsultOpen(true);
  };
  const saveConsult = useMutation({
    mutationFn: async () => {
      const cid = a!.consultation!.id;
      await api.patch(`/consultations/${cid}`, {
        chiefComplaint: c.chiefComplaint.trim() || undefined,
        symptoms: c.symptoms.trim() || undefined,
        historyOfIllness: c.historyOfIllness.trim() || undefined,
        clinicalImpression: c.clinicalImpression.trim() || undefined,
        recommendations: c.recommendations.trim() || undefined,
      });
      await api.put(`/consultations/${cid}/assessment`, {
        painScore: c.painScore,
        painLocation: c.painLocation.trim() || undefined,
        observations: c.observations.trim() || undefined,
        diagnosis: c.diagnosis.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consultation"] });
      setConsultOpen(false);
    },
  });

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar
        title="Appointment"
        onBack={() => goBack("/appointments")}
        right={
          a && canEditNotes ? (
            <Pressable onPress={openEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit appointment">
              <Ionicons name="create-outline" size={22} color={colors.navy700} />
            </Pressable>
          ) : undefined
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : a ? (
        <>
          <Card style={{ backgroundColor: colors.navy700, borderColor: colors.navy700 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text weight="bold" style={{ color: colors.white, fontSize: 22 }}>{time(a.startAt)}</Text>
              <Badge status={a.status} />
            </Row>
            <Text weight="semibold" style={{ color: colors.gold300 }}>{date(a.startAt)}</Text>
            <Text style={{ color: colors.navy100 }}>
              {label(a.type)}
              {a.therapySession?.sessionNumber ? ` · Session #${a.therapySession.sessionNumber}` : ""}
            </Text>
          </Card>

          <Card>
            <Pressable onPress={() => router.push({ pathname: "/patient/[id]", params: { id: a.patient.id } })} accessibilityRole="button">
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <Muted style={{ fontSize: 12 }}>Patient</Muted>
                  <Text weight="bold" style={{ fontSize: 16 }}>{fullName(a.patient)}</Text>
                  <Muted style={{ fontSize: 12 }}>{a.patient.patientCode}</Muted>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Row>
            </Pressable>
            <Button title={`Call ${a.patient.phone}`} variant="ghost" small icon="call-outline" onPress={() => Linking.openURL(`tel:${a.patient.phone}`)} style={{ alignSelf: "flex-start" }} />
            <KeyValue k="Physiotherapist" v={a.therapist.user.name} />
            <KeyValue k="Booking no." v={a.appointmentNo} />
            {a.treatmentPlan ? (
              <Pressable onPress={() => router.push({ pathname: "/plan/[id]", params: { id: a.treatmentPlan!.id } })} accessibilityRole="button">
                <KeyValue k="Plan" v={a.treatmentPlan.title} vStyle={{ color: colors.gold700 }} />
              </Pressable>
            ) : null}
            <View style={{ marginTop: space.xs }}>
              <Muted style={{ fontSize: 12 }}>Notes</Muted>
              <Text>{a.notes || "—"}</Text>
            </View>
          </Card>

          <ErrorBox error={act.error} />

          {/* Physiotherapist actions */}
          {isTreating && a.therapySession && ["SCHEDULED", "IN_PROGRESS"].includes(a.therapySession.status) && !["CANCELLED", "NO_SHOW", "RESCHEDULED"].includes(a.status) ? (
            <Button
              title={a.therapySession.status === "IN_PROGRESS" ? "Continue session" : "Open therapy session"}
              variant="gold"
              icon="pulse-outline"
              onPress={() => router.push({ pathname: "/session/[id]", params: { id: a.therapySession!.id } })}
            />
          ) : null}
          {(isTreating || isAdmin) && isConsult && !a.consultation && !CLOSED.includes(a.status) ? (
            <Button
              title="Write consultation"
              variant="gold"
              icon="document-text-outline"
              onPress={() => router.push({ pathname: "/consultation/new", params: { appointmentId: a.id } })}
            />
          ) : null}
          {isTreating && a.consultation && a.status === "IN_PROGRESS" ? (
            <Button title="Mark visit completed" icon="checkmark-done-outline" onPress={() => act.mutate("complete")} loading={act.isPending} />
          ) : null}

          {/* Consultation notes */}
          {a.consultation && canClinical ? (
            <Card>
              <Row style={{ justifyContent: "space-between" }}>
                <H2>Consultation notes</H2>
                {consult.data ? <Button title="Edit" variant="ghost" small icon="create-outline" onPress={openConsult} /> : null}
              </Row>
              {consult.isLoading ? (
                <Loading />
              ) : consult.error ? (
                <ErrorBox error={consult.error} onRetry={() => consult.refetch()} />
              ) : consult.data ? (
                <>
                  <KeyValue k="Complaint" v={consult.data.chiefComplaint || "—"} />
                  {consult.data.assessment ? <KeyValue k="Pain" v={`${consult.data.assessment.painScore}/10${consult.data.assessment.painLocation ? ` · ${consult.data.assessment.painLocation}` : ""}`} /> : null}
                  {consult.data.symptoms ? <NoteLine k="Symptoms" v={consult.data.symptoms} /> : null}
                  {consult.data.historyOfIllness ? <NoteLine k="History" v={consult.data.historyOfIllness} /> : null}
                  {consult.data.clinicalImpression ? <NoteLine k="Impression" v={consult.data.clinicalImpression} /> : null}
                  {consult.data.recommendations ? <NoteLine k="Recommendations" v={consult.data.recommendations} /> : null}
                  {consult.data.assessment?.observations ? <NoteLine k="Observations" v={consult.data.assessment.observations} /> : null}
                  {consult.data.assessment?.diagnosis ? <NoteLine k="Diagnosis" v={consult.data.assessment.diagnosis} /> : null}
                </>
              ) : null}
            </Card>
          ) : null}

          {/* Front-desk actions */}
          {isFrontDesk && open ? (
            !cancelling ? (
              <View style={{ gap: space.sm }}>
                <Row>
                  <Button title="Reschedule" variant="ghost" icon="calendar-outline" onPress={() => router.push({ pathname: "/book", params: { reschedule: a.id } })} style={{ flex: 1 }} />
                  <Button title="No-show" variant="ghost" icon="person-remove-outline" onPress={() => act.mutate("no-show")} style={{ flex: 1 }} />
                </Row>
                <Button title="Cancel appointment" variant="danger" icon="close-circle-outline" onPress={() => setCancelling(true)} />
              </View>
            ) : (
              <Card>
                <H2>Cancel this visit?</H2>
                <Field label="Reason">
                  <Input value={reason} onChangeText={setReason} multiline maxLength={300} placeholder="e.g. patient unwell" />
                </Field>
                <ErrorBox error={cancel.error} />
                <Button title="Yes, cancel" variant="danger" onPress={() => cancel.mutate()} loading={cancel.isPending} disabled={reason.trim().length < 2} />
                {reason.trim().length < 2 ? <Muted style={{ fontSize: 12 }}>Enter a reason to cancel.</Muted> : null}
                <Button title="Keep appointment" variant="ghost" onPress={() => setCancelling(false)} />
              </Card>
            )
          ) : null}

          {/* Delete */}
          {canDelete ? (
            <View style={{ gap: space.xs }}>
              <ErrorBox error={remove.error} />
              <Button title="Delete appointment" variant="danger" icon="trash-outline" onPress={() => remove.mutate()} loading={remove.isPending} />
              {hasClinical ? <Muted style={{ fontSize: 12, textAlign: "center" }}>This visit has already happened; deleting also removes its notes.</Muted> : null}
            </View>
          ) : isFrontDesk && hasClinical ? (
            <Muted style={{ fontSize: 12, textAlign: "center" }}>Visits that already happened can only be deleted by an Admin.</Muted>
          ) : null}

          {a.history?.length ? (
            <Card>
              <H2>History</H2>
              {a.history.map((h) => (
                <View key={h.id} style={{ borderLeftWidth: 2, borderLeftColor: colors.gold300, paddingLeft: space.md, paddingVertical: 2 }}>
                  <Text weight="semibold" style={{ fontSize: 13 }}>
                    {h.fromStatus && h.fromStatus !== h.toStatus ? `${label(h.fromStatus)} → ${label(h.toStatus)}` : label(h.toStatus)}
                  </Text>
                  {h.note ? <Muted style={{ fontSize: 12 }}>{h.note}</Muted> : null}
                  <Muted style={{ fontSize: 11 }}>{date(h.createdAt)}, {time(h.createdAt)}</Muted>
                </View>
              ))}
            </Card>
          ) : null}

          {/* Edit appointment sheet */}
          <Sheet
            open={editOpen}
            onClose={() => setEditOpen(false)}
            title={`Edit ${a.appointmentNo}`}
            footer={<Button title="Save changes" icon="save-outline" onPress={() => saveAppt.mutate()} loading={saveAppt.isPending} disabled={planMissing} />}
          >
            {canEditBooking ? (
              <>
                <Field label="Visit type">
                  <Chips<AppointmentType> value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={EDIT_TYPES} />
                </Field>
                {form.type !== "INITIAL_CONSULTATION" ? (
                  plans.isLoading ? (
                    <Loading />
                  ) : (
                    <SelectField
                      label={`Treatment plan${form.type === "THERAPY_SESSION" ? " *" : ""}`}
                      value={form.planId}
                      onChange={(v) => setForm({ ...form, planId: v })}
                      placeholder={plans.data?.length ? "Select plan" : "No active plan"}
                      disabled={!plans.data?.length}
                      options={[
                        ...(form.type === "THERAPY_SESSION" ? [] : [{ value: "", label: "None" }]),
                        ...(plans.data ?? []).map((p) => ({ value: p.id, label: p.title, hint: p.therapist.user.name })),
                      ]}
                    />
                  )
                ) : null}
                {planMissing ? <Muted style={{ fontSize: 12, color: colors.warning }}>Therapy sessions need an active treatment plan.</Muted> : null}
              </>
            ) : (
              <Muted style={{ fontSize: 12 }}>
                {a.type === "HOME_VISIT" ? "Home visit type can't be changed." : !open ? "Type and plan are locked once the visit has started." : a.consultation ? "Type and plan are locked: consultation notes exist." : "Only notes can be edited."}
              </Muted>
            )}
            <Field label="Notes">
              <Input value={form.notes} onChangeText={(t) => setForm({ ...form, notes: t })} multiline maxLength={1000} placeholder="Notes for this visit" />
            </Field>
            <ErrorBox error={saveAppt.error} />
          </Sheet>

          {/* Edit consultation sheet */}
          <Sheet
            open={consultOpen}
            onClose={() => setConsultOpen(false)}
            title="Consultation notes"
            footer={<Button title="Save consultation" icon="save-outline" onPress={() => saveConsult.mutate()} loading={saveConsult.isPending} />}
          >
            <Field label="Chief complaint"><Input value={c.chiefComplaint} onChangeText={(t) => setC({ ...c, chiefComplaint: t })} /></Field>
            <Field label="Symptoms"><Input value={c.symptoms} onChangeText={(t) => setC({ ...c, symptoms: t })} multiline /></Field>
            <Field label="History of present illness"><Input value={c.historyOfIllness} onChangeText={(t) => setC({ ...c, historyOfIllness: t })} multiline /></Field>
            <Field label="Clinical impression"><Input value={c.clinicalImpression} onChangeText={(t) => setC({ ...c, clinicalImpression: t })} multiline /></Field>
            <Field label="Recommendations"><Input value={c.recommendations} onChangeText={(t) => setC({ ...c, recommendations: t })} multiline /></Field>
            <Field label="Observations"><Input value={c.observations} onChangeText={(t) => setC({ ...c, observations: t })} multiline /></Field>
            <Field label={`Pain score: ${c.painScore}/10`}>
              <PainScale value={c.painScore} onChange={(n) => setC({ ...c, painScore: n })} />
            </Field>
            <Field label="Pain location"><Input value={c.painLocation} onChangeText={(t) => setC({ ...c, painLocation: t })} /></Field>
            <Field label="Diagnosis"><Input value={c.diagnosis} onChangeText={(t) => setC({ ...c, diagnosis: t })} multiline placeholder="e.g. Lumbar disc prolapse L4–L5" /></Field>
            <ErrorBox error={saveConsult.error} />
          </Sheet>
        </>
      ) : null}
    </Screen>
  );
}

function NoteLine({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ marginTop: 4 }}>
      <Muted style={{ fontSize: 12 }}>{k}</Muted>
      <Text>{v}</Text>
    </View>
  );
}

function PainScale({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {Array.from({ length: 11 }, (_, n) => {
        const on = n === value;
        const hue = n <= 3 ? colors.success : n <= 6 ? colors.warning : colors.danger;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            accessibilityLabel={`Pain ${n}`}
            style={{ width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: on ? hue : colors.border, backgroundColor: on ? hue : colors.white, alignItems: "center", justifyContent: "center" }}
          >
            <Text weight="semibold" style={{ fontSize: 13, color: on ? colors.white : colors.navy700 }}>{n}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
