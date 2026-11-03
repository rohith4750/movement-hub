import { StyleSheet, View } from "react-native";
import { colors, radius } from "@/theme";
import { Muted, Row } from "./ui";

/** One look for time slots everywhere (booking, planner, schedule): available / booked / unavailable. */
export const slotStyles = StyleSheet.create({
  free: { backgroundColor: colors.white, borderColor: colors.navy100 },
  booked: { backgroundColor: colors.navy50, borderColor: colors.navy50 },
  off: { backgroundColor: "#F1F5F9", borderColor: "#F1F5F9" },
  selected: { backgroundColor: colors.navy800, borderColor: colors.navy800 },
  dot: { width: 14, height: 14, borderRadius: radius.sm / 2, borderWidth: 1 },
});

export function SlotLegend() {
  const item = (style: object, text: string) => (
    <Row gap={6}>
      <View style={[slotStyles.dot, style]} />
      <Muted style={{ fontSize: 11 }}>{text}</Muted>
    </Row>
  );
  return (
    <Row gap={12} style={{ flexWrap: "wrap" }}>
      {item(slotStyles.free, "Available")}
      {item(slotStyles.booked, "Booked")}
      {item(slotStyles.off, "Unavailable")}
    </Row>
  );
}
