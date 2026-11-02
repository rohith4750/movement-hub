import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { emptyItem, emptyPlan, PainScale, PlanFields, PlanItemsEditor, planBody, planProblem, type PlanDraft, type PlanItemDraft } from "@/components/clinical-plan-form";
import { DateField, goBack, RequireRole, SectionTitle } from "@/components/form";
import { Button, Card, ErrorBox, Field, Input, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fullName, label, time, today } from "@/lib/format";
import type { Appointment } from "@/lib/types";
import { colors, space } from "@/theme";

export default function NewConsultation() {
  // POST /consultations is physiotherapist-only (Super Admin passes too).
  return (
    <RequireRole roles={["PHYSIOTHERAPIST"]} title="Consultation">
      <ConsultationLoader />
    </RequireRole>
  );
}

function ConsultationLoader() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const id = typeof appointmentId === "string" ? appointmentId : "";
  const q = useQuery({ queryKey: ["appointment", id], queryFn: () => api.get<Appointment>(`/appointments/${id}`), enabled: !!id });
  if (!id) {
    return (
      <Screen edges={["top", "bottom"]}>
        <TopBar title="Consultation" onBack={() => goBack("/appointments")} />
        <ErrorBox error="Open the consultation from an appointment." />
      </Screen>
    );
  }
  if (!q.data) {
    return (
      <Screen edges={["top", "bottom"]}>
        <TopBar title="Consultation" onBack={() => goBack("/appointments")} />
        {q.isLoading ? <Loading /> : <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      </Screen>
    );
  }
  return <ConsultationForm appt={q.data} />;
}

type Pair = { a: string; b: string };

