import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, StyleSheet, Switch, View } from "react-native";
import { PinBadge, SetPinSheet } from "@/components/admin-pin";
import { DateField, RequireRole, SectionTitle, SelectField, Sheet, goBack, type Option } from "@/components/form";
import { Badge, Button, Card, ErrorBox, Field, Input, KeyValue, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { date, dateTime, fullName, today } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { forget, refresh, useAction } from "@/lib/refresh";
import { colors, radius, space } from "@/theme";

interface TherapistDetail {
  id: string;
  userId: string;
  qualification: string;
  experienceYears: number;
  colorTag: string | null;
  isAvailableForHomeVisit: boolean;
  isActive: boolean;
  registrationNo: string | null;
  bio: string | null;
  user: { id: string; name: string; email: string | null; phone: string; isActive: boolean };
  specializations: { specialization: { id: string; name: string } }[];
  schedules: ScheduleRow[];
}
interface ScheduleRow { dayOfWeek: string; startTime: string; endTime: string; breakStart: string | null; breakEnd: string | null; slotMinutes: number }
interface Leave { id: string; startDate: string; endDate: string; reason: string | null; status: "PENDING" | "APPROVED" | "REJECTED" }
interface Conflict { id: string; appointmentNo: string; startAt: string; patient: { firstName: string; lastName: string | null; phone: string } }
type Day = { dayOfWeek: string; on: boolean; startTime: string; endTime: string; breakStart: string; breakEnd: string; slotMinutes: number };

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_NAMES: Record<string, string> = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };
const TIME_OPTIONS: Option[] = Array.from({ length: (22 - 6) * 4 + 1 }, (_, i) => {
  const m = 6 * 60 + i * 15;
  const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  return { value: v, label: `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` };
});
const SLOT_OPTIONS: Option[] = [15, 20, 30, 45, 60].map((n) => ({ value: String(n), label: `${n} min` }));
const BREAK_OPTIONS: Option[] = [{ value: "", label: "No break" }, ...TIME_OPTIONS];
const timeLabel = (v: string | null) => TIME_OPTIONS.find((o) => o.value === v)?.label ?? v ?? "—";

export default function TherapistScreen() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"]} title="Physiotherapist">
      <TherapistDetailScreen />
    </RequireRole>
  );
}

function TherapistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isAdmin = hasRole(user, "ADMIN");
  const isSelf = user?.role === "PHYSIOTHERAPIST" && user.therapistId === id;
  const canLeave = isAdmin || isSelf;

  const q = useQuery({ queryKey: qk.therapist(id), queryFn: () => api.get<TherapistDetail>(`/therapists/${id}`), enabled: !!id });
  // PIN status comes from the list endpoint (detail never exposes PIN data).
  const list = useQuery({
    queryKey: qk.therapists.list({ admin: true }),
    queryFn: () => api.get<{ id: string; user: { hasPin?: boolean } }[]>("/therapists", { includeInactive: true }),
    enabled: isAdmin,
  });
  const hasPin = list.data?.find((t) => t.id === id)?.user.hasPin;
  const leaves = useQuery({ queryKey: qk.leaves(id), queryFn: () => api.get<Leave[]>(`/therapists/${id}/leaves`), enabled: !!id && canLeave });

  const [pinFor, setPinFor] = useState<{ id: string; name: string; hasPin?: boolean } | null>(null);
  const [editing, setEditing] = useState<Day[] | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [generated, setGenerated] = useState<number | null>(null);

  const generate = useAction(() => api.post<{ created: number }>(`/therapists/${id}/slots/generate`, { from: today(), to: addDaysYmd(today(), 30) }), {
    refresh: ["schedule"],
    onSuccess: (r) => setGenerated(r.created),
  });
  const decide = useAction(
    ({ leaveId, status }: { leaveId: string; status: "APPROVED" | "REJECTED" }) => api.patch<{ conflicts: Conflict[] }>(`/therapists/${id}/leaves/${leaveId}`, { status }),
    {
      refresh: ["schedule"],
      onSuccess: (r) => {
        if (r.conflicts?.length) setConflicts(r.conflicts);
      },
    },
  );
  const remove = useAction(
    async () => {
      const name = q.data?.user.name ?? "this physiotherapist";
      if (!(await confirm(`Delete ${name}?`, "They can no longer sign in and their free slots disappear from booking. Past consultations and sessions stay for history. Upcoming appointments must be rescheduled first.", "Delete", true))) return null;
      return api.del(`/therapists/${id}`);
    },
    {
      onSuccess: (r) => {
        if (!r) return;
        forget(qc, qk.therapist(id));
        void refresh(qc, "staff", "schedule");
        router.replace("/therapists");
      },
    },
  );

  const t = q.data;
  const startEditing = () => {
    const rows = t?.schedules ?? [];
    setEditing(
      DAYS.map((d) => {
        const s = rows.find((x) => x.dayOfWeek === d);
        return { dayOfWeek: d, on: !!s, startTime: s?.startTime ?? "09:00", endTime: s?.endTime ?? "18:00", breakStart: s?.breakStart ?? "13:00", breakEnd: s?.breakEnd ?? "14:00", slotMinutes: s?.slotMinutes ?? 30 };
      }),
    );
  };

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => { q.refetch(); leaves.refetch(); list.refetch(); }}>
      <TopBar title="Physiotherapist" onBack={() => goBack("/therapists")} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : t ? (
        <>
          <Card style={{ borderTopWidth: 4, borderTopColor: t.colorTag ?? colors.gold500 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text weight="bold" style={{ fontSize: 18, flex: 1 }}>{t.user.name}</Text>
              {!t.isActive ? <Badge status="CANCELLED" text="Inactive" /> : null}
            </Row>
            <Muted>{t.qualification} · {t.experienceYears} yrs experience</Muted>
            <View style={styles.chips}>
              {t.specializations.map((s) => (
                <View key={s.specialization.id} style={[styles.chip, { backgroundColor: colors.gold100 }]}>
                  <Text weight="semibold" style={{ fontSize: 11, color: colors.gold700 }}>{s.specialization.name}</Text>
                </View>
              ))}
              {t.isAvailableForHomeVisit ? (
                <View style={[styles.chip, { backgroundColor: colors.navy50 }]}>
                  <Text weight="semibold" style={{ fontSize: 11, color: colors.navy700 }}>Home visits</Text>
                </View>
              ) : null}
            </View>
            <KeyValue k="Mobile" v={t.user.phone} />
            {t.user.email ? <KeyValue k="Email" v={t.user.email} /> : null}
            {isAdmin ? <KeyValue k="Mobile app" v={<PinBadge hasPin={hasPin} />} /> : null}
            <Button title={`Call ${t.user.phone}`} variant="ghost" small icon="call-outline" onPress={() => Linking.openURL(`tel:${t.user.phone}`)} style={{ alignSelf: "flex-start" }} />
          </Card>

          {isAdmin ? (
            <Row>
              <Button title={hasPin ? "Reset PIN" : "Set PIN"} variant="gold" icon="key-outline" onPress={() => setPinFor({ id: t.user.id, name: t.user.name, hasPin })} style={{ flex: 1 }} />
              <Button title="Delete" variant="danger" icon="trash-outline" onPress={() => remove.mutate()} loading={remove.isPending} style={{ flex: 1 }} />
            </Row>
          ) : null}
          <ErrorBox error={remove.error} />

          {/* ── Weekly schedule ── */}
          <SectionTitle action={isAdmin && !editing ? <Button title="Edit" variant="ghost" small icon="create-outline" onPress={startEditing} /> : undefined}>Weekly schedule</SectionTitle>
          {editing ? (
            <ScheduleEditor
              therapistId={id}
              initial={editing}
              onDone={() => setEditing(null)}
            />
          ) : (
            <Card>
              {t.schedules.length === 0 ? (
                <Muted>No working hours set yet{isAdmin ? ". Tap Edit to add them." : "."}</Muted>
              ) : (
                DAYS.map((d) => {
                  const s = t.schedules.find((x) => x.dayOfWeek === d);
                  return (
                    <Row key={d} style={{ justifyContent: "space-between", paddingVertical: 3 }}>
                      <Text weight="semibold" style={{ width: 92 }}>{DAY_NAMES[d]}</Text>
                      <Muted style={{ flex: 1, textAlign: "right", fontSize: 12 }}>
                        {s ? `${timeLabel(s.startTime)} – ${timeLabel(s.endTime)}${s.breakStart ? ` · break ${timeLabel(s.breakStart)}–${timeLabel(s.breakEnd)}` : ""} · ${s.slotMinutes} min` : "Off"}
                      </Muted>
                    </Row>
                  );
                })
              )}
            </Card>
          )}
          {isAdmin && !editing ? (
            <>
              <Button title="Generate slots for next 30 days" variant="ghost" icon="refresh" onPress={() => generate.mutate()} loading={generate.isPending} />
              {generated !== null ? <Muted style={{ fontSize: 12, color: colors.success }}>{generated} new slot{generated === 1 ? "" : "s"} created.</Muted> : null}
              <ErrorBox error={generate.error} />
            </>
          ) : null}

          {/* ── Leave ── */}
          {canLeave ? (
            <>
              <SectionTitle action={<Button title={isAdmin ? "Add leave" : "Apply"} variant="ghost" small icon="add" onPress={() => setLeaveOpen(true)} />}>Leave</SectionTitle>
              <Card>
                {leaves.isLoading ? (
                  <Loading />
                ) : leaves.error ? (
                  <ErrorBox error={leaves.error} onRetry={() => leaves.refetch()} />
                ) : !leaves.data?.length ? (
                  <Muted>No leave recorded.</Muted>
                ) : (
                  leaves.data.map((l) => (
                    <View key={l.id} style={styles.leaveRow}>
                      <Row style={{ justifyContent: "space-between" }}>
                        <Text weight="semibold" style={{ flex: 1 }}>{date(l.startDate)}{date(l.startDate) !== date(l.endDate) ? ` – ${date(l.endDate)}` : ""}</Text>
                        <Badge status={l.status === "APPROVED" ? "ACTIVE" : l.status === "PENDING" ? "PENDING" : "CANCELLED"} text={l.status === "APPROVED" ? "Approved" : l.status === "PENDING" ? "Pending" : "Rejected"} />
                      </Row>
                      {l.reason ? <Muted style={{ fontSize: 12 }}>{l.reason}</Muted> : null}
                      {isAdmin && l.status === "PENDING" ? (
                        <Row style={{ marginTop: 4 }}>
                          <Button title="Approve" small icon="checkmark" onPress={() => decide.mutate({ leaveId: l.id, status: "APPROVED" })} disabled={decide.isPending} style={{ flex: 1 }} />
                          <Button title="Reject" small variant="danger" icon="close" onPress={() => decide.mutate({ leaveId: l.id, status: "REJECTED" })} disabled={decide.isPending} style={{ flex: 1 }} />
                        </Row>
                      ) : null}
                    </View>
                  ))
                )}
                <ErrorBox error={decide.error} />
              </Card>
              {conflicts && conflicts.length ? (
                <Card style={{ borderColor: "#C98A12", backgroundColor: colors.warningBg }}>
                  <Text weight="semibold" style={{ color: colors.warning }}>{conflicts.length} appointment{conflicts.length > 1 ? "s" : ""} during this leave need rescheduling</Text>
                  {conflicts.map((c) => (
                    <Muted key={c.id} style={{ fontSize: 12 }}>
                      {c.appointmentNo} · {dateTime(c.startAt)} · {fullName(c.patient)} ({c.patient.phone})
                    </Muted>
                  ))}
                  <Button title="Dismiss" variant="ghost" small onPress={() => setConflicts(null)} style={{ alignSelf: "flex-start" }} />
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      <SetPinSheet user={pinFor} onClose={() => setPinFor(null)} />
      <LeaveSheet
        open={leaveOpen}
        therapistId={id}
        isAdmin={isAdmin}
        onClose={() => setLeaveOpen(false)}
        onSaved={(c) => {
          setLeaveOpen(false);
          setConflicts(c.length ? c : null);
        }}
      />
    </Screen>
  );
}

function addDaysYmd(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/* ───────────────────────── Schedule editor ───────────────────────── */

function dayProblem(d: Day): string | null {
  if (!d.on) return null;
  if (d.startTime >= d.endTime) return "Start must be before end";
  if (!!d.breakStart !== !!d.breakEnd) return "Set both break times, or no break";
  if (d.breakStart && (d.breakStart < d.startTime || d.breakEnd > d.endTime || d.breakStart >= d.breakEnd)) return "Break must be inside working hours";
  return null;
}

function ScheduleEditor({ therapistId, initial, onDone }: { therapistId: string; initial: Day[]; onDone: () => void }) {
  const [rows, setRows] = useState<Day[]>(initial);
  const upd = (i: number, patch: Partial<Day>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const problems = rows.map(dayProblem);
  const firstProblem = problems.find(Boolean);

  const save = useAction(
    () =>
      api.put(`/therapists/${therapistId}/schedule`, {
        regenerateDays: 30,
        days: rows
          .filter((r) => r.on)
          .map((r) => ({
            dayOfWeek: r.dayOfWeek,
            startTime: r.startTime,
            endTime: r.endTime,
            slotMinutes: r.slotMinutes,
            ...(r.breakStart && r.breakEnd ? { breakStart: r.breakStart, breakEnd: r.breakEnd } : {}),
          })),
      }),
    { refresh: ["schedule"], onSuccess: onDone },
  );

  return (
    <View style={{ gap: space.sm }}>
      {rows.map((r, i) => (
        <Card key={r.dayOfWeek} style={!r.on ? { opacity: 0.7 } : undefined}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text weight="semibold">{DAY_NAMES[r.dayOfWeek]}</Text>
            <Row gap={6}>
              <Muted style={{ fontSize: 12 }}>{r.on ? "Working" : "Off"}</Muted>
              <Switch value={r.on} onValueChange={(v) => upd(i, { on: v })} trackColor={{ true: colors.gold500, false: colors.navy100 }} thumbColor={colors.white} accessibilityLabel={`${DAY_NAMES[r.dayOfWeek]} working`} />
            </Row>
          </Row>
          {r.on ? (
            <>
              <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}><SelectField label="Start" value={r.startTime} options={TIME_OPTIONS} onChange={(v) => upd(i, { startTime: v })} /></View>
                <View style={{ flex: 1 }}><SelectField label="End" value={r.endTime} options={TIME_OPTIONS} onChange={(v) => upd(i, { endTime: v })} /></View>
              </Row>
              <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}><SelectField label="Break from" value={r.breakStart} options={BREAK_OPTIONS} onChange={(v) => upd(i, { breakStart: v, ...(v ? {} : { breakEnd: "" }) })} /></View>
                <View style={{ flex: 1 }}><SelectField label="Break to" value={r.breakEnd} options={BREAK_OPTIONS} onChange={(v) => upd(i, { breakEnd: v, ...(v ? {} : { breakStart: "" }) })} /></View>
              </Row>
              <SelectField label="Slot length" value={String(r.slotMinutes)} options={SLOT_OPTIONS} onChange={(v) => upd(i, { slotMinutes: Number(v) })} />
              {problems[i] ? <Text style={{ color: colors.warning, fontSize: 12 }}>{problems[i]}</Text> : null}
            </>
          ) : null}
        </Card>
      ))}
      <Muted style={{ fontSize: 12 }}>Saving rebuilds free slots for the next 30 days. Booked appointments are never touched.</Muted>
      <ErrorBox error={save.error} />
      <Row>
        <Button title="Cancel" variant="ghost" onPress={onDone} style={{ flex: 1 }} />
        <Button title="Save schedule" onPress={() => save.mutate()} disabled={!!firstProblem} loading={save.isPending} style={{ flex: 1 }} />
      </Row>
    </View>
  );
}

/* ───────────────────────── Leave sheet ───────────────────────── */

function LeaveSheet({ open, therapistId, isAdmin, onClose, onSaved }: { open: boolean; therapistId: string; isAdmin: boolean; onClose: () => void; onSaved: (conflicts: Conflict[]) => void }) {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [reason, setReason] = useState("");
  const save = useAction(() => api.post<{ conflicts: Conflict[] }>(`/therapists/${therapistId}/leaves`, { startDate: from, endDate: to, reason: reason.trim() || undefined }), {
    refresh: ["schedule"],
    onSuccess: (r) => {
      setReason("");
      onSaved(r.conflicts ?? []);
    },
  });
  const problem = !from || !to ? "Pick both dates" : to < from ? "End date must be on or after the start date" : null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isAdmin ? "Add leave" : "Apply for leave"}
      footer={<Button title={save.isPending ? "Saving…" : "Save leave"} icon="checkmark" onPress={() => save.mutate()} disabled={!!problem} loading={save.isPending} />}
    >
      <DateField label="From" value={from} onChange={setFrom} />
      <DateField label="To" value={to} onChange={setTo} />
      <Field label="Reason (optional)"><Input value={reason} onChangeText={setReason} placeholder="e.g. family function" /></Field>
      {problem ? <Text style={{ color: colors.warning, fontSize: 12 }}>{problem}</Text> : null}
      <Muted style={{ fontSize: 12 }}>
        {isAdmin ? "Approved straight away; free slots in this period are blocked." : "Your admin will approve or reject it."} Any booked appointments in this period are listed afterwards so they can be rescheduled.
      </Muted>
      <ErrorBox error={save.error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  leaveRow: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, gap: 2 },
});
