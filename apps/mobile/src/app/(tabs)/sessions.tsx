import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Badge, BrandHeader, Empty, ErrorBox, Loading, Muted, Row, Screen, Text } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { fullName, time } from "@/lib/format";
import { useTodaySessions } from "@/lib/queries";
import { colors, radius, shadow, space } from "@/theme";

/** Today's therapy sessions — a physio's own list (admins see everyone's). */
export default function Sessions() {
  const user = useAuth((s) => s.user);
  const q = useTodaySessions();
  const list = q.data ?? [];
  const open = list.filter((s) => s.status === "SCHEDULED" || s.status === "IN_PROGRESS");
  const done = list.filter((s) => s.status === "COMPLETED");

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <BrandHeader title="Therapy sessions" subtitle={user?.role === "PHYSIOTHERAPIST" ? "Your patients today" : "All physiotherapists today"} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <Empty icon="pulse-outline" title="No therapy sessions today" />
      ) : (
        <>
          <Muted>{open.length} to do · {done.length} completed</Muted>
          <View style={{ gap: space.md }}>
            {[...open, ...done, ...list.filter((s) => !open.includes(s) && !done.includes(s))].map((s) => (
              <Pressable
                key={s.id}
                onPress={() => router.push({ pathname: "/session/[id]", params: { id: s.id } })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }, s.status === "IN_PROGRESS" && { borderColor: colors.gold500 }]}
              >
                <View style={styles.time}>
                  <Text weight="bold" style={{ color: colors.navy700 }}>{time(s.appointment.startAt)}</Text>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text weight="bold" style={{ fontSize: 15, flex: 1 }} numberOfLines={1}>{fullName(s.patient)}</Text>
                    <Badge status={s.status} />
                  </Row>
                  <Muted numberOfLines={1}>
                    {s.treatmentPlan?.title ?? "Therapy"} · Session {s.sessionNumber ?? "–"}
                    {s.treatmentPlan ? `/${s.treatmentPlan.prescribedSessions}` : ""}
                  </Muted>
                  <Row gap={6}>
                    <Muted style={{ fontSize: 12, flex: 1 }} numberOfLines={1}>
                      {s.patientPackage ? `${s.patientPackage.package.name} · ${s.patientPackage.remainingSessions} left` : "Pay per visit"}
                      {user?.role !== "PHYSIOTHERAPIST" ? ` · ${s.therapist.user.name}` : ""}
                    </Muted>
                    <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                  </Row>
                </View>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: space.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, ...shadow },
  time: { width: 70, justifyContent: "center" },
});
