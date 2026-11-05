import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlanReplaceCancelled, withActivePlanCheck } from "@/lib/plan-activation";
import { qk } from "@/lib/query-keys";
import { forget, refresh, useAction } from "@/lib/refresh";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { DailyProgressCard } from "@/components/daily-progress";
import { goBack, Sheet, StatTile } from "@/components/form";
import { Badge, Button, Card, Chips, ErrorBox, Field, H2, Input, KeyValue, Loading, Muted, ProgressBar, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { date, fullName, inr } from "@/lib/format";
import { useTreatmentPrices } from "@/lib/queries";
import { OUTCOME_LABEL, type PlanDetail, type TreatmentOutcome } from "@/lib/types";
import { colors, space } from "@/theme";

type Detail = PlanDetail & {
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null };
  patientPackages: { id: string; remainingSessions: number; status: string; expiryDate: string }[];
  consultation: { chiefComplaint: string | null; clinicalImpression: string | null; assessment: { painScore: number; painLocation: string | null; diagnosis?: string | null } | null } | null;
};

export default function PlanScreen() {
  const { id, complete: openComplete } = useLocalSearchParams<{ id: string; complete?: string }>();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: qk.plan(id), queryFn: () => api.get<Detail>(`/treatment-plans/${id}`), enabled: !!id });
  const prices = useTreatmentPrices();
  const priceOf = new Map((prices.data ?? []).filter((x) => x.isActive).map((x) => [x.category, Number(x.price)]));
  const p = q.data;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [completeOpen, setCompleteOpen] = useState(false);
  const [outcome, setOutcome] = useState<TreatmentOutcome>("GOALS_MET");
  const [finalPain, setFinalPain] = useState("");
  const [summary, setSummary] = useState("");
  const [homeProgram, setHomeProgram] = useState("");

  // Same rules as the API: the whole physio team (and the Super Admin) manages plans.
  const canManage = hasRole(user, "PHYSIOTHERAPIST", "ADMIN");
  const open = !!p && ["DRAFT", "ACTIVE"].includes(p.status);
  const canEdit = canManage && open;
  const canActivate = canManage && p?.status === "DRAFT";
  const canComplete = canManage && p?.status === "ACTIVE";
  const canCancel = canManage && open;
  const canDelete = canManage && !!p;

  // Activating while the patient has another active plan asks to replace it (one active plan per patient).
  const act = useAction(
    () => withActivePlanCheck((replaceActive) => api.post(`/treatment-plans/${id}/activate`, { replaceActive })),
    { refresh: ["clinical", "appointments"] },
  );
  const actError = act.error instanceof PlanReplaceCancelled ? null : act.error;

  const booked = p?.progress.bookedVisits ?? 0;
  const painOk = finalPain === "" || Number(finalPain) <= 10;
  const complete = useAction(
    () =>
      api.post(`/treatment-plans/${id}/complete`, {
        outcome,
        finalPainScore: finalPain === "" ? undefined : Number(finalPain),
        dischargeSummary: summary.trim() || undefined,
        homeProgram: homeProgram.trim() || undefined,
        cancelUpcoming: booked > 0,
      }),
    { refresh: ["clinical", "appointments"], onSuccess: () => setCompleteOpen(false) },
  );

  /** Prefill the discharge form from the plan's progress and show it. */
  const prefillDischarge = (plan: Detail) => {
    setOutcome(plan.progress.completedSessions < plan.prescribedSessions ? "PARTIALLY_MET" : "GOALS_MET");
    setFinalPain(plan.progress.latestPain != null ? String(plan.progress.latestPain) : "");
    setSummary("");
    setHomeProgram("");
    setCompleteOpen(true);
  };
  const openDischarge = () => {
    if (!p) return;
    complete.reset();
    prefillDischarge(p);
  };

  // Opened from "All sessions done" after the last session: go straight to the discharge form,
  // once, as soon as the plan has loaded (state adjusted during render — no effect needed).
  const [autoOpened, setAutoOpened] = useState(false);
  if (openComplete === "1" && !autoOpened && p?.status === "ACTIVE" && canManage) {
    setAutoOpened(true);
    prefillDischarge(p);
  }
  const remove = useAction(
    async () => {
      const nothingDone = p && p.progress.completedSessions === 0 && p.progress.upcomingSessions === 0;
      const msg = nothingDone
        ? "This removes the plan. Use it for plans created by mistake."
        : "This plan has sessions done or booked, so the server will refuse; use Cancel plan instead. Try anyway?";
      if (!(await confirm(`Delete ${p?.title ?? "plan"}?`, msg, "Delete", true))) return null;
      return api.del(`/treatment-plans/${id}`);
    },
    {
      onSuccess: (r) => {
        if (!r) return;
        forget(qc, qk.plan(id));
        void refresh(qc, "clinical");
        goBack("/treatment-plans");
      },
    },
  );
  const cancel = useAction(() => api.post(`/treatment-plans/${id}/cancel`, { reason: reason.trim() }), {
    refresh: ["clinical", "appointments"],
    onSuccess: () => {
      setCancelOpen(false);
      setReason("");
    },
  });

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar title="Treatment plan" onBack={() => goBack("/treatment-plans")} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : p ? (
        <>
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <Text weight="bold" style={{ fontSize: 18, color: colors.navy700, flex: 1 }}>{p.title}</Text>
              <Badge status={p.status} />
            </Row>
            <Pressable onPress={() => router.push({ pathname: "/patient/[id]", params: { id: p.patient.id } })} accessibilityRole="link">
              <Text weight="semibold" style={{ color: colors.gold700 }}>{fullName(p.patient)} · {p.patient.patientCode}</Text>
            </Pressable>
            <Muted style={{ fontSize: 12 }}>{p.planNo} · with {p.therapist.user.name}</Muted>
            <View style={{ marginTop: space.sm, gap: 6 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <Muted>Progress</Muted>
                <Text weight="bold" style={{ color: colors.gold700 }}>{p.progress.percent}%</Text>
              </Row>
              <ProgressBar percent={p.progress.percent} />
            </View>
          </Card>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <StatTile label="Done" value={`${p.progress.completedSessions}/${p.prescribedSessions}`} />
            <StatTile label="Booked" value={p.progress.upcomingSessions} />
            <StatTile label="Frequency" value={`${p.frequencyPerWeek}×/wk`} hint={`${p.sessionMinutes} min each`} />
            <StatTile label="Package left" value={p.patientPackages.find((x) => x.status === "ACTIVE")?.remainingSessions ?? "—"} />
          </View>

          {canComplete && p.progress.readyToComplete ? (
            <Card gold>
              <Text weight="semibold" style={{ color: colors.navy900 }}>All {p.prescribedSessions} prescribed sessions are done</Text>
              <Muted>Record the outcome and complete the treatment.</Muted>
              <Button title="Complete treatment" variant="gold" icon="checkmark-done-outline" onPress={openDischarge} />
            </Card>
          ) : null}

          {p.status === "COMPLETED" && p.outcome ? (
            <Card>
              <H2>Discharge summary</H2>
              <KeyValue k="Outcome" v={OUTCOME_LABEL[p.outcome]} />
              {p.completedAt ? <KeyValue k="Completed" v={date(p.completedAt)} /> : null}
              {p.finalPainScore != null ? (
                <KeyValue k="Pain" v={`${p.consultation?.assessment ? `${p.consultation.assessment.painScore}/10 → ` : ""}${p.finalPainScore}/10`} />
              ) : null}
              {p.dischargeSummary ? (
                <View style={{ marginTop: space.xs }}>
                  <Muted>Summary</Muted>
                  <Text>{p.dischargeSummary}</Text>
                </View>
              ) : null}
              {p.homeProgram ? (
                <View style={{ marginTop: space.xs }}>
                  <Muted>Home program</Muted>
                  <Text>{p.homeProgram}</Text>
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* A draft plan's next step stays up here; the other actions come after the plan's content. */}
          {canActivate ? (
            <View style={{ gap: space.sm }}>
              <ErrorBox error={actError} />
              <Button title="Activate plan" icon="play-circle-outline" onPress={() => act.mutate()} loading={act.isPending} />
            </View>
          ) : null}

          <Card>
            <H2>Clinical summary</H2>
            {p.consultation ? <KeyValue k="Complaint" v={p.consultation.chiefComplaint || "—"} /> : null}
            {p.consultation?.assessment ? <KeyValue k="Initial pain" v={`${p.consultation.assessment.painScore}/10${p.consultation.assessment.painLocation ? ` (${p.consultation.assessment.painLocation})` : ""}`} /> : null}
            {p.consultation?.assessment?.diagnosis ? <KeyValue k="Assessment diagnosis" v={p.consultation.assessment.diagnosis} /> : null}
            <KeyValue k="Diagnosis" v={p.diagnosis ?? "—"} />
            {p.goals ? (
              <View style={{ marginTop: space.xs }}>
                <Muted>Goals</Muted>
                <Text>{p.goals}</Text>
              </View>
            ) : null}
            {p.instructions ? (
              <View style={{ marginTop: space.xs }}>
                <Muted>Instructions</Muted>
                <Text>{p.instructions}</Text>
              </View>
            ) : null}
          </Card>

          <Card>
            <H2>Prescribed treatments</H2>
            {p.items.length === 0 ? (
              <Muted>No treatments added.</Muted>
            ) : (
              p.items.map((i) => (
                <View key={i.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.navy50 }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text weight="semibold" style={{ flex: 1 }}>{i.name}</Text>
                    {priceOf.has(i.category) ? <Text weight="semibold" style={{ fontSize: 13, color: colors.gold700 }}>{inr(priceOf.get(i.category))}</Text> : null}
                  </Row>
                  <Muted style={{ fontSize: 12 }}>
                    {[i.category, i.sets && `${i.sets} sets`, i.reps && `${i.reps} reps`, i.durationMinutes && `${i.durationMinutes} min`].filter(Boolean).join(" · ")}
                  </Muted>
                </View>
              ))
            )}
          </Card>

          <DailyProgressCard therapies={p.items.map((i) => ({ id: i.id, name: i.name, category: i.category }))} planId={p.id} canRecord={canManage} />

          <Card>
            <H2>Sessions</H2>
            {p.therapySessions.length === 0 ? (
              <Muted>No sessions booked yet.</Muted>
            ) : (
              p.therapySessions.map((s) => (
                <Row key={s.id} style={{ justifyContent: "space-between", paddingVertical: 6 }}>
                  <View>
                    <Text weight="semibold">Session #{s.sessionNumber ?? "–"}</Text>
                    <Muted style={{ fontSize: 12 }}>{s.completedAt ? date(s.completedAt) : "Not done yet"}</Muted>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 2 }}>
                    <Badge status={s.status} />
                    {s.painBefore !== null && s.painAfter !== null ? <Muted style={{ fontSize: 12 }}>Pain {s.painBefore} → {s.painAfter}</Muted> : null}
                  </View>
                </Row>
              ))
            )}
          </Card>

          {canEdit || canComplete || canCancel || canDelete ? (
            <View style={{ gap: space.sm }}>
              <ErrorBox error={remove.error} />
              {canEdit ? <Button title="Edit plan" variant="ghost" icon="create-outline" onPress={() => router.push({ pathname: "/plan/edit/[id]", params: { id: p.id } })} /> : null}
              {canComplete ? <Button title="Complete treatment" variant="gold" icon="checkmark-done-outline" onPress={openDischarge} /> : null}
              {canCancel ? <Button title="Cancel plan" variant="danger" icon="close-circle-outline" onPress={() => { cancel.reset(); setCancelOpen(true); }} /> : null}
              {canDelete ? <Button title="Delete plan" variant="danger" icon="trash-outline" onPress={() => remove.mutate()} loading={remove.isPending} /> : null}
            </View>
          ) : null}

          <Sheet
            open={completeOpen}
            onClose={() => setCompleteOpen(false)}
            title="Complete treatment"
            footer={
              <Button
                title={booked > 0 ? `Cancel ${booked} visit${booked === 1 ? "" : "s"} & complete` : "Complete treatment"}
                variant="gold"
                icon="checkmark-done-outline"
                onPress={() => complete.mutate()}
                disabled={!painOk}
                loading={complete.isPending}
              />
            }
          >
            <Muted>
              {p.progress.completedSessions} of {p.prescribedSessions} prescribed sessions done.
              {p.progress.completedSessions < p.prescribedSessions ? " The plan will close early." : ""} It can&apos;t be edited afterwards.
            </Muted>
            {booked > 0 ? (
              <Card style={{ backgroundColor: colors.dangerBg }}>
                <Text weight="semibold" style={{ color: colors.danger }}>
                  {booked} visit{booked === 1 ? " is" : "s are"} still booked under this plan. Completing will cancel {booked === 1 ? "it" : "them"} and notify the patient.
                </Text>
              </Card>
            ) : null}
            <Field label="Outcome *">
              <Chips options={(Object.keys(OUTCOME_LABEL) as TreatmentOutcome[]).map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))} value={outcome} onChange={setOutcome} />
            </Field>
            <Field label="Final pain score (0–10)">
              <Input value={finalPain} onChangeText={(t) => setFinalPain(t.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" placeholder="e.g. 2" />
            </Field>
            <Field label="Discharge summary">
              <Input value={summary} onChangeText={setSummary} multiline maxLength={4000} placeholder="Progress made, current function, reason for discharge" />
            </Field>
            <Field label="Home exercise program">
              <Input value={homeProgram} onChangeText={setHomeProgram} multiline maxLength={4000} placeholder="Exercises and advice to continue at home" />
            </Field>
            <ErrorBox error={complete.error} />
          </Sheet>

          <Sheet
            open={cancelOpen}
            onClose={() => setCancelOpen(false)}
            title="Cancel treatment plan?"
            footer={<Button title="Cancel plan" variant="danger" icon="close-circle-outline" onPress={() => cancel.mutate()} disabled={reason.trim().length < 2} loading={cancel.isPending} />}
          >
            <Muted>The plan stops and can&apos;t be used for new bookings. Cancel any upcoming appointments for it first.</Muted>
            <Field label="Reason *"><Input value={reason} onChangeText={setReason} multiline maxLength={300} placeholder="e.g. Patient moved to another city" /></Field>
            <ErrorBox error={cancel.error} />
          </Sheet>
        </>
      ) : null}
    </Screen>
  );
}
