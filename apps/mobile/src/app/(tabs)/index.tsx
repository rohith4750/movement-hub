import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppointmentCard } from "@/components/appointment-card";
import { BrandHeader, Card, Empty, ErrorBox, H2, Loading, Muted, ProgressBar, Row, Screen, Text } from "@/components/ui";
import { hasRole, useAuth } from "@/lib/auth";
import { date, greeting, inr, label, today } from "@/lib/format";
import { useAppointmentsOn, useDashboard, useFinanceAnalytics, usePatientAnalytics } from "@/lib/queries";
import { colors, space } from "@/theme";

const ACTIVE = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"];

export default function TodayScreen() {
  const user = useAuth((s) => s.user);
  const isPhysio = user?.role === "PHYSIOTHERAPIST";
  const canBook = hasRole(user, "ADMIN", "RECEPTIONIST");
  const canSeeMoney = hasRole(user, "ADMIN", "ACCOUNTANT");
  const isOwner = hasRole(user, "ADMIN"); // Super Admin / admin: clinic-wide figures
  const dash = useDashboard();
  const todays = useAppointmentsOn(today(), false);
  // Headlines for the owner / accountant; the full detail is in Reports.
  const monthRange = { from: `${today().slice(0, 7)}-01`, to: today() };
  const money = useFinanceAnalytics(monthRange, undefined, canSeeMoney);
  const people = usePatientAnalytics(monthRange, isOwner);

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
        {canBook ? <QuickAction icon="clipboard" label="Plan day" onPress={() => router.push("/planner")} /> : null}
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
          <Stat label="Visits today" value={dash.data.todayAppointments} />
          <Stat label="Completed" value={dash.data.completedSessionsToday} />
          <Stat label="Pending" value={dash.data.pendingAppointments} hint="awaiting confirmation" />
          {canSeeMoney && dash.data.revenueToday !== null ? (
            <Stat label="Collected today" value={inr(dash.data.revenueToday)} hint={`Month ${inr(dash.data.revenueMonth)}`} />
          ) : (
            <Stat label="Physios free" value={dash.data.availableTherapists} />
          )}
          {isOwner ? (
            <>
              <Stat label="Walk-ins today" value={dash.data.walkInsToday} hint={`${dash.data.scheduledToday} booked ahead`} />
              <Stat label="Regular patients" value={dash.data.regularPatients} hint={`of ${dash.data.totalPatients} · ${dash.data.newPatientsMonth} new this month`} />
            </>
          ) : null}
        </View>
      ) : null}

      {/* This month: headline numbers from Reports */}
      {(canSeeMoney && money.data) || (isOwner && people.data) ? (
        <Pressable onPress={() => router.push("/reports")} accessibilityRole="button" accessibilityLabel="Open reports">
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <H2>This month</H2>
              <Row gap={4}>
                <Text weight="semibold" style={{ color: colors.gold700, fontSize: 13 }}>Reports</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.gold700} />
              </Row>
            </Row>
            <Row gap={space.md} style={{ alignItems: "flex-start" }}>
              {canSeeMoney && money.data ? (
                <Mini
                  label="Revenue"
                  value={inr(money.data.netRevenue)}
                  hint={money.data.changePct === null ? "first month" : `${money.data.changePct >= 0 ? "▲" : "▼"} ${Math.abs(money.data.changePct)}% vs last period`}
                  good={money.data.changePct !== null && money.data.changePct > 0}
                  bad={money.data.changePct !== null && money.data.changePct < 0}
                />
              ) : null}
              {isOwner && people.data ? <Mini label="New patients" value={String(people.data.newPatients)} hint={`${people.data.activePatients} seen`} /> : null}
              {isOwner && people.data ? <Mini label="To call back" value={String(people.data.dropOffCount)} hint={`away ${people.data.dropOffDays}+ days`} bad={people.data.dropOffCount > 0} /> : null}
            </Row>
          </Card>
        </Pressable>
      ) : null}

      {/* Today's list */}
      <View style={{ gap: space.sm }}>
        <Row style={{ justifyContent: "space-between" }}>
          <H2>Coming up today</H2>
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
          upcoming.slice(0, 6).map((a) => <AppointmentCard key={a.id} a={a} showTherapist={true} />)
        )}
      </View>

      {/* Physio utilisation */}
      {dash.data?.therapistUtilization.length ? (
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

/** One headline number in the "This month" card. */
function Mini({ label: l, value, hint, good, bad }: { label: string; value: string; hint?: string; good?: boolean; bad?: boolean }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Muted style={{ fontSize: 12 }}>{l}</Muted>
      <Text weight="bold" style={{ fontSize: 20, color: colors.navy800, letterSpacing: -0.4 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Text style={{ fontSize: 11, color: good ? colors.success : bad ? colors.danger : colors.muted }} numberOfLines={2}>{hint}</Text> : null}
    </View>
  );
}

function Stat({ label: l, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card style={styles.statCard}>
      <Muted style={{ fontSize: 12 }}>{l}</Muted>
      <Text weight="bold" style={{ fontSize: 28, color: colors.navy800, letterSpacing: -0.5 }}>
        {value}
      </Text>
      {hint ? <Muted style={{ fontSize: 11 }}>{hint}</Muted> : null}
    </Card>
  );
}

function QuickAction({ icon, label: l, onPress }: { icon: ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]} onPress={onPress} accessibilityRole="button">
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={22} color={colors.navy700} />
      </View>
      <Text weight="semibold" style={{ fontSize: 11, textAlign: "center", color: colors.navy700 }}>
        {l}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  statCard: { width: "47.5%", padding: space.lg, gap: 2 },
  action: { flex: 1, alignItems: "center", gap: space.xs },
  actionIcon: { width: 56, height: 56, borderRadius: 20, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, shadowColor: "#1C2670", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
});
