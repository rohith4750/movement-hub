import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { fullName, label, time } from "@/lib/format";
import type { Appointment } from "@/lib/types";
import { colors, compact, radius, shadow, space } from "@/theme";
import { Avatar, Badge, Muted, Row, Text } from "./ui";

/** One appointment in a staff list: patient, time and visit type, physio, status. */
export function AppointmentCard({ a, showTherapist = true }: { a: Appointment; showTherapist?: boolean }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/appointment/[id]", params: { id: a.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${time(a.startAt)}, ${fullName(a.patient)}, ${label(a.type)}, ${label(a.status)}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <Avatar name={fullName(a.patient)} size={compact ? 40 : 46} />
      <View style={{ flex: 1, gap: 2 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text weight="bold" style={{ fontSize: 12, color: colors.navy700 }}>{a.patient.patientCode}</Text>
          <Badge status={a.status} />
        </Row>
        <Text weight="semibold" style={{ fontSize: 15 }} numberOfLines={2}>{fullName(a.patient)}</Text>
        <Row gap={6}>
          <Muted numberOfLines={1} style={{ flex: 1, fontSize: 12 }}>
            {time(a.startAt)} · {label(a.type)}
            {a.therapySession?.sessionNumber ? ` · #${a.therapySession.sessionNumber}` : ""}
          </Muted>
          {a.source === "WALK_IN" ? <Badge status="WALK_IN" text="Walk-in" /> : null}
        </Row>
        {showTherapist ? (
          <Row gap={6}>
            <View style={[styles.dot, { backgroundColor: a.therapist.colorTag ?? colors.gold500 }]} />
            <Muted numberOfLines={1} style={{ flex: 1, fontSize: 12 }}>{a.therapist.user.name}</Muted>
            <Ionicons name="chevron-forward" size={16} color={colors.muted} />
          </Row>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: compact ? 12 : 14, borderWidth: 1, borderColor: colors.border, ...shadow },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
