import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { fullName, label, time } from "@/lib/format";
import type { Appointment } from "@/lib/types";
import { colors, radius, shadow, space } from "@/theme";
import { Badge, Muted, Row, Text } from "./ui";

/** One appointment in a staff list: time, patient, visit type, physio, status. */
export function AppointmentCard({ a, showTherapist = true }: { a: Appointment; showTherapist?: boolean }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/appointment/[id]", params: { id: a.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${time(a.startAt)}, ${fullName(a.patient)}, ${label(a.type)}, ${label(a.status)}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <View style={[styles.timeBox, { borderLeftColor: a.therapist.colorTag ?? colors.gold500 }]}>
        <Text weight="bold" style={{ color: colors.navy700, fontSize: 15 }}>{time(a.startAt).replace(/ (AM|PM)$/, "")}</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>{time(a.startAt).slice(-2)}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text weight="bold" style={{ fontSize: 15, flex: 1 }} numberOfLines={1}>{fullName(a.patient)}</Text>
          <Badge status={a.status} />
        </Row>
        <Row gap={6}>
          <Muted numberOfLines={1} style={{ flex: 1 }}>
            {label(a.type)}
            {a.therapySession?.sessionNumber ? ` · #${a.therapySession.sessionNumber}` : ""} · {a.patient.patientCode}
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
  card: { flexDirection: "row", gap: space.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, ...shadow },
  timeBox: { width: 62, borderLeftWidth: 4, paddingLeft: space.sm, justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
