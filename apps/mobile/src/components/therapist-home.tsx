import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Badge, BrandHeader, Button, Caption, Card, Chips, Empty, ErrorBox, Muted, Row, Screen, SkeletonCards, Text } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { addDays, date, fullName, greeting, label, time, today } from "@/lib/format";
import { appointmentsOnOptions, patientListOptions, patientOptions, sessionOptions, useAppointmentsOn } from "@/lib/queries";
import type { Appointment } from "@/lib/types";
import { colors, compact, radius, shadow, space } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];
type Step = { label: string; icon: IconName; go: () => void };

const ACTIVE = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"];
const REFRESH_MS = 60_000; // the front desk checks patients in: the list follows without a pull-to-refresh

/**
 * What the physiotherapist does next for one visit, as a single plain button. The visit list used to be
 * Visits tab → visit → "Open therapy session"; now the card itself goes straight to the right screen.
 */
function nextStep(a: Appointment, myTherapistId: string | null): Step {
  const openVisit: Step = {
    label: a.type === "HOME_VISIT" ? "Open home visit" : "Open visit",
    icon: "open-outline",
    go: () => router.push({ pathname: "/appointment/[id]", params: { id: a.id } }),
  };
  const session = a.therapySession;
  if (session) {
    const go = () => router.push({ pathname: "/session/[id]", params: { id: session.id } });
    if (session.status === "IN_PROGRESS") return { label: "Continue session", icon: "play-circle", go };
    if (session.status === "COMPLETED") return { label: "View summary", icon: "eye-outline", go };
    return { label: "Start session", icon: "play-circle", go };
  }
  const isConsult = a.type === "INITIAL_CONSULTATION" || a.type === "FOLLOW_UP_CONSULTATION";
  if (isConsult && !a.consultation && a.therapist.id === myTherapistId) {
    return { label: "Write consultation", icon: "document-text", go: () => router.push({ pathname: "/consultation/new", params: { appointmentId: a.id } }) };
  }
  return openVisit;
}

/** "Therapy session · Session 3" / "First consultation". */
function kindLine(a: Appointment) {
  const n = a.therapySession ? a.therapySession.sessionNumber : null;
  return `${label(a.type)}${n ? ` · Session ${n}` : ""}`;
}

