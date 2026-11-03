import { Pressable, ScrollView, StyleSheet } from "react-native";
import { useTherapists } from "@/lib/queries";
import { colors, radius, space } from "@/theme";
import { Text } from "./ui";

/** "" = every physio, "none" = bills not linked to a physio, otherwise one physio's id. */
export type TherapistChoice = string;

/** Super Admin: look at one physio's bills and collections (each physio collects for their own patients). */
export function TherapistFilter({ value, onChange, withUnlinked = false }: { value: TherapistChoice; onChange: (v: TherapistChoice) => void; withUnlinked?: boolean }) {
  const therapists = useTherapists();
  const options = [
    { value: "", label: "All physios", color: null as string | null },
    ...(therapists.data ?? []).map((t) => ({ value: t.id, label: t.user.name, color: t.colorTag })),
    ...(withUnlinked ? [{ value: "none", label: "Not linked", color: null }] : []),
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value || "all"} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn, o.color ? { borderLeftWidth: 4, borderLeftColor: o.color } : null]}>
            <Text weight={on ? "semibold" : "medium"} style={{ fontSize: 13, color: on ? colors.white : colors.navy800 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.navy800, borderColor: colors.navy800 },
});
