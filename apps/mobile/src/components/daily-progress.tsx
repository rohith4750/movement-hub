/**
 * Daily progress for a treatment plan: one row per day, newest first. A day without an entry
 * shows the last recorded values, muted and marked "carried forward", until a new entry changes them.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable } from "react-native";
import { Sheet } from "@/components/form";
import { Badge, Button, Card, Chips, ErrorBox, Field, H2, Input, Loading, Muted, Row, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { dayParts, today } from "@/lib/format";
import { PROGRESS_STATUS_LABEL, type ProgressDay, type ProgressLog, type ProgressStatus } from "@/lib/types";
import { colors, space } from "@/theme";

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

export function DailyProgressCard({ planId, canRecord }: { planId: string; canRecord: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["progress-log", planId], queryFn: () => api.get<ProgressLog>(`/treatment-plans/${planId}/progress-log`) });
  const [showAll, setShowAll] = useState(false);
  const [editDay, setEditDay] = useState<string | null>(null);
  const [pain, setPain] = useState("");
  const [status, setStatus] = useState<StatusChoice>("NONE");
  const [notes, setNotes] = useState("");

  const log = q.data;
  const recordable = canRecord && !!log?.editable;
  const todayYmd = today();

  const openSheet = (day: ProgressDay | undefined, date: string) => {
    save.reset();
    setPain(day?.painScore != null ? String(day.painScore) : "");
    setStatus(day?.status ?? "NONE");
    // Notes describe one day: only pre-fill them when that day has its own entry.
    setNotes(day && !day.carriedForward && day.date === day.recordedOn ? day.notes ?? "" : "");
    setEditDay(date);
  };

  const painOk = pain === "" || Number(pain) <= 10;
  const empty = pain === "" && status === "NONE" && !notes.trim();
  const save = useMutation({
    mutationFn: () =>
      api.put(`/treatment-plans/${planId}/progress-log/${editDay}`, {
        painScore: pain === "" ? null : Number(pain),
        status: status === "NONE" ? null : status,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["progress-log", planId] });
      qc.invalidateQueries({ queryKey: ["plan", planId] });
      setEditDay(null);
    },
  });

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
            const nothing = d.painScore == null && !d.status && !d.notes;
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
        <Field label="Notes">
          <Input value={notes} onChangeText={setNotes} multiline maxLength={2000} placeholder="How the patient is doing today" />
        </Field>
        {!painOk ? <Muted style={{ color: colors.warning }}>Pain must be 0–10</Muted> : null}
        <ErrorBox error={save.error} />
      </Sheet>
    </Card>
  );
}

