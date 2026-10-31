import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { goBack, Sheet, StatTile } from "@/components/form";
import { Badge, Button, Card, ErrorBox, Field, H2, Input, KeyValue, Loading, Muted, ProgressBar, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { date, fullName } from "@/lib/format";
import type { PlanDetail } from "@/lib/types";
import { colors, space } from "@/theme";

type Detail = PlanDetail & {
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null };
  patientPackages: { id: string; remainingSessions: number; status: string; expiryDate: string }[];
  consultation: { chiefComplaint: string; clinicalImpression: string | null; assessment: { painScore: number; painLocation: string | null } | null } | null;
};

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ["plan", id], queryFn: () => api.get<Detail>(`/treatment-plans/${id}`), enabled: !!id });
  const p = q.data;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  // Same rules as the API: the whole physio team (and the Super Admin) manages plans.
  const canManage = hasRole(user, "PHYSIOTHERAPIST", "ADMIN");
  const open = !!p && ["DRAFT", "ACTIVE"].includes(p.status);
  const canEdit = canManage && open;
  const canActivate = canManage && p?.status === "DRAFT";
  const canComplete = canManage && p?.status === "ACTIVE";
  const canCancel = canManage && open;
  const canDelete = canManage && !!p;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["plan", id] });
    qc.invalidateQueries({ queryKey: ["plans"] });
    if (p) qc.invalidateQueries({ queryKey: ["patient", p.patient.id] });
  };

  const act = useMutation({
    mutationFn: async (action: "activate" | "complete") => {
      if (action === "complete" && !(await confirm("Mark plan complete?", "Use this when the treatment is finished. The plan can't be edited afterwards.", "Complete"))) return null;
      return api.post(`/treatment-plans/${id}/${action}`);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async () => {
      const nothingDone = p && p.progress.completedSessions === 0 && p.progress.upcomingSessions === 0;
      const msg = nothingDone
        ? "This removes the plan. Use it for plans created by mistake."
        : "This plan has sessions done or booked, so the server will refuse; use Cancel plan instead. Try anyway?";
      if (!(await confirm(`Delete ${p?.title ?? "plan"}?`, msg, "Delete", true))) return null;
      return api.del(`/treatment-plans/${id}`);
    },
    onSuccess: (r) => {
      if (!r) return;
      qc.invalidateQueries({ queryKey: ["plans"] });
      if (p) qc.invalidateQueries({ queryKey: ["patient", p.patient.id] });
      goBack("/treatment-plans");
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/treatment-plans/${id}/cancel`, { reason: reason.trim() }),
    onSuccess: () => {
      refresh();
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

          {canEdit || canActivate || canComplete || canCancel || canDelete ? (
            <View style={{ gap: space.sm }}>
              <ErrorBox error={act.error ?? remove.error} />
              {canEdit ? <Button title="Edit plan" variant="ghost" icon="create-outline" onPress={() => router.push({ pathname: "/plan/edit/[id]", params: { id: p.id } })} /> : null}
              {canActivate ? <Button title="Activate plan" icon="play-circle-outline" onPress={() => act.mutate("activate")} loading={act.isPending} /> : null}
              {canComplete ? <Button title="Mark complete" variant="gold" icon="checkmark-done-outline" onPress={() => act.mutate("complete")} loading={act.isPending} /> : null}
              {canCancel ? <Button title="Cancel plan" variant="danger" icon="close-circle-outline" onPress={() => { cancel.reset(); setCancelOpen(true); }} /> : null}
              {canDelete ? <Button title="Delete plan" variant="danger" icon="trash-outline" onPress={() => remove.mutate()} loading={remove.isPending} /> : null}
            </View>
          ) : null}

          <Card>
            <H2>Clinical summary</H2>
            {p.consultation ? <KeyValue k="Complaint" v={p.consultation.chiefComplaint} /> : null}
            {p.consultation?.assessment ? <KeyValue k="Initial pain" v={`${p.consultation.assessment.painScore}/10${p.consultation.assessment.painLocation ? ` (${p.consultation.assessment.painLocation})` : ""}`} /> : null}
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
                  <Text weight="semibold">{i.name}</Text>
                  <Muted style={{ fontSize: 12 }}>
                    {[i.category, i.sets && `${i.sets} sets`, i.reps && `${i.reps} reps`, i.durationMinutes && `${i.durationMinutes} min`].filter(Boolean).join(" · ")}
                  </Muted>
                </View>
              ))
            )}
          </Card>

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
