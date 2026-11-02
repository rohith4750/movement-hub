import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Badge, Button, Card, Caption, ErrorBox, Field, H2, Input, KeyValue, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { fullName, time } from "@/lib/format";
import type { TherapySession } from "@/lib/types";
import { colors, radius, space } from "@/theme";

type Exercise = { name: string; sets: string; reps: string };

/** Physio flow: start session (pain before) → treat → complete (pain after, notes, exercises). */
export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ["session", id], queryFn: () => api.get<TherapySession>(`/therapy-sessions/${id}`), enabled: !!id });
  const s = q.data;

  // Form state (null = use the value already saved on the session)
  const [painBefore, setPainBefore] = useState<number | null>(null);
  const [painAfter, setPainAfter] = useState(3);
  const [rating, setRating] = useState(3);
  const [notes, setNotes] = useState("");
  const [advice, setAdvice] = useState("");
  const [exercises, setExercises] = useState<Exercise[] | null>(null);

  const before = painBefore ?? s?.painBefore ?? 5;
  const exList: Exercise[] =
    exercises ??
    (s?.treatmentPlan?.items.filter((i) => i.category === "Exercise Therapy").map((i) => ({ name: i.name, sets: i.sets ? String(i.sets) : "", reps: i.reps ? String(i.reps) : "" })) ?? []);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["session", id] });
    qc.invalidateQueries({ queryKey: ["sessions"] });
    qc.invalidateQueries({ queryKey: ["appointments"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const start = useMutation({ mutationFn: () => api.post(`/therapy-sessions/${id}/start`, { painBefore: before }), onSuccess: refresh });
  const complete = useMutation({
    mutationFn: () =>
      api.post<{ package: { remainingSessions: number } | null; plan: { id: string; planNo: string; prescribedSessions: number; readyToComplete: boolean } | null }>(`/therapy-sessions/${id}/complete`, {
        painBefore: before,
        painAfter,
        progressRating: rating,
        notes: notes.trim() || undefined,
        homeAdvice: advice.trim() || undefined,
        exercises: exList
          .filter((e) => e.name.trim())
          .map((e) => ({ name: e.name.trim(), sets: e.sets ? Number(e.sets) : undefined, reps: e.reps ? Number(e.reps) : undefined })),
      }),
    onSuccess: async (r) => {
      refresh();
      qc.invalidateQueries({ queryKey: ["plans"] });
      if (r.plan) qc.invalidateQueries({ queryKey: ["plan", r.plan.id] });
      if (r.plan?.readyToComplete) {
        // Last prescribed session done — offer to complete the treatment right away.
        const open = await confirm(
          "All sessions done",
          `All ${r.plan.prescribedSessions} prescribed sessions of plan ${r.plan.planNo} are complete. Open the plan to record the outcome and complete the treatment?`,
          "Open plan",
        );
        if (open) {
          router.replace({ pathname: "/plan/[id]", params: { id: r.plan.id, complete: "1" } });
          return;
        }
      }
      router.back();
    },
  });

  // Same rule as the API: the treating physiotherapist (or a Super Admin) runs the session.
  const mine = user?.role === "SUPER_ADMIN" || (user?.role === "PHYSIOTHERAPIST" && user.therapistId === s?.therapist.id);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/sessions"));

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar title="Therapy session" onBack={back} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : s ? (
        <>
          <Card style={{ backgroundColor: colors.navy700, borderColor: colors.navy700 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text weight="bold" style={{ color: colors.white, fontSize: 18, flex: 1 }}>{fullName(s.patient)}</Text>
              <Badge status={s.status} />
            </Row>
            <Text style={{ color: colors.gold300 }}>
              {time(s.appointment.startAt)} · Session {s.sessionNumber ?? "–"}
              {s.treatmentPlan ? ` of ${s.treatmentPlan.prescribedSessions}` : ""}
            </Text>
            <Text style={{ color: colors.navy100, fontSize: 12 }}>{s.patient.patientCode} · {s.therapist.user.name}</Text>
          </Card>

          {s.treatmentPlan ? (
            <Card>
              <H2>{s.treatmentPlan.title}</H2>
              {s.treatmentPlan.items.map((i) => (
                <Row key={i.id} style={{ justifyContent: "space-between" }}>
                  <Text style={{ flex: 1 }}>{i.name}</Text>
                  <Muted style={{ fontSize: 12 }}>{[i.category, i.sets && `${i.sets}×${i.reps ?? ""}`, i.durationMinutes && `${i.durationMinutes} min`].filter(Boolean).join(" · ")}</Muted>
                </Row>
              ))}
            </Card>
          ) : null}

          {s.patientPackage ? (
            <Card gold>
              <KeyValue k="Package" v={s.patientPackage.package.name} />
              <KeyValue k="Sessions left" v={`${s.patientPackage.remainingSessions}`} />
              {s.status !== "COMPLETED" ? <Muted style={{ fontSize: 12 }}>Completing this session uses 1 package session.</Muted> : null}
            </Card>
          ) : null}

          {!mine ? (
            <Card><Muted>This session belongs to {s.therapist.user.name}. Only they can start or complete it.</Muted></Card>
          ) : s.status === "SCHEDULED" ? (
            <Card>
              <H2>Start session</H2>
              <PainScale label="Pain before treatment" value={before} onChange={setPainBefore} />
              <ErrorBox error={start.error} />
              <Button title="Start session" icon="play-circle-outline" onPress={() => start.mutate()} loading={start.isPending} />
            </Card>
          ) : s.status === "IN_PROGRESS" ? (
            <Card style={{ gap: space.md }}>
              <H2>Complete session</H2>
              <PainScale label={`Pain before: ${before}/10 · Pain after`} value={painAfter} onChange={setPainAfter} />
              <Field label={`Progress: ${rating}/5`}>
                <Row gap={space.sm}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable key={n} onPress={() => setRating(n)} accessibilityLabel={`Progress ${n} of 5`} hitSlop={6}>
                      <Ionicons name={n <= rating ? "star" : "star-outline"} size={28} color={colors.gold500} />
                    </Pressable>
                  ))}
                </Row>
              </Field>

              <View style={{ gap: space.sm }}>
                <Caption>Exercises done</Caption>
                {exList.map((e, i) => (
                  <Row key={i} gap={space.sm}>
                    <Input style={{ flex: 1 }} placeholder="Exercise" value={e.name} onChangeText={(t) => setExercises(exList.map((x, j) => (j === i ? { ...x, name: t } : x)))} />
                    <Input style={{ width: 56 }} placeholder="Sets" keyboardType="number-pad" value={e.sets} onChangeText={(t) => setExercises(exList.map((x, j) => (j === i ? { ...x, sets: t.replace(/\D/g, "") } : x)))} />
                    <Input style={{ width: 56 }} placeholder="Reps" keyboardType="number-pad" value={e.reps} onChangeText={(t) => setExercises(exList.map((x, j) => (j === i ? { ...x, reps: t.replace(/\D/g, "") } : x)))} />
                    <Pressable onPress={() => setExercises(exList.filter((_, j) => j !== i))} accessibilityLabel="Remove exercise" hitSlop={8}>
                      <Ionicons name="close-circle" size={22} color={colors.danger} />
                    </Pressable>
                  </Row>
                ))}
                <Button title="Add exercise" variant="ghost" small icon="add" onPress={() => setExercises([...exList, { name: "", sets: "", reps: "" }])} style={{ alignSelf: "flex-start" }} />
              </View>

              <Field label="Session notes"><Input multiline value={notes} onChangeText={setNotes} placeholder="How did the patient respond?" /></Field>
              <Field label="Home advice"><Input multiline value={advice} onChangeText={setAdvice} placeholder="Exercises to do at home" /></Field>
              <ErrorBox error={complete.error} />
              <Button title="Complete session" variant="gold" icon="checkmark-done-outline" onPress={() => complete.mutate()} loading={complete.isPending} />
            </Card>
          ) : (
            <Card>
              <H2>Session summary</H2>
              <KeyValue k="Pain" v={`${s.painBefore ?? "–"} → ${s.painAfter ?? "–"}`} />
              {s.progressRating ? <KeyValue k="Progress" v={`${s.progressRating}/5`} /> : null}
              {s.notes ? <Text>{s.notes}</Text> : null}
              {s.exercises.map((e) => (
                <Muted key={e.id}>• {e.name}{e.sets ? ` ${e.sets}×${e.reps ?? ""}` : ""}</Muted>
              ))}
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}

function PainScale({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Field label={`${label}: ${value}/10`}>
      <View style={styles.scale}>
        {Array.from({ length: 11 }, (_, n) => {
          const on = n === value;
          const hue = n <= 3 ? colors.success : n <= 6 ? colors.warning : colors.danger;
          return (
            <Pressable key={n} onPress={() => onChange(n)} accessibilityLabel={`Pain ${n}`} style={[styles.scaleBtn, on && { backgroundColor: hue, borderColor: hue }]}>
              <Text weight="semibold" style={{ fontSize: 13, color: on ? colors.white : colors.navy700 }}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

const styles = StyleSheet.create({
  scale: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  scaleBtn: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
});
