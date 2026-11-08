/**
 * Create or edit a treatment plan (title, diagnosis, goals, numbers, instructions, treating physio,
 * prescribed treatments). Editing syncs treatments: removed → deleted, changed → updated, new → added.
 */
import { useState } from "react";
import { Switch, View } from "react-native";
import { emptyItem, emptyPlan, planBody, PlanFields, PlanItemsEditor, toApiItems, type PlanDraft, type PlanItemDraft } from "@/components/clinical-plan-form";
import { SelectField } from "@/components/form";
import { Button, Card, ErrorBox, Muted, Row, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PlanReplaceCancelled, withActivePlanCheck } from "@/lib/plan-activation";
import { useTherapists } from "@/lib/queries";
import { useAction } from "@/lib/refresh";
import type { TreatmentPlan } from "@/lib/types";
import { colors, space } from "@/theme";

export function PlanEditor({ plan, patientId, onSaved }: { plan?: TreatmentPlan; patientId?: string; onSaved: (planId: string) => void }) {
  const user = useAuth((s) => s.user);
  const editing = !!plan;
  const therapists = useTherapists();

  const [draft, setDraft] = useState<PlanDraft>(() =>
    plan
      ? {
          title: plan.title,
          diagnosis: plan.diagnosis ?? "",
          goals: plan.goals ?? "",
          sessions: String(plan.prescribedSessions),
          perWeek: String(plan.frequencyPerWeek),
          instructions: plan.instructions ?? "",
        }
      : emptyPlan(),
  );
  const [items, setItems] = useState<PlanItemDraft[]>(() =>
    plan?.items.length
      ? plan.items.map((i) => ({ id: i.id, category: i.category, name: i.name, sets: i.sets?.toString() ?? "", reps: i.reps?.toString() ?? "" }))
      : [emptyItem()],
  );
  const [therapistId, setTherapistId] = useState(plan?.therapist.id ?? user?.therapistId ?? "");
  const [activate, setActivate] = useState(true);

  const save = useAction(
    async () => {
      const body = planBody(draft, items);
      if (!editing) {
        // Starting it now while the patient has another active plan asks to replace that one.
        const created = activate
          ? await withActivePlanCheck((replaceActive) => api.post<{ id: string }>("/treatment-plans", { ...body, patientId, therapistId, activate, replaceActive }))
          : await api.post<{ id: string }>("/treatment-plans", { ...body, patientId, therapistId, activate });
        return created.id;
      }
      const { items: _ignored, ...fields } = body;
      await api.patch(`/treatment-plans/${plan.id}`, { ...fields, therapistId });
      // Sync treatments with the editor rows.
      const rows = items.filter((i) => i.name.trim());
      const apiRows = toApiItems(rows);
      const kept = new Set(rows.filter((r) => r.id).map((r) => r.id));
      for (const old of plan.items) if (!kept.has(old.id)) await api.del(`/treatment-plans/${plan.id}/items/${old.id}`);
      for (const [n, r] of rows.entries()) {
        if (r.id) await api.patch(`/treatment-plans/${plan.id}/items/${r.id}`, apiRows[n]);
        else await api.post(`/treatment-plans/${plan.id}/items`, apiRows[n]);
      }
      return plan.id;
    },
    { refresh: ["clinical"], onSuccess: (id) => onSaved(id) },
  );

  // Nothing about the plan itself is required any more. Only who it is for (the patient, the physiotherapist) has to be known;
  // a physiotherapist is never asked, because the plan is theirs.
  const isPhysio = !!user && user.role === "PHYSIOTHERAPIST";
  const problem = !editing && !patientId ? "Choose the patient" : !therapistId ? "Choose the treating physiotherapist" : null;

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.md }}>
        <PlanFields plan={draft} onChange={setDraft} showExtras />
        {!isPhysio ? (
          <SelectField
            label="Treating physiotherapist"
            value={therapistId}
            onChange={setTherapistId}
            placeholder={therapists.isLoading ? "Loading…" : "Select"}
            options={(therapists.data ?? []).map((t) => ({ value: t.id, label: t.user.name }))}
          />
        ) : null}
      </Card>
      <Card>
        <PlanItemsEditor items={items} onChange={setItems} />
      </Card>
      {!editing ? (
        <Card>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text weight="semibold">Start the plan now</Text>
              <Muted style={{ fontSize: 12 }}>Off = save as a draft and activate later.</Muted>
            </View>
            <Switch value={activate} onValueChange={setActivate} trackColor={{ true: colors.gold500, false: colors.navy100 }} thumbColor={colors.white} />
          </Row>
        </Card>
      ) : null}
      <ErrorBox error={save.error instanceof PlanReplaceCancelled ? null : save.error} />
      {problem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
      <Button title={editing ? "Save changes" : activate ? "Create & activate plan" : "Save draft plan"} icon="checkmark-circle-outline" onPress={() => save.mutate()} disabled={!!problem} loading={save.isPending} />
    </View>
  );
}