/** The therapist's home screen: today's patients in time order, the next one on top with one big button. */
export function TherapistHome() {
  const user = useAuth((s) => s.user);
  const myTherapistId = user ? user.therapistId : null;
  const firstName = user ? user.name.split(" ")[0] : "";
  const [day, setDay] = useState<"today" | "tomorrow">("today");
  const [everyone, setEveryone] = useState(false); // physios also cover for each other, so the whole clinic is one tap away
  const q = useAppointmentsOn(day === "today" ? today() : addDays(today(), 1), !everyone, REFRESH_MS);

  const all = [...(q.data ?? [])].sort((x, y) => new Date(x.startAt).getTime() - new Date(y.startAt).getTime());
  const todo = all.filter((a) => ACTIVE.includes(a.status));
  const finished = all.filter((a) => !ACTIVE.includes(a.status));
  const hero = todo.find((a) => a.status === "IN_PROGRESS" || (a.therapySession ? a.therapySession.status === "IN_PROGRESS" : false)) ?? todo[0];
  const later = todo.filter((a) => a !== hero);
  const dayWord = day === "today" ? "today" : "tomorrow";

  // Load ahead of time what the therapist will most likely open next, so on a slow connection the next tap is already
  // there: the first few sessions, the next patient's file, then tomorrow's list and the Patients tab (only for "mine").
  const qc = useQueryClient();
  const sessionIds = todo.flatMap((a) => (a.therapySession && a.therapySession.status !== "COMPLETED" ? [a.therapySession.id] : [])).slice(0, 4).join(",");
  const heroPatientId = hero ? hero.patient.id : "";
  const loaded = !!q.data;
  useEffect(() => {
    for (const id of sessionIds ? sessionIds.split(",") : []) void qc.prefetchQuery(sessionOptions(id));
  }, [sessionIds, qc]);
  useEffect(() => {
    if (heroPatientId) void qc.prefetchQuery(patientOptions(heroPatientId));
  }, [heroPatientId, qc]);
  useEffect(() => {
    if (!loaded || everyone || !myTherapistId) return;
    void qc.prefetchQuery(appointmentsOnOptions(addDays(today(), 1), myTherapistId));
    void qc.prefetchQuery(patientListOptions("", true));
  }, [loaded, everyone, myTherapistId, qc]);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <BrandHeader title={`${greeting()}, ${firstName}`} subtitle={date(new Date())} />

      <Pressable onPress={() => router.push("/patients")} accessibilityRole="button" accessibilityLabel="Find a patient" style={({ pressed }) => [styles.search, pressed && { opacity: 0.85 }]}>
        <Ionicons name="search" size={20} color={colors.gold700} />
        <Text weight="semibold" style={{ flex: 1, fontSize: 15, color: colors.navy800 }}>Find a patient</Text>
        <Muted style={{ fontSize: 12 }}>name or phone</Muted>
      </Pressable>

      <Chips<"today" | "tomorrow"> value={day} onChange={setDay} options={[{ value: "today", label: "Today" }, { value: "tomorrow", label: "Tomorrow" }]} />

      {everyone ? (
        <Pressable onPress={() => setEveryone(false)} accessibilityRole="button" style={styles.banner}>
          <Text weight="semibold" style={{ flex: 1, fontSize: 13, color: colors.gold700 }}>Showing every physio&apos;s patients</Text>
          <Text weight="bold" style={{ fontSize: 13, color: colors.navy700 }}>Only mine</Text>
        </Pressable>
      ) : null}

      {q.isLoading ? (
        <SkeletonCards />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : all.length === 0 ? (
        <Card>
          <Empty icon="calendar-outline" title={`No patients ${dayWord}`} message={everyone ? "Nobody is booked." : "Nothing is booked for you. Pull down to refresh."} />
        </Card>
      ) : (
        <>
          {hero ? <HeroCard a={hero} step={nextStep(hero, myTherapistId)} heading={hero.status === "IN_PROGRESS" ? "With you now" : day === "today" ? "Next patient" : "First patient"} showPhysio={everyone} /> : null}

          {todo.length === 0 ? (
            <Card>
              <Empty icon="checkmark-done-outline" title={`All done ${dayWord}`} message={`${finished.length} visit${finished.length === 1 ? "" : "s"} finished.`} />
            </Card>
          ) : null}

          {later.length ? (
            <View style={{ gap: space.md }}>
              <Text weight="bold" style={styles.heading}>Coming up ({later.length})</Text>
              {later.map((a) => (
                <UpcomingCard key={a.id} a={a} step={nextStep(a, myTherapistId)} showPhysio={everyone} />
              ))}
            </View>
          ) : null}

          {finished.length ? (
            <View style={{ gap: space.sm }}>
              <Text weight="bold" style={styles.heading}>Finished ({finished.length})</Text>
              <Card style={{ paddingVertical: space.xs, paddingHorizontal: space.md, gap: 0 }}>
                {finished.map((a, i) => (
                  <FinishedRow key={a.id} a={a} first={i === 0} step={nextStep(a, myTherapistId)} />
                ))}
              </Card>
            </View>
          ) : null}
        </>
      )}

      {!everyone ? (
        <View style={{ gap: space.xs, alignItems: "center" }}>
          <Muted style={{ fontSize: 12, textAlign: "center" }}>Showing only your patients.</Muted>
          <Button title="Covering for a colleague? Show everyone" variant="ghost" small icon="people-outline" onPress={() => setEveryone(true)} />
        </View>
      ) : null}
    </Screen>
  );
}

