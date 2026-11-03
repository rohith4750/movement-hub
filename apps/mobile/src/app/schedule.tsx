import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { DateField, goBack, RequireRole } from "@/components/form";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { addDays, date, dayParts, fullName, label, time, today } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useAction } from "@/lib/refresh";
import { colors, radius, space } from "@/theme";

interface CalSlot {
  id: string;
  startAt: string;
  endAt: string;
  status: "AVAILABLE" | "BOOKED" | "BLOCKED";
  appointment: { id: string; appointmentNo: string; type: string; status: string; patient: { id: string; firstName: string; lastName: string | null } } | null;
}
interface CalTherapist {
  id: string;
  name: string;
  colorTag: string | null;
  leaves: { id: string }[];
  slots: CalSlot[];
}
interface Calendar {
  from: string;
  days: number;
  therapists: CalTherapist[];
}

/** Day grid for all physiotherapists (like the web Schedule). Front desk can block / unblock free slots. */
export default function Schedule() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"]} title="Schedule">
      <ScheduleDay />
    </RequireRole>
  );
}

function ScheduleDay() {
  const user = useAuth((s) => s.user);
  const canBlock = hasRole(user, "ADMIN", "RECEPTIONIST");
  const [day, setDay] = useState(today());
  const [onlyMine, setOnlyMine] = useState(user?.role === "PHYSIOTHERAPIST");
  const cal = useQuery({ queryKey: qk.calendar(day), queryFn: () => api.get<Calendar>("/calendar", { view: "day", date: day }) });

  const toggle = useAction(
    async (s: CalSlot) => {
      const block = s.status !== "BLOCKED";
      if (block && !(await confirm("Block this slot?", `${time(s.startAt)} will not be bookable.`, "Block"))) return null;
      return api.patch(`/slots/${s.id}`, { status: block ? "BLOCKED" : "AVAILABLE" });
    },
    { refresh: ["schedule"] },
  );

  const therapists = (cal.data?.therapists ?? []).filter((t) => !onlyMine || t.id === user?.therapistId);
  const p = dayParts(day);

  return (
    <Screen edges={["top", "bottom"]} refreshing={cal.isRefetching} onRefresh={() => cal.refetch()}>
      <TopBar title="Schedule" onBack={() => goBack("/more")} />

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Pressable onPress={() => setDay(addDays(day, -1))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous day" style={styles.navBtn}>
            <Ionicons name="chevron-back" size={20} color={colors.navy700} />
          </Pressable>
          <View style={{ alignItems: "center" }}>
            <Text weight="bold" style={{ fontSize: 16, color: colors.navy700 }}>{day === today() ? "Today" : p.weekday}</Text>
            <Muted>{date(`${day}T06:00:00Z`)}</Muted>
          </View>
          <Pressable onPress={() => setDay(addDays(day, 1))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next day" style={styles.navBtn}>
            <Ionicons name="chevron-forward" size={20} color={colors.navy700} />
          </Pressable>
        </Row>
        <Row>
          <View style={{ flex: 1 }}>
            <DateField label="Go to date" value={day} onChange={(v) => v && setDay(v)} />
          </View>
          {day !== today() ? <Button title="Today" variant="ghost" small onPress={() => setDay(today())} style={{ alignSelf: "flex-end" }} /> : null}
        </Row>
        {user?.role === "PHYSIOTHERAPIST" ? (
          <Button title={onlyMine ? "Show all physiotherapists" : "Show only my schedule"} variant="ghost" small icon="people-outline" onPress={() => setOnlyMine((v) => !v)} style={{ alignSelf: "flex-start" }} />
        ) : null}
      </Card>

      {toggle.error ? <ErrorBox error={toggle.error} /> : null}

      {cal.isLoading ? (
        <Loading />
      ) : cal.error ? (
        <ErrorBox error={cal.error} onRetry={() => cal.refetch()} />
      ) : therapists.every((t) => t.slots.length === 0) ? (
        <Empty icon="grid-outline" title="No slots this day" message="The clinic may be closed, or slots haven't been generated yet (Therapists → Schedule)." />
      ) : (
        therapists.map((t) => {
          const booked = t.slots.filter((s) => s.status === "BOOKED").length;
          const free = t.slots.filter((s) => s.status === "AVAILABLE").length;
          return (
            <Card key={t.id}>
              <Row style={{ justifyContent: "space-between" }}>
                <Row gap={6} style={{ flex: 1 }}>
                  <View style={[styles.dot, { backgroundColor: t.colorTag ?? colors.gold500 }]} />
                  <Text weight="bold" style={{ fontSize: 15, flex: 1 }} numberOfLines={1}>{t.name}</Text>
                </Row>
                {t.leaves.length ? <Badge status="CANCELLED" text="On leave" /> : <Muted style={{ fontSize: 12 }}>{booked} booked · {free} free</Muted>}
              </Row>
              {t.slots.length === 0 ? (
                <Muted style={{ fontSize: 12 }}>No slots.</Muted>
              ) : (
                t.slots.map((s) =>
                  s.appointment ? (
                    <Pressable
                      key={s.id}
                      onPress={() => router.push({ pathname: "/appointment/[id]", params: { id: s.appointment!.id } })}
                      accessibilityRole="button"
                      style={[styles.slot, { backgroundColor: colors.navy50, borderLeftColor: t.colorTag ?? colors.navy700 }]}
                    >
                      <Text weight="semibold" style={styles.slotTime}>{time(s.startAt)}</Text>
                      <View style={{ flex: 1 }}>
                        <Text weight="semibold" numberOfLines={1}>{fullName(s.appointment.patient)}</Text>
                        <Muted style={{ fontSize: 12 }} numberOfLines={1}>{label(s.appointment.type)}</Muted>
                      </View>
                      <Badge status={s.appointment.status} />
                    </Pressable>
                  ) : (
                    <Pressable
                      key={s.id}
                      onPress={canBlock ? () => toggle.mutate(s) : undefined}
                      disabled={!canBlock || toggle.isPending}
                      accessibilityRole={canBlock ? "button" : undefined}
                      accessibilityLabel={`${time(s.startAt)} ${s.status === "BLOCKED" ? "blocked, tap to unblock" : "free, tap to block"}`}
                      style={[styles.slot, s.status === "BLOCKED" ? styles.blocked : styles.free]}
                    >
                      <Text weight="semibold" style={[styles.slotTime, s.status === "BLOCKED" && { color: colors.muted }]}>{time(s.startAt)}</Text>
                      <Text style={{ flex: 1, color: s.status === "BLOCKED" ? colors.muted : colors.success, textDecorationLine: s.status === "BLOCKED" ? "line-through" : "none" }}>
                        {s.status === "BLOCKED" ? "Blocked" : "Free"}
                      </Text>
                      {canBlock ? <Ionicons name={s.status === "BLOCKED" ? "lock-open-outline" : "lock-closed-outline"} size={16} color={colors.muted} /> : null}
                    </Pressable>
                  ),
                )
              )}
            </Card>
          );
        })
      )}
      {canBlock ? <Muted style={{ fontSize: 12, textAlign: "center" }}>Tap a free slot to block it, or a blocked slot to free it.</Muted> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  navBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  dot: { width: 10, height: 10, borderRadius: 5 },
  slot: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, paddingHorizontal: space.md, borderRadius: radius.sm, borderLeftWidth: 4 },
  slotTime: { width: 72, fontSize: 13, color: colors.navy700 },
  free: { backgroundColor: colors.successBg, borderLeftColor: colors.success },
  blocked: { backgroundColor: "#F1F5F9", borderLeftColor: colors.navy100 },
});
