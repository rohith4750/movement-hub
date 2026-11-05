import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { goBack, SelectField, Sheet } from "@/components/form";
import { ActionTile, Avatar, Badge, Button, Card, Chips, ErrorBox, Field, H2, Input, KeyValue, Loading, Muted, Row, Screen, Text, TileGrid, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { date, dateTime, fullName, label, time } from "@/lib/format";
import { useActivePlans, useConsultation, useConsultationHistory } from "@/lib/queries";
import { qk } from "@/lib/query-keys";
import { forget, refresh, useAction } from "@/lib/refresh";
import type { Appointment, AppointmentType } from "@/lib/types";
import { colors, radius, space } from "@/theme";

type Detail = Appointment & { history: { id: string; toStatus: string; fromStatus: string | null; note: string | null; createdAt: string }[] };

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
  // Same key as useAppointment(): the booking and consultation screens share this cache entry.
  const q = useQuery({ queryKey: qk.appointment(id), queryFn: () => api.get<Detail>(`/appointments/${id}`), enabled: !!id });
  const a = q.data;

  const isAdmin = hasRole(user, "ADMIN");
  // No separate front desk: physiotherapists also reschedule, cancel and mark no-shows (the API already allows it).
  const isFrontDesk = hasRole(user, "ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST");
  const isTreating = user?.role === "SUPER_ADMIN" || (user?.role === "PHYSIOTHERAPIST" && user.therapistId === a?.therapist.id);
  const canClinical = isAdmin || isTreating;
  const open = a ? ["SCHEDULED", "CONFIRMED"].includes(a.status) : false;
  const isConsult = a?.type === "INITIAL_CONSULTATION" || a?.type === "FOLLOW_UP_CONSULTATION";
  const hasClinical = !!a && (!!a.consultation || STARTED.includes(a.status));
  // Permanent delete is an admin correction tool; everyone else cancels, so the visit stays on record.
  const canDelete = isAdmin;
  const canEditBooking = isFrontDesk && open && a?.type !== "HOME_VISIT" && !a?.consultation;
  const canEditNotes = isFrontDesk || isTreating;

  /* ── consultation notes ── */
  const consult = useConsultation(a?.consultation && canClinical ? a.consultation.id : undefined);
  const isDraft = consult.data?.status === "DRAFT";
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useConsultationHistory(a?.consultation?.id, historyOpen);

  /* ── status actions ── */
  const act = useAction(
    async (action: "confirm" | "check-in" | "no-show" | "complete") => {
      if (action === "no-show" && !(await confirm("Mark as no-show?", "The patient did not come for this visit.", "No-show", true))) return null;
      return api.patch(`/appointments/${id}/${action}`);
    },
    { refresh: ["appointments"] },
  );

  /* ── cancel ── */
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const cancel = useAction(() => api.post(`/appointments/${id}/cancel`, { reason: reason.trim() }), {
    refresh: ["appointments"],
    onSuccess: () => {
      setCancelling(false);
      setReason("");
    },
  });

  /* ── delete (admins) ── */
  // Plain values, worked out here: the React Compiler turns `a?.x` read inside a callback into an
  // unguarded `a.x` change-check, which crashed this screen while the appointment was loading.
  const apptNo = a ? a.appointmentNo : "";
  const consultationId = a && a.consultation ? a.consultation.id : "";
  const patientName = a ? fullName(a.patient) : "";
  const hasNotes = !!(a && a.consultation);
  const remove = useAction(
    async () => {
      const msg = hasClinical
        ? `This visit already happened${hasNotes ? " and has consultation notes" : ""}. Deleting it permanently removes it${hasNotes ? " and its notes" : ""} from ${patientName}'s record (a copy is kept in the audit log). Any package session it used is given back.`
        : `This permanently removes the booking for ${patientName} and frees the time slot. Use Cancel instead to keep a record.`;
      if (!(await confirm(`Delete ${apptNo}?`, msg, "Delete", true))) return false;
      await api.del(`/appointments/${id}`);
      return true;
    },
    {
      onSuccess: (deleted) => {
        if (!deleted) return;
        forget(qc, qk.appointment(id)); // gone: don't refetch it
        void refresh(qc, "appointments");
        goBack("/appointments");
      },
    },
  );

  /* ── edit appointment (sheet) ── */
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<{ type: AppointmentType; planId: string; notes: string }>({ type: "INITIAL_CONSULTATION", planId: "", notes: "" });
  const plans = useActivePlans(editOpen && canEditBooking ? a?.patient.id : undefined);
  const openEdit = () => {
    if (!a) return;
    setForm({ type: a.type, planId: a.treatmentPlan?.id ?? "", notes: a.notes ?? "" });
    saveAppt.reset();
    setEditOpen(true);
  };
  const saveAppt = useAction(
    () =>
      api.patch(`/appointments/${id}`, {
        notes: form.notes.trim() || null,
        ...(canEditBooking ? { type: form.type, treatmentPlanId: form.type === "INITIAL_CONSULTATION" ? null : form.planId || null } : {}),
      }),
    { refresh: ["appointments"], onSuccess: () => setEditOpen(false) },
  );
  const planMissing = canEditBooking && form.type === "THERAPY_SESSION" && !form.planId;

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
  const saveConsult = useAction(
    async () => {
      const cid = consultationId;
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
    { refresh: ["clinical"], onSuccess: () => setConsultOpen(false) },
  );

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar
        title="Appointment"
        onBack={() => goBack("/appointments")}
        right={
          a && canEditNotes ? (
            <Pressable onPress={openEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit appointment">
              <Ionicons name="create-outline" size={22} color={colors.white} />
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
          <Card>
            <Row gap={space.md}>
              <Avatar name={fullName(a.patient)} size={54} />
              {/* The status sits under the name, so a long name gets the whole width instead of "Yeshwant D…" */}
              <View style={{ flex: 1, gap: 4 }}>
                <Pressable
                  onPress={() => router.push({ pathname: "/patient/[id]", params: { id: a.patient.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${fullName(a.patient)}`}
                >
                  <Text weight="bold" style={{ fontSize: 17 }} numberOfLines={2}>{fullName(a.patient)}</Text>
                </Pressable>
                <Row gap={space.sm} style={{ flexWrap: "wrap" }}>
                  <Muted style={{ fontSize: 12 }}>{a.patient.patientCode}</Muted>
                  <Badge status={a.status} />
                </Row>
              </View>
            </Row>
            <Row gap={space.sm}>
              <Ionicons name="calendar-outline" size={18} color={colors.gold700} />
              <Text weight="semibold">{date(a.startAt)} · {time(a.startAt)}</Text>
            </Row>
            <Row gap={space.sm}>
              <Ionicons name="medkit-outline" size={18} color={colors.gold700} />
              <Text style={{ flex: 1 }}>
                {label(a.type)}
                {a.therapySession?.sessionNumber ? ` · Session #${a.therapySession.sessionNumber}` : ""}
              </Text>
              {a.source === "WALK_IN" ? <Badge status="WALK_IN" text="Walk-in" /> : null}
            </Row>
            <Row gap={space.sm}>
              <Ionicons name="person-outline" size={18} color={colors.gold700} />
              <Text style={{ flex: 1 }}>Physio: {a.therapist.user.name}</Text>
            </Row>
          </Card>

          <Card>
            <Button title={`Call ${a.patient.phone}`} variant="ghost" small icon="call-outline" onPress={() => Linking.openURL(`tel:${a.patient.phone}`)} style={{ alignSelf: "flex-start" }} />
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
          {(isTreating || isAdmin) && isConsult && (!a.consultation || isDraft) && !CLOSED.includes(a.status) ? (
            <Button
              title={isDraft ? "Continue consultation (draft)" : "Write consultation"}
              variant="gold"
              icon="document-text-outline"
              onPress={() => router.push({ pathname: "/consultation/new", params: { appointmentId: a.id } })}
            />
          ) : null}
          {isTreating && a.consultation && !isDraft && consult.data && a.status === "IN_PROGRESS" ? (
            <Button title="Mark visit completed" icon="checkmark-done-outline" onPress={() => act.mutate("complete")} loading={act.isPending} />
          ) : null}

          {/* Consultation notes */}
          {a.consultation && canClinical ? (
            <Card>
              <Row style={{ justifyContent: "space-between" }}>
                <Row gap={6} style={{ flex: 1 }}>
                  <H2>Consultation notes</H2>
                  {isDraft ? <Badge status="DRAFT" text="Draft" /> : null}
                </Row>
                {consult.data && !isDraft ? <Button title="Edit" variant="ghost" small icon="create-outline" onPress={openConsult} /> : null}
              </Row>
              {consult.data ? (
                <Pressable onPress={() => setHistoryOpen(true)} accessibilityRole="button" hitSlop={6}>
                  <Muted style={{ fontSize: 12, color: colors.gold700 }}>
                    {isDraft ? "Draft saved" : "Finished"} {dateTime(isDraft ? consult.data.updatedAt : consult.data.finalizedAt ?? consult.data.createdAt)} · View edit history ›
                  </Muted>
                </Pressable>
              ) : null}
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
              <TileGrid>
                <ActionTile icon="calendar-outline" title="Reschedule" onPress={() => router.push({ pathname: "/book", params: { reschedule: a.id } })} />
                <ActionTile icon="person-remove-outline" title="No-show" onPress={() => act.mutate("no-show")} />
                <ActionTile icon="close-circle-outline" title="Cancel" danger onPress={() => setCancelling(true)} />
              </TileGrid>
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

          {/* Consultation edit history */}
          <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Consultation history">
            {history.isLoading ? (
              <Loading />
            ) : history.error ? (
              <ErrorBox error={history.error} onRetry={() => history.refetch()} />
            ) : !history.data?.length ? (
              <Muted>No changes recorded yet.</Muted>
            ) : (
              history.data.map((h) => (
                <View key={h.id} style={{ borderLeftWidth: 2, borderLeftColor: colors.gold300, paddingLeft: space.md, paddingVertical: 2 }}>
                  <Text weight="semibold" style={{ fontSize: 13 }}>
                    {h.part} {h.action.toLowerCase()} by {h.by}
                  </Text>
                  {h.fields.length ? <Muted style={{ fontSize: 12 }}>{h.fields.join(", ")}</Muted> : null}
                  <Muted style={{ fontSize: 11 }}>{dateTime(h.at)}</Muted>
                </View>
              ))
            )}
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
