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
}

export const emptyItem = (): PlanItemDraft => ({ category: "Exercise Therapy", name: "", sets: "", reps: "" });

/** Convert editor rows to the API's item shape (blank rows dropped). */
export const toApiItems = (items: PlanItemDraft[]) =>
  items
    .filter((i) => i.name.trim())
    .map((i, n) => ({
      category: i.category,
      name: i.name.trim(),
      sets: i.sets ? Number(i.sets) : undefined,
      reps: i.reps ? Number(i.reps) : undefined,
      sortOrder: n,
    }));

const digits = (t: string) => t.replace(/\D/g, "").slice(0, 3);

/** What the plan uses when a number is left empty, and the most the server accepts (so a typed number is never refused). */
const DEFAULT_SESSIONS = 10;
const DEFAULT_PER_WEEK = 3;
const MAX_SESSIONS = 200;
const MAX_PER_WEEK = 14;
const capped = (t: string, max: number) => {
  const d = digits(t);
  return d && Number(d) > max ? String(max) : d;
};

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

/** Editable list of prescribed treatments (category + name + sets / reps). Nothing in it is required. */
export function PlanItemsEditor({ items, onChange }: { items: PlanItemDraft[]; onChange: (items: PlanItemDraft[]) => void }) {
  const update = (i: number, patch: Partial<PlanItemDraft>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <View style={{ gap: space.md }}>
      <Caption>Prescribed treatments (optional)</Caption>
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
          <Input placeholder="Treatment, e.g. Core strengthening" value={it.name} onChangeText={(t) => update(i, { name: t })} />
          <Row gap={space.sm}>
            {/* minWidth 0: a text box otherwise keeps its natural width and pushes the second one out of the card */}
            <Input style={{ flex: 1, minWidth: 0 }} placeholder="Sets" keyboardType="number-pad" value={it.sets} onChangeText={(t) => update(i, { sets: digits(t) })} />
            <Input style={{ flex: 1, minWidth: 0 }} placeholder="Reps" keyboardType="number-pad" value={it.reps} onChangeText={(t) => update(i, { reps: digits(t) })} />
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
  /** Total sessions prescribed. */
  sessions: string;
  /** Sessions per week. */
  perWeek: string;
  instructions: string;
}
export const emptyPlan = (): PlanDraft => ({ title: "", diagnosis: "", goals: "", sessions: String(DEFAULT_SESSIONS), perWeek: String(DEFAULT_PER_WEEK), instructions: "" });

export function PlanFields({ plan, onChange, showExtras }: { plan: PlanDraft; onChange: (p: PlanDraft) => void; showExtras?: boolean }) {
  const set = (k: keyof PlanDraft) => (t: string) => onChange({ ...plan, [k]: k === "sessions" ? capped(t, MAX_SESSIONS) : k === "perWeek" ? capped(t, MAX_PER_WEEK) : t });
  return (
    <View style={{ gap: space.md }}>
      <Field label="Plan title" hint="Optional — uses the diagnosis if left empty"><Input value={plan.title} onChangeText={set("title")} placeholder="e.g. Lower back rehab" /></Field>
      <Field label="Diagnosis"><Input value={plan.diagnosis} onChangeText={set("diagnosis")} /></Field>
      {showExtras ? <Field label="Goals"><Input value={plan.goals} onChangeText={set("goals")} /></Field> : null}
      <Row gap={space.sm}>
        <View style={{ flex: 1 }}><Field label="Total sessions"><Input keyboardType="number-pad" value={plan.sessions} onChangeText={set("sessions")} placeholder={String(DEFAULT_SESSIONS)} /></Field></View>
        <View style={{ flex: 1 }}><Field label="Sessions per week"><Input keyboardType="number-pad" value={plan.perWeek} onChangeText={set("perWeek")} placeholder={String(DEFAULT_PER_WEEK)} /></Field></View>
      </Row>
      {showExtras ? <Field label="Instructions"><Input multiline value={plan.instructions} onChangeText={set("instructions")} /></Field> : null}
    </View>
  );
}

/** A number from a text box: empty (or 0) means "not set", so the plan's default is used instead of blocking the save. */
const orDefault = (t: string, fallback: number, max: number) => Math.min(Math.max(Number(t) || fallback, 1), max);

/** Body for POST /treatment-plans from the drafts. Nothing is required: empty numbers use the defaults, and treatments can be left out. */
export const planBody = (plan: PlanDraft, items: PlanItemDraft[]) => ({
  title: plan.title.trim() || undefined,
  diagnosis: plan.diagnosis.trim() || undefined,
  goals: plan.goals.trim() || undefined,
  instructions: plan.instructions.trim() || undefined,
  prescribedSessions: orDefault(plan.sessions, DEFAULT_SESSIONS, MAX_SESSIONS),
  frequencyPerWeek: orDefault(plan.perWeek, DEFAULT_PER_WEEK, MAX_PER_WEEK),
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

  // The only thing a plan can't be saved without is whose plan it is; physiotherapists are never asked (it is always them).
  const problem = !isPhysio && !therapistId ? "Choose the treating physiotherapist" : null;

  return (
    <View style={{ gap: space.md }}>
      <PlanFields plan={plan} onChange={setPlan} />
      {!isPhysio ? (
        <SelectField
          label="Treating physiotherapist"
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
