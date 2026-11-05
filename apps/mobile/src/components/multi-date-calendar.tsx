import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui";
import { today } from "@/lib/format";
import { colors, space } from "@/theme";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Month calendar where staff tap the exact dates they want (tap again to remove). Dates outside min..max
 * can't be chosen. Every week is its own flex row of seven equal cells, so nothing depends on measured widths.
 */
export function MultiDateCalendar({ selected, onToggle, min, max }: { selected: string[]; onToggle: (ymd: string) => void; min: string; max: string }) {
  const [ym, setYm] = useState((selected[0] ?? min).slice(0, 7));
  const [y, m] = ym.split("-").map(Number);
  const offset = (new Date(Date.UTC(y, m - 1, 1, 12)).getUTCDay() + 6) % 7; // Monday first
  const count = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  const cells: (number | null)[] = [...Array<null>(offset).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const go = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1, 12));
    setYm(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const canPrev = ym > min.slice(0, 7);
  const canNext = ym < max.slice(0, 7);
  const todayYmd = today();

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Pressable onPress={() => go(-1)} disabled={!canPrev} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month" style={[styles.nav, !canPrev && { opacity: 0.3 }]}>
          <Ionicons name="chevron-back" size={20} color={colors.navy700} />
        </Pressable>
        <Text weight="bold" style={{ color: colors.navy800, fontSize: 15 }}>{MONTHS[m - 1]} {y}</Text>
        <Pressable onPress={() => go(1)} disabled={!canNext} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next month" style={[styles.nav, !canNext && { opacity: 0.3 }]}>
          <Ionicons name="chevron-forward" size={20} color={colors.navy700} />
        </Pressable>
      </View>

      <View style={styles.week}>
        {HEAD.map((h) => (
          <View key={h} style={styles.cell}>
            <Text weight="semibold" style={{ fontSize: 11, color: colors.muted }}>{h}</Text>
          </View>
        ))}
      </View>

      {weeks.map((w, r) => (
        <View key={r} style={styles.week}>
          {w.map((d, i) => {
            if (d === null) return <View key={i} style={styles.cell} />;
            const ymd = `${ym}-${pad(d)}`;
            const on = selected.includes(ymd);
            const off = ymd < min || ymd > max;
            return (
              <Pressable
                key={i}
                disabled={off}
                onPress={() => onToggle(ymd)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: off }}
                accessibilityLabel={ymd}
                style={styles.cell}
              >
                <View style={[styles.day, on && styles.dayOn, !on && ymd === todayYmd && styles.dayToday]}>
                  <Text weight={on ? "bold" : "medium"} style={{ fontSize: 14, color: on ? colors.white : off ? "#B5BCCB" : colors.navy800 }}>{d}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: space.sm, gap: 2 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: space.xs },
  nav: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.navy50, alignItems: "center", justifyContent: "center" },
  week: { flexDirection: "row" },
  cell: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 2 },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  dayOn: { backgroundColor: colors.navy700 },
  dayToday: { borderWidth: 1.5, borderColor: colors.gold500 },
});