/** The next patient: big name, time, one gold button. */
function HeroCard({ a, step, heading, showPhysio }: { a: Appointment; step: Step; heading: string; showPhysio: boolean }) {
  const arrived = a.status === "CHECKED_IN";
  return (
    <View style={styles.hero}>
      <Row style={{ justifyContent: "space-between" }}>
        <Caption style={{ color: colors.gold300 }}>{heading}</Caption>
        {arrived ? <Badge status="CHECKED_IN" text="Arrived" /> : a.source === "WALK_IN" ? <Badge status="WALK_IN" text="Walk-in" /> : null}
      </Row>
      <Text weight="bold" style={{ color: colors.white, fontSize: 21, letterSpacing: -0.3 }} numberOfLines={2}>{fullName(a.patient)}</Text>
      <Text weight="semibold" style={{ color: colors.gold300, fontSize: 15 }}>{time(a.startAt)} · {kindLine(a)}</Text>
      {a.treatmentPlan ? <Text style={{ color: colors.navy100, fontSize: 13 }} numberOfLines={2}>{a.treatmentPlan.title}</Text> : null}
      {showPhysio ? <Text style={{ color: colors.navy100, fontSize: 12 }} numberOfLines={1}>Physio: {a.therapist.user.name}</Text> : null}
      <Button title={step.label} variant="gold" icon={step.icon} onPress={step.go} style={{ marginTop: space.xs }} />
      <Pressable
        onPress={() => router.push({ pathname: "/patient/[id]", params: { id: a.patient.id } })}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Open ${fullName(a.patient)}'s file`}
        style={styles.fileLink}
      >
        <Text weight="semibold" style={{ color: colors.navy100, fontSize: 13 }}>Patient file</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.navy100} />
      </Pressable>
    </View>
  );
}

/** A patient still to see: the whole card does what its bottom bar says. */
function UpcomingCard({ a, step, showPhysio }: { a: Appointment; step: Step; showPhysio: boolean }) {
  const arrived = a.status === "CHECKED_IN";
  const busy = a.status === "IN_PROGRESS";
  return (
    <Pressable
      onPress={step.go}
      accessibilityRole="button"
      accessibilityLabel={`${time(a.startAt)}, ${fullName(a.patient)}. ${step.label}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <Row style={{ justifyContent: "space-between" }}>
        <Text weight="bold" style={{ color: colors.navy700, fontSize: 15 }}>{time(a.startAt)}</Text>
        {arrived ? <Badge status="CHECKED_IN" text="Arrived" /> : busy ? <Badge status="IN_PROGRESS" text="In progress" /> : a.source === "WALK_IN" ? <Badge status="WALK_IN" text="Walk-in" /> : null}
      </Row>
      <Text weight="bold" style={{ fontSize: 16 }} numberOfLines={2}>{fullName(a.patient)}</Text>
      <Muted numberOfLines={2}>{kindLine(a)}</Muted>
      {showPhysio ? <Muted style={{ fontSize: 12 }} numberOfLines={1}>Physio: {a.therapist.user.name}</Muted> : null}
      <View style={styles.actionBar}>
        <Ionicons name={step.icon} size={20} color={colors.gold700} />
        <Text weight="semibold" style={{ flex: 1, fontSize: 14, color: colors.navy800 }} numberOfLines={1}>{step.label}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.gold700} />
      </View>
    </Pressable>
  );
}

/** A finished (or cancelled) visit: one quiet line, tap to look back at it. */
function FinishedRow({ a, first, step }: { a: Appointment; first: boolean; step: Step }) {
  const done = a.status === "COMPLETED";
  const open = done ? step.go : () => router.push({ pathname: "/appointment/[id]", params: { id: a.id } });
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${time(a.startAt)}, ${fullName(a.patient)}, ${label(a.status)}`}
      style={({ pressed }) => [styles.finishedRow, !first && styles.rowDivider, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name={done ? "checkmark-circle" : "close-circle"} size={22} color={done ? colors.success : colors.muted} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text weight="semibold" style={{ fontSize: 14 }} numberOfLines={2}>{fullName(a.patient)}</Text>
        <Muted style={{ fontSize: 12 }}>{time(a.startAt)} · {label(a.status)}</Muted>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md, minHeight: compact ? 50 : 54, ...shadow },
  banner: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.cream, borderRadius: radius.md, borderWidth: 1, borderColor: colors.creamBorder, paddingHorizontal: space.md, paddingVertical: space.md },
  heading: { fontSize: 17, letterSpacing: -0.2, color: colors.navy900 },
  hero: { backgroundColor: colors.navy800, borderRadius: radius.lg + 4, padding: compact ? 16 : 20, gap: space.sm, overflow: "hidden" },
  fileLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: space.xs },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: compact ? 12 : 14, gap: 4, borderWidth: 1, borderColor: colors.border, ...shadow },
  actionBar: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm, backgroundColor: colors.cream, borderRadius: radius.md, borderWidth: 1, borderColor: colors.creamBorder, paddingHorizontal: space.md, minHeight: compact ? 44 : 48 },
  finishedRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
});
