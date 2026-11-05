/**
 * Daily progress for a treatment plan: one row per day, newest first. A day without an entry
 * shows the last recorded values, muted and marked "carried forward", until a new entry changes them.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Sheet } from "@/components/form";
import { Badge, Button, Card, Chips, ErrorBox, Field, H2, Input, Loading, Muted, Row, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { dayParts, today } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useAction } from "@/lib/refresh";
import { PROGRESS_STATUS_LABEL, type ProgressDay, type ProgressLog, type ProgressStatus } from "@/lib/types";
import { colors } from "@/theme";

const VISIBLE = 14;
type StatusChoice = ProgressStatus | "NONE";

const dayLabel = (d: string) => {
  const x = dayParts(d);
  return `${x.weekday} ${x.day} ${x.month}`;
};
const shortDay = (d: string) => {
  const x = dayParts(d);
  return `${x.day} ${x.month}`;
};
const STATUS_BADGE: Record<ProgressStatus, string> = { IMPROVED: "COMPLETED", SAME: "SCHEDULED", WORSE: "CANCELLED" };

/** A therapy of the plan: it gets its own status each day. */
export interface PlanTherapy {
  id: string;
  name: string;
  category: string;
}

type ItemInput = { status: StatusChoice; note: string };

export function DailyProgressCard({ planId, canRecord, therapies = [] }: { planId: string; canRecord: boolean; therapies?: PlanTherapy[] }) {
  const q = useQuery({ queryKey: qk.progressLog(planId), queryFn: () => api.get<ProgressLog>(`/treatment-plans/${planId}/progress-log`) });
  const [showAll, setShowAll] = useState(false);
  const [editDay, setEditDay] = useState<string | null>(null);
  const [pain, setPain] = useState("");
  const [status, setStatus] = useState<StatusChoice>("NONE");
  const [notes, setNotes] = useState("");
  // Status (and an optional note) for each therapy of the plan, keyed by the therapy's id.
  const [itemInputs, setItemInputs] = useState<Record<string, ItemInput>>({});

  const log = q.data;
  const recordable = canRecord && !!log?.editable;
  const todayYmd = today();

  const openSheet = (day: ProgressDay | undefined, date: string) => {
    save.reset();
    setPain(day?.painScore != null ? String(day.painScore) : "");
    setStatus(day?.status ?? "NONE");
    // Notes describe one day: only pre-fill them when that day has its own entry.
    setNotes(day && !day.carriedForward && day.date === day.recordedOn ? day.notes ?? "" : "");
    // Each therapy starts from its latest status (so only what changed needs touching); a note only belongs to its own day.
    const next: Record<string, ItemInput> = {};
    for (const t of therapies) {
      const found = (day?.items ?? []).find((i) => i.itemId === t.id) ?? (day?.items ?? []).find((i) => i.name === t.name);
      next[t.id] = { status: found?.status ?? "NONE", note: found && !found.carriedForward ? found.note ?? "" : "" };
    }
    setItemInputs(next);
    setEditDay(date);
  };

  const painOk = pain === "" || Number(pain) <= 10;
  const chosen = therapies.filter((t) => (itemInputs[t.id]?.status ?? "NONE") !== "NONE");
  const empty = pain === "" && status === "NONE" && !notes.trim() && chosen.length === 0;
  const save = useAction(
    () =>
      api.put(`/treatment-plans/${planId}/progress-log/${editDay}`, {
        painScore: pain === "" ? null : Number(pain),
        status: status === "NONE" ? null : status,
        notes: notes.trim() || null,
        // Only plans with therapies send this; a server that doesn't know it yet simply ignores it.
        ...(therapies.length ? { items: chosen.map((t) => ({ itemId: t.id, status: itemInputs[t.id].status as ProgressStatus, note: itemInputs[t.id].note.trim() || null })) } : {}),
      }),
    { refresh: ["clinical"], onSuccess: () => setEditDay(null) },
  );

  const days = log?.days ?? [];
  const shown = showAll ? days : days.slice(0, VISIBLE);
  const todayRow = days.find((d) => d.date === todayYmd);

  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <H2>Daily progress</H2>
        {log ? <Muted style={{ fontSize: 12 }}>{log.entries} entr{log.entries === 1 ? "y" : "ies"}</Muted> : null}
      </Row>

      {recordable ? (
        <Button title={todayRow && !todayRow.carriedForward ? "Update today's progress" : "Record today's progress"} icon="create-outline" variant="ghost" onPress={() => openSheet(todayRow, todayYmd)} />
      ) : null}

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : days.length === 0 ? (
        <Muted>No progress yet.</Muted>
      ) : (
        <>
          {shown.map((d) => {
            const nothing = d.painScore == null && !d.status && !d.notes && !(d.items && d.items.length);
            return (
              <Pressable
                key={d.date}
                disabled={!recordable}
                onPress={() => openSheet(d, d.date)}
                accessibilityRole={recordable ? "button" : undefined}
                accessibilityLabel={`Progress ${dayLabel(d.date)}`}
                style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.navy50, opacity: d.carriedForward || nothing ? 0.55 : 1 }}
              >
                <Row style={{ justifyContent: "space-between" }}>
                  <Text weight="semibold">{d.date === todayYmd ? `Today · ${shortDay(d.date)}` : dayLabel(d.date)}</Text>
                  <Row gap={6}>
                    {d.painScore != null ? <Text weight="semibold" style={{ color: colors.navy700 }}>Pain {d.painScore}/10</Text> : null}
                    {d.status ? <Badge status={STATUS_BADGE[d.status]} text={PROGRESS_STATUS_LABEL[d.status]} /> : null}
                  </Row>
                </Row>
                {d.notes ? <Muted numberOfLines={2}>{d.notes}</Muted> : null}
                {d.items && d.items.length ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {d.items.map((i) => (
                      <View key={i.name} style={{ opacity: i.carriedForward ? 0.6 : 1 }}>
                        <Badge status={STATUS_BADGE[i.status]} text={`${i.name}: ${PROGRESS_STATUS_LABEL[i.status]}`} />
                      </View>
                    ))}
                  </View>
                ) : null}
                {d.items && d.items.some((i) => i.note) ? <Muted style={{ fontSize: 12 }} numberOfLines={2}>{d.items.filter((i) => i.note).map((i) => `${i.name}: ${i.note}`).join(" · ")}</Muted> : null}
                {nothing ? (
                  <Muted style={{ fontSize: 12 }}>No entry</Muted>
                ) : d.carriedForward && d.recordedOn ? (
                  <Muted style={{ fontSize: 12, fontStyle: "italic" }}>No entry — carried from {shortDay(d.recordedOn)}</Muted>
                ) : null}
              </Pressable>
            );
          })}
          {days.length > VISIBLE ? (
            <Button title={showAll ? "Show less" : `Show all ${days.length} days`} variant="ghost" small onPress={() => setShowAll((v) => !v)} style={{ alignSelf: "flex-start" }} />
          ) : null}
        </>
      )}

      <Sheet
        open={editDay !== null}
        onClose={() => setEditDay(null)}
        title={editDay ? `Progress · ${editDay === todayYmd ? "Today" : dayLabel(editDay)}` : "Progress"}
        footer={<Button title="Save progress" icon="save-outline" onPress={() => save.mutate()} disabled={!painOk || empty} loading={save.isPending} />}
      >
        <Muted>Days without an entry keep showing the last values until you record a change.</Muted>
        <Field label="Pain score (0–10)">
          <Input value={pain} onChangeText={(t) => setPain(t.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" placeholder="e.g. 4" />
        </Field>
        <Field label="Status">
          <Chips<StatusChoice>
            value={status}
            onChange={setStatus}
            options={[
              { value: "IMPROVED", label: "Improved" },
              { value: "SAME", label: "Same" },
              { value: "WORSE", label: "Worse" },
              { value: "NONE", label: "Not set" },
            ]}
          />
        </Field>
        {therapies.length ? (
          <View style={{ gap: 10 }}>
            <Text weight="semibold" style={{ color: colors.navy700 }}>Therapies in this plan</Text>
            {therapies.map((t) => {
              const input = itemInputs[t.id] ?? { status: "NONE" as StatusChoice, note: "" };
              return (
                <View key={t.id} style={{ gap: 6 }}>
                  <Text weight="semibold" style={{ fontSize: 13 }}>{t.name} <Text style={{ fontSize: 12, color: colors.muted }}>· {t.category}</Text></Text>
                  <Chips<StatusChoice>
                    value={input.status}
                    onChange={(v) => setItemInputs((m) => ({ ...m, [t.id]: { ...input, status: v } }))}
                    options={[
                      { value: "IMPROVED", label: "Improved" },
                      { value: "SAME", label: "Same" },
                      { value: "WORSE", label: "Worse" },
                      { value: "NONE", label: "Not set" },
                    ]}
                  />
                  {input.status !== "NONE" ? (
                    <Input value={input.note} onChangeText={(v) => setItemInputs((m) => ({ ...m, [t.id]: { ...input, note: v } }))} maxLength={500} placeholder={`Note for ${t.name} (optional)`} />
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
        <Field label="Notes">
          <Input value={notes} onChangeText={setNotes} multiline maxLength={2000} placeholder="How the patient is doing today" />
        </Field>
        {!painOk ? <Muted style={{ color: colors.warning }}>Pain must be 0–10</Muted> : null}
        <ErrorBox error={save.error} />
      </Sheet>
    </Card>
  );
}

