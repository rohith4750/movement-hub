import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AppointmentCard } from "@/components/appointment-card";
import { BrandHeader, Button, Chips, Empty, ErrorBox, Loading, Muted, Row, Screen, Text } from "@/components/ui";
import { hasRole, useAuth } from "@/lib/auth";
import { addDays, dayParts, today } from "@/lib/format";
import { useAppointmentsOn } from "@/lib/queries";
import { colors, radius, space } from "@/theme";

type Filter = "active" | "all" | "done";
const ACTIVE = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"];

/** Appointments for a chosen day. Physiotherapists see only their own. */
export default function Visits() {
  const user = useAuth((s) => s.user);
  const isPhysio = user?.role === "PHYSIOTHERAPIST";
  const [day, setDay] = useState(today());
  const [filter, setFilter] = useState<Filter>("active");
  // Physios also run the front desk, so they see everyone's visits unless they choose "Only mine".
  const [onlyMine, setOnlyMine] = useState(false);
  const q = useAppointmentsOn(day, isPhysio && onlyMine);

  const list = (q.data ?? []).filter((a) =>
    filter === "all" ? true : filter === "active" ? ACTIVE.includes(a.status) : !ACTIVE.includes(a.status),
  );

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <BrandHeader title="Appointments" subtitle="Tap a visit to open, reschedule or update it" />
      {hasRole(user, "ADMIN", "RECEPTIONIST") ? (
        <View style={{ gap: space.sm }}>
          <Button title="Book appointment" variant="gold" icon="add-circle-outline" onPress={() => router.push("/book")} />
          <Row>
            <Button title="Walk-in" variant="ghost" small icon="walk-outline" onPress={() => router.push({ pathname: "/book", params: { walkIn: "1" } })} style={{ flex: 1 }} />
            <Button title="Plan a day" variant="ghost" small icon="clipboard-outline" onPress={() => router.push("/planner")} style={{ flex: 1 }} />
          </Row>
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {Array.from({ length: 21 }, (_, i) => addDays(today(), i - 3)).map((d) => {
          const on = d === day;
          const p = dayParts(d);
          return (
            <Pressable key={d} onPress={() => setDay(d)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.day, on && styles.dayOn]}>
              <Text style={{ fontSize: 11, color: on ? colors.gold300 : colors.muted }}>{d === today() ? "Today" : p.weekday}</Text>
              <Text weight="bold" style={{ fontSize: 18, color: on ? colors.white : colors.navy700 }}>{p.day}</Text>
              <Text style={{ fontSize: 10, color: on ? colors.navy100 : colors.muted }}>{p.month}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Row style={{ justifyContent: "space-between" }}>
        <Chips<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "active", label: "Upcoming" },
            { value: "done", label: "Done / cancelled" },
            { value: "all", label: "All" },
          ]}
        />
      </Row>
      {isPhysio ? (
        <Chips<"all" | "mine">
          value={onlyMine ? "mine" : "all"}
          onChange={(v) => setOnlyMine(v === "mine")}
          options={[
            { value: "all", label: "Everyone" },
            { value: "mine", label: "Only mine" },
          ]}
        />
      ) : null}
      {q.data ? <Muted style={{ fontSize: 12 }}>{list.length} of {q.data.length} visits</Muted> : null}

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <Empty icon="calendar-outline" title="No visits" message="Nothing matches on this day." />
      ) : (
        <View style={{ gap: space.md }}>
          {list.map((a) => (
            <AppointmentCard key={a.id} a={a} showTherapist={!(isPhysio && onlyMine)} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: { width: 58, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", backgroundColor: colors.white },
  dayOn: { backgroundColor: colors.navy700, borderColor: colors.navy700 },
});
