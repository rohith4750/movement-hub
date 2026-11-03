import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { goBack, RequireRole, SectionTitle, Sheet } from "@/components/form";
import { slotStyles, SlotLegend } from "@/components/slot-legend";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { addDays, clock, date, dayParts, fullName, hhmm, label, time, today } from "@/lib/format";
import { usePlannerStore, type PlanPick } from "@/lib/planner-store";
import { usePlanner } from "@/lib/queries";
import { useAction } from "@/lib/refresh";
import { useAuth } from "@/lib/auth";
import { CATEGORY_LABEL, type PlannerAppointment, type PlannerBookResult, type PlannerCandidate, type PlannerDay, type PlannerSlot, type PlannerTherapist } from "@/lib/types";
import { colors, radius, space } from "@/theme";

/**
 * Day planner — the clinic's whiteboard. Pick a day (tomorrow by default), see every physio's free
 * and booked time, tick the regular patients to book, adjust anyone's physio or time, and book
 * them all at once. Visits already booked can be moved to another physio if someone is away.
 */
export default function Planner() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST"]} title="Day planner">
      <PlannerScreen />
    </RequireRole>
  );
}

const EMPTY: Record<string, PlanPick> = {};

function PlannerScreen() {
  const [day, setDay] = useState(() => addDays(today(), 1));
  const [focus, setFocus] = useState<string | null>(null); // one physio, or everyone
  const [picking, setPicking] = useState<PlannerCandidate | null>(null);
  const [moving, setMoving] = useState<PlannerAppointment | null>(null);
  const [result, setResult] = useState<PlannerBookResult | null>(null);

  const q = usePlanner(day);
  const draft = usePlannerStore((s) => s.days[day] ?? EMPTY);
  // The server gives a physio only their own day; the Super Admin sees every physio.
  const isPhysio = useAuth((s) => s.user?.role === "PHYSIOTHERAPIST");
  const { seed, toggle, setAll, pick, drop } = usePlannerStore.getState();

  // Seed ticks / suggested slots whenever fresh suggestions arrive (keeps the user's own changes).
  useEffect(() => {
    if (q.data) seed(day, q.data.toPlan);
  }, [q.data, day, seed]);

  // Forget picks for patients who are no longer on the list (booked elsewhere, plan closed…).
  useEffect(() => {
    if (!q.data) return;
    const listed = new Set(q.data.toPlan.map((c) => c.patient.id));
    const gone = Object.keys(draft).filter((id) => !listed.has(id));
    if (gone.length) drop(day, gone);
  }, [q.data, day, draft, drop]);

  const data = q.data;
  const therapistName = useMemo(() => new Map((data?.therapists ?? []).map((t) => [t.id, t.name])), [data]);
  const slotById = useMemo(() => new Map((data?.slots ?? []).map((s) => [s.id, s])), [data]);

  const toPlan = (data?.toPlan ?? []).filter((c) => !focus || (draft[c.patient.id]?.therapistId ?? c.therapistId) === focus);
  const booked = (data?.appointments ?? []).filter((a) => !focus || a.therapistId === focus);
  const ready = toPlan.filter((c) => draft[c.patient.id]?.selected && draft[c.patient.id]?.slotId);

  const book = useAction(
    () =>
      api.post<PlannerBookResult>("/planner/book", {
        items: ready.map((c) => {
          const p = draft[c.patient.id]!;
          return {
            patientId: c.patient.id,
            slotId: p.slotId!,
            type: c.type,
            treatmentPlanId: c.type === "THERAPY_SESSION" ? c.plan?.id : undefined,
            patientPackageId: c.type === "THERAPY_SESSION" ? c.package?.id : undefined,
          };
        }),
      }),
    {
      refresh: ["appointments"],
      onSuccess: (r) => {
        drop(day, r.results.filter((x) => x.ok).map((x) => x.patientId));
        setResult(r);
      },
    },
  );

  const move = useAction(
    (v: { appointment: PlannerAppointment; slotId: string }) =>
      api.post(`/appointments/${v.appointment.id}/reschedule`, { newSlotId: v.slotId, reason: "Moved in the day planner" }),
    { refresh: ["appointments"], onSuccess: () => setMoving(null) },
  );

  const days = Array.from({ length: 8 }, (_, i) => addDays(today(), i));

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar title={isPhysio ? "My day planner" : "Day planner"} onBack={() => goBack("/more")} />
      {isPhysio ? <Muted style={{ fontSize: 12 }}>Your slots, your booked visits and your patients to book.</Muted> : null}

      {/* Day */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {days.map((d) => {
          const on = d === day;
          const p = dayParts(d);
          return (
            <Pressable
              key={d}
              onPress={() => {
                setDay(d);
                setResult(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.dayChip, on && styles.dayChipOn]}
            >
              <Text weight="medium" style={{ fontSize: 11, color: on ? colors.gold300 : colors.muted }}>{d === today() ? "Today" : d === addDays(today(), 1) ? "Tomorrow" : p.weekday}</Text>
              <Text weight="bold" style={{ fontSize: 18, color: on ? colors.white : colors.navy900 }}>{p.day}</Text>
              <Text style={{ fontSize: 11, color: on ? colors.navy100 : colors.muted }}>{p.month}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {q.isLoading ? (
        <Loading label="Building the plan…" />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : data ? (
        <>
          <TherapistStrip therapists={data.therapists} focus={focus} onFocus={setFocus} showAll={true} />

          {result ? <BookResult result={result} candidates={data.toPlan} onClose={() => setResult(null)} /> : null}

          {/* Patients still to book */}
          <View style={{ gap: space.sm }}>
            <SectionTitle
              action={
                toPlan.length ? (
                  <Pressable
                    onPress={() => setAll(day, toPlan.filter((c) => draft[c.patient.id]?.slotId).map((c) => c.patient.id), ready.length < toPlan.filter((c) => draft[c.patient.id]?.slotId).length)}
                    hitSlop={8}
                  >
                    <Text weight="semibold" style={{ color: colors.gold700, fontSize: 13 }}>
                      {ready.length < toPlan.filter((c) => draft[c.patient.id]?.slotId).length ? "Select all" : "Clear"}
                    </Text>
                  </Pressable>
                ) : undefined
              }
            >
              To book · {toPlan.length}
            </SectionTitle>
            {toPlan.length === 0 ? (
              <Card>
                <Empty icon="checkmark-done-outline" title="Everyone is booked" message={`No patients in ongoing care are waiting for a visit on ${date(`${day}T06:00:00Z`)}.`} />
              </Card>
            ) : (
              toPlan.map((c) => (
                <CandidateCard
                  key={c.patient.id}
                  c={c}
                  pick={draft[c.patient.id]}
                  slot={draft[c.patient.id]?.slotId ? slotById.get(draft[c.patient.id]!.slotId!) : undefined}
                  therapistName={therapistName}
                  onToggle={() => (draft[c.patient.id]?.slotId ? toggle(day, c.patient.id) : setPicking(c))}
                  onPick={() => setPicking(c)}
                />
              ))
            )}
          </View>

          {/* Already booked */}
          <BookedList appointments={booked} therapists={data.therapists} onMove={setMoving} />

          <ErrorBox error={book.error} />
          {ready.length ? (
            <Button title={`Book ${ready.length} visit${ready.length > 1 ? "s" : ""}`} variant="gold" icon="calendar-outline" onPress={() => book.mutate()} loading={book.isPending} />
          ) : null}

          <SlotSheet
            key={`pick-${picking?.patient.id ?? "none"}`}
            title={picking ? `Physio & time · ${fullName(picking.patient)}` : ""}
            open={!!picking}
            data={data}
            initialTherapist={picking ? draft[picking.patient.id]?.therapistId ?? picking.therapistId : null}
            selectedSlot={picking ? draft[picking.patient.id]?.slotId ?? null : null}
            reserved={new Set(Object.entries(draft).filter(([id, p]) => id !== picking?.patient.id && p.slotId).map(([, p]) => p.slotId!))}
            usualTime={picking?.usualTime ?? null}
            onClose={() => setPicking(null)}
            onPick={(therapistId, slotId) => {
              if (picking) pick(day, picking.patient.id, therapistId, slotId);
              setPicking(null);
            }}
          />
          <SlotSheet
            key={`move-${moving?.id ?? "none"}`}
            title={moving ? `Move ${fullName(moving.patient)}` : ""}
            open={!!moving}
            data={data}
            initialTherapist={moving?.therapistId ?? null}
            selectedSlot={null}
            reserved={new Set(Object.values(draft).filter((p) => p.slotId).map((p) => p.slotId!))}
            usualTime={moving ? hhmm(moving.startAt) : null}
            busy={move.isPending}
            error={move.error}
            confirmLabel="Move here"
            onClose={() => {
              setMoving(null);
              move.reset();
            }}
            onPick={(_t, slotId) => moving && slotId && move.mutate({ appointment: moving, slotId })}
          />
        </>
      ) : null}
    </Screen>
  );
}

/* ─────────────── Physio summary ─────────────── */

function TherapistStrip({ therapists, focus, onFocus, showAll }: { therapists: PlannerTherapist[]; focus: string | null; onFocus: (id: string | null) => void; showAll: boolean }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
      {showAll ? (
      <Pressable onPress={() => onFocus(null)} style={[styles.physio, !focus && styles.physioOn]} accessibilityRole="button" accessibilityState={{ selected: !focus }}>
        <Text weight="bold" style={{ color: !focus ? colors.white : colors.navy900 }}>All physios</Text>
        <Muted style={{ fontSize: 12, color: !focus ? colors.navy100 : colors.muted }}>
          {therapists.reduce((n, t) => n + t.slots.free, 0)} free · {therapists.reduce((n, t) => n + t.slots.booked, 0)} booked
        </Muted>
      </Pressable>
      ) : null}
      {therapists.map((t) => {
        const on = focus === t.id;
        return (
          <Pressable key={t.id} onPress={() => onFocus(on ? null : t.id)} style={[styles.physio, on && styles.physioOn, { borderLeftColor: t.colorTag ?? colors.gold500, borderLeftWidth: 4 }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text weight="bold" numberOfLines={1} style={{ color: on ? colors.white : colors.navy900, maxWidth: 150 }}>{t.name}</Text>
            {t.onLeave ? (
              <Badge status="CANCELLED" text="On leave" />
            ) : t.slots.total === 0 ? (
              <Muted style={{ fontSize: 12, color: on ? colors.navy100 : colors.muted }}>Not working</Muted>
            ) : (
              <Row gap={6}>
                <Muted style={{ fontSize: 12, color: on ? colors.navy100 : colors.muted }}>{t.slots.free} free · {t.slots.booked} booked</Muted>
                {t.full ? <Badge status="NO_SHOW" text="Full" /> : null}
              </Row>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ─────────────── Patient to book ─────────────── */

function CandidateCard({ c, pick, slot, therapistName, onToggle, onPick }: { c: PlannerCandidate; pick?: PlanPick; slot?: PlannerSlot; therapistName: Map<string, string>; onToggle: () => void; onPick: () => void }) {
  const selected = !!pick?.selected && !!pick.slotId;
  const tId = pick?.therapistId ?? c.therapistId;
  const isUsual = !!slot && !!c.usualTime && hhmm(slot.startAt) === c.usualTime;
  return (
    <Card style={[{ gap: space.sm }, selected && { borderColor: colors.gold500 }]}>
      <Row style={{ alignItems: "flex-start" }}>
        <Pressable onPress={onToggle} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`Book ${fullName(c.patient)}`}>
          <Ionicons name={selected ? "checkbox" : "square-outline"} size={24} color={selected ? colors.gold500 : colors.navy500} />
        </Pressable>
        <Pressable style={{ flex: 1, gap: 2 }} onPress={() => router.push({ pathname: "/patient/[id]", params: { id: c.patient.id } })}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text weight="semibold" style={{ fontSize: 15, flex: 1 }} numberOfLines={1}>{fullName(c.patient)}</Text>
            <Badge status={c.category} text={CATEGORY_LABEL[c.category]} />
          </Row>
          <Muted style={{ fontSize: 12 }}>
            {c.patient.patientCode} · {c.completedVisits} visit{c.completedVisits === 1 ? "" : "s"}{c.lastVisitAt ? ` · last ${date(c.lastVisitAt)}` : ""}
          </Muted>
        </Pressable>
      </Row>

      <View style={{ gap: 2, paddingLeft: 32 }}>
        {c.regularAway || c.covering ? (
          <Row gap={6}>
            <Badge status="WALK_IN" text={c.regularAway ? "Cover" : "Other physio"} />
            <Muted style={{ fontSize: 12, flex: 1, color: colors.gold700 }} numberOfLines={2}>
              {c.regularAway
                ? `${c.regularTherapistName ?? "Regular physio"} is ${c.regularAwayReason === "ON_LEAVE" ? "on leave" : "not working"} — ${tId && tId !== c.regularTherapistId ? `covered by ${therapistName.get(tId) ?? "you"}` : "choose who covers"}`
                : `Usually sees ${c.regularTherapistName ?? "another physio"}`}
            </Muted>
          </Row>
        ) : null}
        {c.plan ? (
          <Muted style={{ fontSize: 12 }} numberOfLines={2}>
            {c.plan.full ? "Plan fully booked → follow-up visit" : label(c.type)} · {c.plan.title} · {c.plan.sessionsBooked}/{c.plan.prescribedSessions} booked · {c.plan.frequencyPerWeek}×/week
          </Muted>
        ) : (
          <Muted style={{ fontSize: 12 }}>No active plan → follow-up consultation</Muted>
        )}
        {c.type === "THERAPY_SESSION" ? (
          <Muted style={{ fontSize: 12, color: c.package ? colors.muted : colors.warning }}>
            {c.package ? `Package: ${c.package.name} · ${c.package.remaining} left` : "No package with sessions left — pay per visit"}
          </Muted>
        ) : null}
      </View>

      <Pressable onPress={onPick} accessibilityRole="button" style={styles.pickRow}>
        <Ionicons name="time-outline" size={16} color={colors.navy600} />
        <Text weight="semibold" style={{ flex: 1, fontSize: 13, color: slot ? colors.navy800 : colors.warning }} numberOfLines={1}>
          {slot ? `${therapistName.get(slot.therapistId) ?? "Physio"} · ${time(slot.startAt)}` : c.therapistOnLeave ? `${therapistName.get(tId ?? "") ?? "Usual physio"} is on leave — choose another` : "Choose physio & time"}
        </Text>
        {isUsual ? <Badge status="ACTIVE" text="Usual time" /> : null}
        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
      </Pressable>
    </Card>
  );
}

/* ─────────────── Already booked ─────────────── */

function BookedList({ appointments, therapists, onMove }: { appointments: PlannerAppointment[]; therapists: PlannerTherapist[]; onMove: (a: PlannerAppointment) => void }) {
  const byTherapist = therapists.map((t) => ({ t, list: appointments.filter((a) => a.therapistId === t.id) })).filter((g) => g.list.length);
  return (
    <View style={{ gap: space.sm }}>
      <SectionTitle>Booked · {appointments.length}</SectionTitle>
      {byTherapist.length === 0 ? (
        <Card>
          <Muted>No visits booked on this day yet.</Muted>
        </Card>
      ) : (
        byTherapist.map(({ t, list }) => (
          <Card key={t.id} style={{ gap: space.xs, borderLeftWidth: 4, borderLeftColor: t.colorTag ?? colors.gold500 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text weight="bold" style={{ color: colors.navy700 }}>{t.name}</Text>
              {t.onLeave ? <Badge status="CANCELLED" text="On leave" /> : <Muted style={{ fontSize: 12 }}>{list.length} visit{list.length > 1 ? "s" : ""}</Muted>}
            </Row>
            {list.map((a) => {
              const movable = ["SCHEDULED", "CONFIRMED"].includes(a.status) && new Date(a.startAt) > new Date();
              return (
                <Row key={a.id} style={styles.bookedRow}>
                  <Text weight="semibold" style={{ width: 70, fontSize: 13 }}>{time(a.startAt)}</Text>
                  <Pressable style={{ flex: 1 }} onPress={() => router.push({ pathname: "/appointment/[id]", params: { id: a.id } })}>
                    <Text style={{ fontSize: 13 }} numberOfLines={1}>{fullName(a.patient)}</Text>
                    <Muted style={{ fontSize: 11 }} numberOfLines={1}>{label(a.type)}{a.source === "WALK_IN" ? " · Walk-in" : ""}</Muted>
                  </Pressable>
                  {a.needsMove ? <Badge status="NO_SHOW" text="Move: physio away" /> : a.status !== "SCHEDULED" ? <Badge status={a.status} /> : null}
                  {movable ? (
                    <Pressable onPress={() => onMove(a)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Move ${fullName(a.patient)}`} style={styles.moveBtn}>
                      <Ionicons name="swap-horizontal" size={16} color={colors.navy700} />
                    </Pressable>
                  ) : null}
                </Row>
              );
            })}
          </Card>
        ))
      )}
    </View>
  );
}

/* ─────────────── Result of "Book all" ─────────────── */

function BookResult({ result, candidates, onClose }: { result: PlannerBookResult; candidates: PlannerCandidate[]; onClose: () => void }) {
  const name = (id: string) => fullName(candidates.find((c) => c.patient.id === id)?.patient);
  const failed = result.results.filter((r) => !r.ok);
  return (
    <Card style={{ gap: space.xs, borderColor: failed.length ? colors.warning : colors.success }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Text weight="bold" style={{ color: failed.length ? colors.warning : colors.success }}>
          {result.booked} booked{failed.length ? ` · ${failed.length} not booked` : ""}
        </Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </Row>
      {failed.map((f) => (
        <Muted key={f.patientId} style={{ fontSize: 12 }}>
          {name(f.patientId) || "Patient"}: {f.error}
        </Muted>
      ))}
      {failed.length ? <Muted style={{ fontSize: 12 }}>Choose another time for them below and book again.</Muted> : null}
    </Card>
  );
}

/* ─────────────── Physio + time picker ─────────────── */

function SlotSheet({
  open,
  title,
  data,
  initialTherapist,
  selectedSlot,
  reserved,
  usualTime,
  onPick,
  onClose,
  busy,
  error,
  confirmLabel,
}: {
  open: boolean;
  title: string;
  data: PlannerDay;
  initialTherapist: string | null;
  selectedSlot: string | null;
  /** Slots already planned for other patients in this draft. */
  reserved: Set<string>;
  usualTime: string | null;
  onPick: (therapistId: string, slotId: string | null) => void;
  onClose: () => void;
  busy?: boolean;
  error?: unknown;
  confirmLabel?: string;
}) {
  const working = data.therapists.filter((t) => !t.onLeave && t.slots.total > 0);
  // The parent keys this sheet by who it is open for, so these start fresh each time it opens.
  const [therapistId, setTherapistId] = useState<string | null>(() =>
    initialTherapist && working.some((t) => t.id === initialTherapist) ? initialTherapist : working[0]?.id ?? null,
  );
  const [slotId, setSlotId] = useState<string | null>(selectedSlot);

  const now = new Date();
  const slots = data.slots.filter((s) => s.therapistId === therapistId);
  const usable = (s: PlannerSlot) => s.status === "AVAILABLE" && new Date(s.startAt) > now && !reserved.has(s.id);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button
          title={confirmLabel ?? (slotId ? "Use this time" : "Choose a time")}
          icon="checkmark"
          disabled={!therapistId || !slotId}
          loading={busy}
          onPress={() => therapistId && slotId && onPick(therapistId, slotId)}
        />
      }
    >
      <Row gap={space.sm} style={{ flexWrap: "wrap" }}>
        {working.map((t) => {
          const on = t.id === therapistId;
          return (
            <Pressable key={t.id} onPress={() => { setTherapistId(t.id); setSlotId(null); }} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text weight="semibold" style={{ fontSize: 13, color: on ? colors.white : colors.navy800 }}>{t.name}</Text>
              <Text style={{ fontSize: 11, color: on ? colors.gold300 : colors.muted }}>{t.full ? "Full" : `${t.slots.free} free`}</Text>
            </Pressable>
          );
        })}
      </Row>
      {working.length === 0 ? <Muted>No physiotherapist is working on this day.</Muted> : null}

      <SlotLegend />
      {usualTime ? <Muted style={{ fontSize: 12 }}>Usual time: {clock(usualTime)}</Muted> : null}

      <View style={styles.grid}>
        {slots.map((s) => {
          const free = usable(s);
          const on = s.id === slotId;
          const planned = reserved.has(s.id);
          const usual = usualTime && hhmm(s.startAt) === usualTime;
          return (
            <Pressable
              key={s.id}
              disabled={!free}
              onPress={() => setSlotId(s.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: !free }}
              accessibilityLabel={`${time(s.startAt)} ${free ? "available" : planned ? "planned for another patient" : s.status === "BOOKED" ? "booked" : "unavailable"}`}
              style={[styles.slot, free ? slotStyles.free : s.status === "BOOKED" || planned ? slotStyles.booked : slotStyles.off, on && slotStyles.selected, usual && !on && free && { borderColor: colors.gold500 }]}
            >
              <Text weight={on ? "bold" : "medium"} style={{ fontSize: 13, color: on ? colors.white : free ? colors.navy800 : colors.muted, textDecorationLine: free ? "none" : "line-through" }}>{time(s.startAt)}</Text>
            </Pressable>
          );
        })}
      </View>
      {therapistId && slots.length > 0 && !slots.some(usable) ? <Muted style={{ color: colors.warning }}>No free time left with this physio. Choose another physio.</Muted> : null}
      <ErrorBox error={error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  dayChip: { width: 64, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: "center", gap: 2 },
  dayChipOn: { backgroundColor: colors.navy800, borderColor: colors.navy800 },
  physio: { minWidth: 130, padding: space.md, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, gap: 4 },
  physioOn: { backgroundColor: colors.navy800, borderColor: colors.navy800 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.navy50 },
  bookedRow: { paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  moveBtn: { width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.navy50 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.navy800, borderColor: colors.navy800 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  slot: { width: "30%", flexGrow: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: "center", borderWidth: 1 },
});
