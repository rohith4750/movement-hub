/**
 * Clinical building blocks shared by the patient, consultation and plan screens:
 * pain scale, treatment-item editor, and the quick "create treatment plan" form.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SelectField } from "@/components/form";
import { Button, Caption, ErrorBox, Field, Input, Muted, Row, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PlanReplaceCancelled, withActivePlanCheck } from "@/lib/plan-activation";
import { useTherapists } from "@/lib/queries";
import { useAction } from "@/lib/refresh";
import { colors, radius, space } from "@/theme";

export const PLAN_CATEGORIES = ["Exercise Therapy", "Manual Therapy", "Myofascial Release", "Mobility", "Strength & Conditioning", "Electrotherapy", "Taping", "Dry Needling", "Hot/Cold Therapy", "Traction", "Education"];

export interface PlanItemDraft {
  /** Set for treatments that already exist on a saved plan (used when editing). */
  id?: string;
  category: string;
  name: string;
  sets: string;
  reps: string;
  minutes: string;
}

export const emptyItem = (): PlanItemDraft => ({ category: "Exercise Therapy", name: "", sets: "", reps: "", minutes: "" });

/** Convert editor rows to the API's item shape (blank rows dropped). */
export const toApiItems = (items: PlanItemDraft[]) =>
  items
    .filter((i) => i.name.trim())
    .map((i, n) => ({
      category: i.category,
      name: i.name.trim(),
      sets: i.sets ? Number(i.sets) : undefined,
      reps: i.reps ? Number(i.reps) : undefined,
      durationMinutes: i.minutes ? Number(i.minutes) : undefined,
      sortOrder: n,
    }));

const digits = (t: string) => t.replace(/\D/g, "").slice(0, 3);

