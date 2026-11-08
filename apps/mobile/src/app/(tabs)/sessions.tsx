import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Badge, BrandHeader, Chips, Empty, ErrorBox, Muted, Row, Screen, SkeletonCards, Text } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { fullName, time } from "@/lib/format";
import { useTodaySessions } from "@/lib/queries";
import { colors, radius, shadow, space } from "@/theme";

/** Today's therapy sessions — all clinic sessions by default, with option to filter to own. */
export default function Sessions() {
  const user = useAuth((s) => s.user);
  const isPhysio = user?.role === "PHYSIOTHERAPIST";
  const [onlyMine, setOnlyMine] = useState(false);
  const q = useTodaySessions();
  const rawList = q.data ?? [];
  const list = isPhysio && onlyMine ? rawList.filter((s) => s.therapist.id === user?.therapistId) : rawList;
  const open = list.filter((s) => s.status === "SCHEDULED" || s.status === "IN_PROGRESS");
  const done = list.filter((s) => s.status === "COMPLETED");

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <BrandHeader title="Therapy sessions" subtitle="All therapy sessions today" />
      {isPhysio ? (
        <Chips<"all" | "mine">
          value={onlyMine ? "mine" : "all"}
          onChange={(v) => setOnlyMine(v === "mine")}
          options={[
            { value: "all", label: "All physios" },
            { value: "mine", label: "My sessions" },
          ]}
        />
      ) : null}
      {q.isLoading ? (
        <SkeletonCards />
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
                {/* Time and status on top, then the rest at the full card width (a time column on the left squeezed every line into "…") */}
                <View style={{ flex: 1, gap: 3 }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text weight="bold" style={{ color: colors.navy700 }}>{time(s.appointment.startAt)}</Text>
                    <Badge status={s.status} />
                  </Row>
                  <Text weight="bold" style={{ fontSize: 15 }} numberOfLines={2}>{fullName(s.patient)}</Text>
                  <Muted numberOfLines={2}>
                    {s.treatmentPlan?.title ?? "Therapy"} · Session {s.sessionNumber ?? "–"}
                    {s.treatmentPlan ? `/${s.treatmentPlan.prescribedSessions}` : ""}
                  </Muted>
                  <Muted style={{ fontSize: 12 }} numberOfLines={2}>
                    {s.patientPackage ? `${s.patientPackage.package.name} · ${s.patientPackage.remainingSessions} left` : "Pay per visit"}
                  </Muted>
                  <Row gap={6}>
                    <Muted style={{ fontSize: 12, flex: 1 }} numberOfLines={1}>{s.therapist.user.name}</Muted>
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
});
