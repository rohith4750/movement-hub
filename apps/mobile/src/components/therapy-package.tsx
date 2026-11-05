import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";
import { Card, Chips, ErrorBox, Field, Input, Loading, Muted, Row, Text } from "@/components/ui";
import { inr } from "@/lib/format";
import { useTreatmentPrices } from "@/lib/queries";
import type { TreatmentPrice } from "@/lib/types";
import { colors, radius, space } from "@/theme";

/**
 * Building a package from therapies: pick the therapies, set the number of sessions, and the price follows
 * from the one-session prices in Settings → Treatment prices:
 *   price = (sum of the chosen therapies' prices) × sessions.
 */
export interface TherapyPackageForm {
  therapies: string[];
  sessions: string;
  validity: string;
}

export const emptyTherapyPackage = (): TherapyPackageForm => ({ therapies: [], sessions: "5", validity: "90" });

/** Price of one session of these therapies, and of the whole package. */
export function therapyTotals(form: TherapyPackageForm, prices: TreatmentPrice[]) {
  const priceOf = new Map(prices.map((p) => [p.category, Number(p.price)]));
  const perSession = form.therapies.reduce((n, t) => n + (priceOf.get(t) ?? 0), 0);
  const sessions = Number(form.sessions);
  const sessionsOk = Number.isInteger(sessions) && sessions >= 1 && sessions <= 500;
  const validity = Number(form.validity);
  const validityOk = Number.isInteger(validity) && validity >= 1 && validity <= 730;
  return { perSession, sessions, sessionsOk, validity, validityOk, total: sessionsOk ? Math.round(perSession * sessions * 100) / 100 : 0 };
}

/** The therapies that currently have a price (the same list the invoice screen uses). */
export function usePricedTherapies() {
  const q = useTreatmentPrices();
  return { ...q, list: q.data ? q.data.filter((p) => p.isActive) : [] };
}

export function useTherapyTotals(form: TherapyPackageForm) {
  const { list } = usePricedTherapies();
  return therapyTotals(form, list);
}

/** Tick-list of every therapy with its one-session price. */
export function TherapyList({ selected, onToggle }: { selected: string[]; onToggle: (category: string) => void }) {
  const { list, isLoading, error, refetch } = usePricedTherapies();
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={() => void refetch()} />;
  if (list.length === 0) return <Muted>No therapy prices are set up yet. A Super Admin can add them in Settings → Treatment prices.</Muted>;
  return (
    <View style={{ gap: space.sm }}>
      {list.map((p) => {
        const on = selected.includes(p.category);
        return (
          <Pressable key={p.id} onPress={() => onToggle(p.category)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.row, on && styles.rowOn]}>
            <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.gold600 : colors.navy500} />
            <Text weight="semibold" style={{ flex: 1 }}>{p.category}</Text>
            <Text weight="bold" style={{ color: colors.navy700 }}>{inr(p.price)}</Text>
          </Pressable>
        );
      })}
      <Muted style={{ fontSize: 12 }}>Prices are for one session. Change them in Settings → Treatment prices.</Muted>
    </View>
  );
}

/** One line of the price summary: a wrapping label on the left, an amount on the right. */
function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <Row gap={space.md} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
      <Muted style={{ flex: 1, fontSize: 13 }}>{k}</Muted>
      <Text weight={strong ? "bold" : "semibold"} style={{ fontSize: strong ? 18 : 14, color: strong ? colors.navy800 : colors.text }}>{v}</Text>
    </Row>
  );
}

/** Therapies + sessions + validity, with the live price underneath. */
export function TherapyPackageBuilder({ form, onChange }: { form: TherapyPackageForm; onChange: (f: TherapyPackageForm) => void }) {
  const t = useTherapyTotals(form);
  const toggle = (c: string) => onChange({ ...form, therapies: form.therapies.includes(c) ? form.therapies.filter((x) => x !== c) : [...form.therapies, c] });
  return (
    <View style={{ gap: space.md }}>
      <Field label="Therapies">
        <TherapyList selected={form.therapies} onToggle={toggle} />
      </Field>

      <Field label="Number of sessions">
        <Row gap={space.sm}>
          <View style={{ width: 84 }}>
            <Input value={form.sessions} onChangeText={(v) => onChange({ ...form, sessions: v.replace(/\D/g, "").slice(0, 3) })} keyboardType="number-pad" accessibilityLabel="Number of sessions" />
          </View>
          <View style={{ flex: 1 }}>
            <Chips
              value={form.sessions}
              onChange={(v) => onChange({ ...form, sessions: v })}
              options={[
                { value: "1", label: "1" },
                { value: "5", label: "5" },
                { value: "10", label: "10" },
                { value: "12", label: "12" },
              ]}
            />
          </View>
        </Row>
      </Field>

      <Field label="Valid for (days)">
        <Input value={form.validity} onChangeText={(v) => onChange({ ...form, validity: v.replace(/\D/g, "").slice(0, 3) })} keyboardType="number-pad" accessibilityLabel="Validity in days" />
      </Field>

      <Card gold style={{ gap: 6 }}>
        {form.therapies.length === 0 ? (
          <Muted>Tick the therapies to see the price.</Muted>
        ) : (
          <>
            <Line k={`1 session: ${form.therapies.join(" + ")}`} v={inr(t.perSession)} />
            <Line k="Number of sessions" v={t.sessionsOk ? `× ${t.sessions}` : "—"} />
            <Line k="Package price" v={t.sessionsOk ? inr(t.total) : "—"} strong />
            <Muted style={{ fontSize: 12 }}>Before GST. Worked out from the one-session prices in Settings.</Muted>
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  rowOn: { borderColor: colors.gold500, backgroundColor: colors.cream },
});
