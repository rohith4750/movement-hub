import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppointmentCard } from "@/components/appointment-card";
import { BrandHeader, Card, Empty, ErrorBox, H2, Loading, Muted, ProgressBar, Row, Screen, Text } from "@/components/ui";
import { hasRole, useAuth } from "@/lib/auth";
import { date, greeting, inr, label, today } from "@/lib/format";
import { useAppointmentsOn, useDashboard } from "@/lib/queries";
import { colors, radius, space } from "@/theme";

const ACTIVE = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"];

export default function TodayScreen() {
  const user = useAuth((s) => s.user);
  const isPhysio = user?.role === "PHYSIOTHERAPIST";
  const canBook = hasRole(user, "ADMIN", "RECEPTIONIST");
  const canSeeMoney = hasRole(user, "ADMIN", "ACCOUNTANT");
  const dash = useDashboard();
  const todays = useAppointmentsOn(today());

  const upcoming = (todays.data ?? []).filter((a) => ACTIVE.includes(a.status) && new Date(a.endAt) > new Date());
  const done = (todays.data ?? []).filter((a) => a.status === "COMPLETED").length;

  return (
    <Screen
      refreshing={dash.isRefetching || todays.isRefetching}
      onRefresh={() => {
        dash.refetch();
        todays.refetch();
      }}
    >
      <BrandHeader title={`${greeting()}, ${user?.name.split(" ")[0] ?? ""}`} subtitle={`${label(user?.role)} · ${date(new Date())}`} />

      {/* Quick actions */}
      <Row gap={space.md}>
        {canBook ? <QuickAction icon="person-add" label="Add patient" onPress={() => router.push("/patient/new")} /> : null}
        {canBook ? <QuickAction icon="add-circle" label="Book visit" onPress={() => router.push("/book")} /> : null}
        {hasRole(user, "ADMIN", "PHYSIOTHERAPIST") ? <QuickAction icon="pulse" label="Sessions" onPress={() => router.push("/sessions")} /> : null}
        {!canBook && hasRole(user, "ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST", "ACCOUNTANT") ? <QuickAction icon="search" label="Find patient" onPress={() => router.push("/patients")} /> : null}
        {hasRole(user, "ADMIN", "RECEPTIONIST", "ACCOUNTANT") && !hasRole(user, "PHYSIOTHERAPIST") ? <QuickAction icon="wallet" label="Billing" onPress={() => router.push("/billing")} /> : null}
      </Row>

      {/* Day stats */}
      {dash.isLoading ? (
        <Loading />
      ) : dash.error ? (
        <ErrorBox error={dash.error} onRetry={() => dash.refetch()} />
      ) : dash.data ? (
        <View style={styles.grid}>
          <Stat label={isPhysio ? "My visits today" : "Visits today"} value={dash.data.todayAppointments} />
          <Stat label="Completed" value={isPhysio ? done : dash.data.completedSessionsToday} />
          <Stat label="Pending" value={dash.data.pendingAppointments} hint="awaiting confirmation" />
          {canSeeMoney && dash.data.revenueToday !== null ? (
            <Stat label="Collected today" value={inr(dash.data.revenueToday)} hint={`Month ${inr(dash.data.revenueMonth)}`} />
          ) : (
            <Stat label="Physios free" value={dash.data.availableTherapists} />
          )}
        </View>
      ) : null}

      {/* Today's list */}
      <View style={{ gap: space.sm }}>
        <Row style={{ justifyContent: "space-between" }}>
          <H2>{isPhysio ? "My next patients" : "Coming up today"}</H2>
          <Pressable onPress={() => router.push("/appointments")} hitSlop={8}>
            <Text weight="semibold" style={{ color: colors.gold700, fontSize: 13 }}>See full day</Text>
          </Pressable>
        </Row>
        {todays.isLoading ? (
          <Loading />
        ) : todays.error ? (
          <ErrorBox error={todays.error} onRetry={() => todays.refetch()} />
        ) : upcoming.length === 0 ? (
          <Card>
            <Empty icon="checkmark-done-outline" title="Nothing else today" message={done ? `${done} visit${done > 1 ? "s" : ""} completed.` : undefined} />
          </Card>
        ) : (
          upcoming.slice(0, 6).map((a) => <AppointmentCard key={a.id} a={a} showTherapist={!isPhysio} />)
        )}
      </View>

      {/* Physio utilisation (admin / reception) */}
      {!isPhysio && dash.data?.therapistUtilization.length ? (
        <Card>
          <H2>Physiotherapists today</H2>
          {dash.data.therapistUtilization.map((t) => (
            <View key={t.therapistId} style={{ gap: 4, marginTop: space.xs }}>
              <Row style={{ justifyContent: "space-between" }}>
                <Text weight="semibold" style={{ fontSize: 13 }}>{t.name}</Text>
                <Muted style={{ fontSize: 12 }}>{t.onLeave ? "On leave" : `${t.booked}/${t.total} · ${t.percent}%`}</Muted>
              </Row>
              <ProgressBar percent={t.percent} color={t.colorTag ?? colors.gold500} />
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function Stat({ label: l, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <View style={styles.stat}>
      <Muted style={{ fontSize: 11 }}>{l}</Muted>
      <Text weight="bold" style={{ fontSize: 22, color: colors.navy700 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Muted style={{ fontSize: 10 }}>{hint}</Muted> : null}
    </View>
  );
}

function QuickAction({ icon, label: l, onPress }: { icon: ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={l} style={({ pressed }) => [styles.quick, pressed && { opacity: 0.85 }]}>
      <View style={styles.quickIcon}>
        <Ionicons name={icon} size={22} color={colors.navy700} />
      </View>
      <Text weight="semibold" style={{ fontSize: 12, color: colors.navy700, textAlign: "center" }}>{l}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  stat: { flexBasis: "47%", flexGrow: 1, backgroundColor: colors.white, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.navy50, gap: 2 },
  quick: { flex: 1, backgroundColor: colors.white, borderRadius: radius.lg, paddingVertical: space.md, alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.navy50 },
  quickIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.gold100, alignItems: "center", justifyContent: "center" },
});