/** 0–10 pain buttons, green → amber → red. */
export function PainScale({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Field label={`${label}: ${value}/10`}>
      <View style={styles.scale}>
        {Array.from({ length: 11 }, (_, n) => {
          const on = n === value;
          const hue = n <= 3 ? colors.success : n <= 6 ? colors.warning : colors.danger;
          return (
            <Pressable key={n} onPress={() => onChange(n)} accessibilityRole="button" accessibilityLabel={`Pain ${n}`} accessibilityState={{ selected: on }} style={[styles.scaleBtn, on && { backgroundColor: hue, borderColor: hue }]}>
              <Text weight="semibold" style={{ fontSize: 13, color: on ? colors.white : colors.navy700 }}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

/** Editable list of prescribed treatments (category + name + sets / reps / minutes). */
export function PlanItemsEditor({ items, onChange }: { items: PlanItemDraft[]; onChange: (items: PlanItemDraft[]) => void }) {
  const update = (i: number, patch: Partial<PlanItemDraft>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <View style={{ gap: space.md }}>
      <Caption>Prescribed treatments *</Caption>
      {items.map((it, i) => (
        <View key={i} style={styles.item}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text weight="semibold" style={{ fontSize: 13, color: colors.navy500 }}>Treatment {i + 1}</Text>
            {items.length > 1 ? (
              <Pressable onPress={() => onChange(items.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel={`Remove treatment ${i + 1}`}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
            ) : null}
          </Row>
          <SelectField label="Category" value={it.category} options={PLAN_CATEGORIES.map((c) => ({ value: c, label: c }))} onChange={(v) => update(i, { category: v })} />
          <Input placeholder="Treatment / exercise, e.g. Core strengthening" value={it.name} onChangeText={(t) => update(i, { name: t })} />
          <Row gap={space.sm}>
            <Input style={{ flex: 1 }} placeholder="Sets" keyboardType="number-pad" value={it.sets} onChangeText={(t) => update(i, { sets: digits(t) })} />
            <Input style={{ flex: 1 }} placeholder="Reps" keyboardType="number-pad" value={it.reps} onChangeText={(t) => update(i, { reps: digits(t) })} />
            <Input style={{ flex: 1 }} placeholder="Minutes" keyboardType="number-pad" value={it.minutes} onChangeText={(t) => update(i, { minutes: digits(t) })} />
          </Row>
        </View>
      ))}
      <Button title="Add treatment" variant="ghost" small icon="add" onPress={() => onChange([...items, emptyItem()])} style={{ alignSelf: "flex-start" }} />
    </View>
  );
}

/** Plan header fields (title, diagnosis, numbers). Used by the quick form and the consultation screen. */
export interface PlanDraft {
  title: string;
  diagnosis: string;
  goals: string;
  sessions: string;
  perWeek: string;
  minutes: string;
  instructions: string;
}
export const emptyPlan = (): PlanDraft => ({ title: "", diagnosis: "", goals: "", sessions: "10", perWeek: "3", minutes: "30", instructions: "" });

export function PlanFields({ plan, onChange, showExtras }: { plan: PlanDraft; onChange: (p: PlanDraft) => void; showExtras?: boolean }) {
  const set = (k: keyof PlanDraft) => (t: string) => onChange({ ...plan, [k]: k === "sessions" || k === "perWeek" || k === "minutes" ? digits(t) : t });
  return (
    <View style={{ gap: space.md }}>
      <Field label="Plan title" hint="Optional — uses the diagnosis if left empty"><Input value={plan.title} onChangeText={set("title")} placeholder="e.g. Lower back rehab" /></Field>
      <Field label="Diagnosis"><Input value={plan.diagnosis} onChangeText={set("diagnosis")} /></Field>
      {showExtras ? <Field label="Goals"><Input value={plan.goals} onChangeText={set("goals")} /></Field> : null}
      <Row gap={space.sm}>
        <View style={{ flex: 1 }}><Field label="Sessions"><Input keyboardType="number-pad" value={plan.sessions} onChangeText={set("sessions")} /></Field></View>
        <View style={{ flex: 1 }}><Field label="Per week"><Input keyboardType="number-pad" value={plan.perWeek} onChangeText={set("perWeek")} /></Field></View>
        <View style={{ flex: 1 }}><Field label="Minutes"><Input keyboardType="number-pad" value={plan.minutes} onChangeText={set("minutes")} /></Field></View>
      </Row>
      {showExtras ? <Field label="Instructions"><Input multiline value={plan.instructions} onChangeText={set("instructions")} /></Field> : null}
    </View>
  );
}

/** Why a plan draft can't be saved yet (null = OK). Mirrors the API's limits. */
export function planProblem(plan: PlanDraft, items: PlanItemDraft[]): string | null {
  const s = Number(plan.sessions);
  const w = Number(plan.perWeek);
  const m = Number(plan.minutes);
  if (!(s >= 1 && s <= 200)) return "Sessions must be 1–200";
  if (!(w >= 1 && w <= 14)) return "Sessions per week must be 1–14";
  if (!(m >= 10 && m <= 180)) return "Minutes per session must be 10–180";
  if (!items.some((i) => i.name.trim())) return "Add at least one treatment";
  return null;
}

/** Body for POST /treatment-plans from the drafts. */
export const planBody = (plan: PlanDraft, items: PlanItemDraft[]) => ({
  title: plan.title.trim() || undefined,
  diagnosis: plan.diagnosis.trim() || undefined,
  goals: plan.goals.trim() || undefined,
  instructions: plan.instructions.trim() || undefined,
  prescribedSessions: Number(plan.sessions),
  frequencyPerWeek: Number(plan.perWeek),
  sessionMinutes: Number(plan.minutes),
  items: toApiItems(items),
});

/**
 * Quick plan form (inside a Sheet). Creates the plan already ACTIVE.
 * Physiotherapists own the plans they write; admins choose the treating physiotherapist.
 */
export function QuickPlanForm({ patientId, onCreated, onCancel }: { patientId: string; onCreated: (planId: string) => void; onCancel: () => void }) {
  const user = useAuth((s) => s.user);
  const isPhysio = user?.role === "PHYSIOTHERAPIST";
  const therapists = useTherapists({ enabled: !isPhysio });
  const [plan, setPlan] = useState<PlanDraft>(emptyPlan);
  const [items, setItems] = useState<PlanItemDraft[]>(() => [emptyItem()]);
  const [therapistId, setTherapistId] = useState("");

  const save = useAction(
    () =>
      withActivePlanCheck((replaceActive) =>
        api.post<{ id: string }>("/treatment-plans", { ...planBody(plan, items), patientId, therapistId: isPhysio ? undefined : therapistId, activate: true, replaceActive }),
      ),
    { refresh: ["clinical"], onSuccess: (p) => onCreated(p.id) },
  );

  const problem = planProblem(plan, items) ?? (!isPhysio && !therapistId ? "Choose the treating physiotherapist" : null);

  return (
    <View style={{ gap: space.md }}>
      <PlanFields plan={plan} onChange={setPlan} />
      {!isPhysio ? (
        <SelectField
          label="Treating physiotherapist *"
          value={therapistId}
          onChange={setTherapistId}
          placeholder={therapists.isLoading ? "Loading…" : "Select"}
          options={(therapists.data ?? []).map((t) => ({ value: t.id, label: t.user.name }))}
        />
      ) : null}
      <PlanItemsEditor items={items} onChange={setItems} />
      <ErrorBox error={save.error instanceof PlanReplaceCancelled ? null : save.error} />
      {problem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
      <Row>
        <Button title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button title="Create & activate" onPress={() => save.mutate()} disabled={!!problem} loading={save.isPending} style={{ flex: 1 }} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  scale: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  scaleBtn: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  item: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
});