function ConsultationForm({ appt }: { appt: Appointment }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const mine = user?.role === "SUPER_ADMIN" || user?.therapistId === appt.therapist.id;
  const isConsult = appt.type === "INITIAL_CONSULTATION" || appt.type === "FOLLOW_UP_CONSULTATION";
  const closed = ["CANCELLED", "NO_SHOW", "RESCHEDULED"].includes(appt.status);

  const [c, setC] = useState({ chiefComplaint: "", symptoms: "", historyOfIllness: "", clinicalImpression: "", recommendations: "", followUpDate: "" });
  const [a, setA] = useState({ painLocation: "", painType: "", aggravatingFactors: "", relievingFactors: "", posture: "", mobilityStatus: "", gait: "", observations: "" });
  const [pain, setPain] = useState(5);
  const [diagnosis, setDiagnosis] = useState("");
  const [rom, setRom] = useState<Pair[]>([]);
  const [tests, setTests] = useState<Pair[]>([]);
  const [makePlan, setMakePlan] = useState(true);
  const [plan, setPlan] = useState<PlanDraft>(emptyPlan);
  const [items, setItems] = useState<PlanItemDraft[]>(() => [emptyItem()]);
  // Remember what was saved so pressing Save again after an error never creates duplicates.
  const createdPlanId = useRef<string | null>(null);

  const setCF = (k: keyof typeof c) => (t: string) => setC((x) => ({ ...x, [k]: t }));
  const setAF = (k: keyof typeof a) => (t: string) => setA((x) => ({ ...x, [k]: t }));
  const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v !== "" && v !== undefined));

  const save = useMutation({
    mutationFn: async () => {
      const assessment = {
        ...clean(a),
        painScore: pain,
        rangeOfMotion: rom.some((r) => r.a.trim()) ? Object.fromEntries(rom.filter((r) => r.a.trim()).map((r) => [r.a.trim(), r.b.trim()])) : undefined,
        specialTests: tests.some((t) => t.a.trim()) ? tests.filter((t) => t.a.trim()).map((t) => ({ name: t.a.trim(), result: t.b.trim() })) : undefined,
        diagnosis: diagnosis.trim() || undefined,
      };

      // 1. Consultation — create, or update if an earlier attempt already saved it.
      const current = await api.get<Appointment>(`/appointments/${appt.id}`);
      let consultationId = current.consultation?.id;
      if (consultationId) {
        await api.patch(`/consultations/${consultationId}`, clean(c));
        await api.put(`/consultations/${consultationId}/assessment`, assessment);
      } else {
        consultationId = (await api.post<{ id: string }>("/consultations", { appointmentId: appt.id, ...clean(c), assessment })).id;
      }

      // 2. Treatment plan — owned by this appointment's physiotherapist, created already active.
      let planId = createdPlanId.current;
      if (makePlan && !planId) {
        const p = await api.post<{ id: string }>("/treatment-plans", {
          // Plan diagnosis defaults to the assessment's diagnosis when left empty.
          ...planBody({ ...plan, diagnosis: plan.diagnosis.trim() || diagnosis }, items),
          patientId: current.patient.id,
          consultationId,
          therapistId: current.therapist.id,
          activate: true,
        });
        planId = createdPlanId.current = p.id;
      }

      // 3. Close the visit.
      if (current.status !== "COMPLETED") await api.patch(`/appointments/${appt.id}/complete`);
      return { planId, patientId: current.patient.id };
    },
    onSuccess: ({ planId, patientId }) => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["appointment", appt.id] });
      qc.invalidateQueries({ queryKey: ["patient", patientId] });
      qc.invalidateQueries({ queryKey: ["plans"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (planId) router.replace({ pathname: "/plan/[id]", params: { id: planId } });
      else router.replace({ pathname: "/patient/[id]", params: { id: patientId } });
    },
  });

  const problem = !mine
    ? `This consultation belongs to ${appt.therapist.user.name}.`
    : !isConsult
      ? "This appointment is not a consultation."
      : closed
        ? `This appointment is ${label(appt.status).toLowerCase()}.`
        : makePlan
            ? planProblem(plan, items)
            : null;

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title="Consultation" onBack={() => goBack({ pathname: "/appointment/[id]", params: { id: appt.id } })} />
      <Card style={{ backgroundColor: colors.navy700, borderColor: colors.navy700 }}>
        <Text weight="bold" style={{ color: colors.white, fontSize: 18 }}>{fullName(appt.patient)}</Text>
        <Text style={{ color: colors.gold300 }}>{appt.patient.patientCode} · {label(appt.type)} · {time(appt.startAt)}</Text>
        <Text style={{ color: colors.navy100, fontSize: 12 }}>{appt.appointmentNo} · {appt.therapist.user.name}</Text>
      </Card>

      <Card style={{ gap: space.md }}>
        <SectionTitle>Consultation</SectionTitle>
        <Field label="Chief complaint"><Input value={c.chiefComplaint} onChangeText={setCF("chiefComplaint")} placeholder="e.g. Low back pain for 3 weeks" /></Field>
        <Field label="Symptoms"><Input value={c.symptoms} onChangeText={setCF("symptoms")} /></Field>
        <Field label="History of present illness"><Input multiline value={c.historyOfIllness} onChangeText={setCF("historyOfIllness")} /></Field>
        <Field label="Clinical impression"><Input multiline value={c.clinicalImpression} onChangeText={setCF("clinicalImpression")} /></Field>
        <Field label="Recommendations"><Input multiline value={c.recommendations} onChangeText={setCF("recommendations")} /></Field>
        <DateField label="Follow-up date" value={c.followUpDate} onChange={setCF("followUpDate")} minimumDate={new Date(`${today()}T12:00:00`)} clearable />
      </Card>

      <Card style={{ gap: space.md }}>
        <SectionTitle>Clinical assessment</SectionTitle>
        <PainScale label="Pain score" value={pain} onChange={setPain} />
        <Field label="Pain location"><Input value={a.painLocation} onChangeText={setAF("painLocation")} /></Field>
        <Field label="Pain type"><Input value={a.painType} onChangeText={setAF("painType")} placeholder="sharp, dull, radiating…" /></Field>
        <Field label="Aggravating factors"><Input value={a.aggravatingFactors} onChangeText={setAF("aggravatingFactors")} /></Field>
        <Field label="Relieving factors"><Input value={a.relievingFactors} onChangeText={setAF("relievingFactors")} /></Field>
        <Field label="Posture"><Input value={a.posture} onChangeText={setAF("posture")} /></Field>
        <Field label="Mobility status"><Input value={a.mobilityStatus} onChangeText={setAF("mobilityStatus")} /></Field>
        <Field label="Gait"><Input value={a.gait} onChangeText={setAF("gait")} /></Field>
        <Field label="Observations"><Input multiline value={a.observations} onChangeText={setAF("observations")} /></Field>

        <PairRows title="Range of motion" aPlaceholder="e.g. Shoulder flexion (L)" bPlaceholder="120°" rows={rom} onChange={setRom} addLabel="Add measurement" />
        <PairRows title="Special tests" aPlaceholder="e.g. SLR" bPlaceholder="Result" rows={tests} onChange={setTests} addLabel="Add test" />
      </Card>

      <Card style={{ gap: space.md }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text weight="bold" style={{ flex: 1, color: colors.navy700, fontSize: 16 }}>Create treatment plan now</Text>
          <Switch value={makePlan} onValueChange={setMakePlan} trackColor={{ true: colors.gold500, false: colors.navy100 }} thumbColor={colors.white} />
        </Row>
        {makePlan ? (
          <>
            <PlanFields plan={plan} onChange={setPlan} showExtras />
            <PlanItemsEditor items={items} onChange={setItems} />
          </>
        ) : (
          <Muted style={{ fontSize: 12 }}>You can create the plan later from the patient&apos;s profile.</Muted>
        )}
      </Card>

      <Card style={{ gap: space.md }}>
        <SectionTitle>Diagnosis</SectionTitle>
        <Field label="Diagnosis" hint={makePlan ? "Also used as the plan's diagnosis if that is left empty" : undefined}>
          <Input multiline value={diagnosis} onChangeText={setDiagnosis} placeholder="e.g. Lumbar disc prolapse L4–L5" />
        </Field>
      </Card>

      <ErrorBox error={save.error} />
      {problem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
      <Button title={makePlan ? "Save consultation & activate plan" : "Save consultation"} icon="checkmark-done-outline" onPress={() => save.mutate()} disabled={!!problem} loading={save.isPending} />
    </Screen>
  );
}

function PairRows({ title, rows, onChange, aPlaceholder, bPlaceholder, addLabel }: { title: string; rows: Pair[]; onChange: (r: Pair[]) => void; aPlaceholder: string; bPlaceholder: string; addLabel: string }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text weight="semibold" style={{ fontSize: 13, color: colors.navy500 }}>{title}</Text>
      {rows.map((r, i) => (
        <Row key={i} gap={space.sm}>
          <Input style={{ flex: 1.6 }} placeholder={aPlaceholder} value={r.a} onChangeText={(t) => onChange(rows.map((x, j) => (j === i ? { ...x, a: t } : x)))} />
          <Input style={{ flex: 1 }} placeholder={bPlaceholder} value={r.b} onChangeText={(t) => onChange(rows.map((x, j) => (j === i ? { ...x, b: t } : x)))} />
          <Pressable onPress={() => onChange(rows.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel={`Remove ${title} row`}>
            <Ionicons name="close-circle" size={22} color={colors.danger} />
          </Pressable>
        </Row>
      ))}
      <Button title={addLabel} variant="ghost" small icon="add" onPress={() => onChange([...rows, { a: "", b: "" }])} style={{ alignSelf: "flex-start" }} />
    </View>
  );
}
