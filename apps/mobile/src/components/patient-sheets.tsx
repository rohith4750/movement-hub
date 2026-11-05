/** Patient-profile building blocks: medical-history and sell-package sheets, pain-progress card. */
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { DateField, Sheet, StatTile } from "@/components/form";
import { Button, Card, ErrorBox, Field, H2, Input, Loading, Muted, ProgressBar, Row, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { inr, today } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { MedicalHistoryEntry } from "@/lib/types";
import { useAction } from "@/lib/refresh";
import { colors, radius, space } from "@/theme";

/* ───────────── Medical history ───────────── */

/**
 * Add a medical-history entry, or edit one when `entry` is given. The parent keys the sheet by the entry,
 * so it starts with that entry's values each time it opens.
 */
export function MedicalHistorySheet({ patientId, open, onClose, entry }: { patientId: string; open: boolean; onClose: () => void; entry?: MedicalHistoryEntry | null }) {
  const [f, setF] = useState({
    condition: entry ? entry.condition : "",
    details: entry && entry.details ? entry.details : "",
    diagnosedOn: entry && entry.diagnosedOn ? entry.diagnosedOn.slice(0, 10) : "",
    medications: entry && entry.medications ? entry.medications : "",
    surgeries: entry && entry.surgeries ? entry.surgeries : "",
    allergies: entry && entry.allergies ? entry.allergies : "",
  });
  const [ongoing, setOngoing] = useState(entry ? entry.isOngoing : true);
  const set = (k: keyof typeof f) => (t: string) => setF((x) => ({ ...x, [k]: t }));
  const editing = !!entry;

  const save = useAction(
    () => {
      // When editing, blanks are sent as empty text so a field can be cleared; when adding they are left out.
      const text = (v: string) => (editing ? v.trim() : v.trim() || undefined);
      const body = {
        condition: f.condition.trim(),
        details: text(f.details),
        diagnosedOn: f.diagnosedOn || undefined,
        medications: text(f.medications),
        surgeries: text(f.surgeries),
        allergies: text(f.allergies),
        isOngoing: ongoing,
      };
      return entry ? api.patch(`/patients/${patientId}/medical-history/${entry.id}`, body) : api.post(`/patients/${patientId}/medical-history`, body);
    },
    {
      refresh: ["patients"],
      onSuccess: () => {
        if (!editing) {
          setF({ condition: "", details: "", diagnosedOn: "", medications: "", surgeries: "", allergies: "" });
          setOngoing(true);
        }
        onClose();
      },
    },
  );

  const ok = f.condition.trim().length >= 2;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit medical history" : "Add medical history"}
      footer={<Button title="Save" icon="save-outline" onPress={() => save.mutate()} disabled={!ok} loading={save.isPending} />}
    >
      <Field label="Condition *"><Input value={f.condition} onChangeText={set("condition")} placeholder="e.g. Type 2 diabetes" /></Field>
      <Field label="Details"><Input value={f.details} onChangeText={set("details")} multiline /></Field>
      <DateField label="Diagnosed on" value={f.diagnosedOn} onChange={set("diagnosedOn")} maximumDate={new Date(`${today()}T12:00:00`)} clearable />
      <Field label="Medications"><Input value={f.medications} onChangeText={set("medications")} /></Field>
      <Field label="Surgeries"><Input value={f.surgeries} onChangeText={set("surgeries")} /></Field>
      <Field label="Allergies"><Input value={f.allergies} onChangeText={set("allergies")} /></Field>
      <Row style={{ justifyContent: "space-between" }}>
        <Text>Ongoing condition</Text>
        <Switch value={ongoing} onValueChange={setOngoing} trackColor={{ true: colors.gold500, false: colors.navy100 }} thumbColor={colors.white} />
      </Row>
      {!ok ? <Muted style={{ fontSize: 12, color: colors.warning }}>Enter the condition (2+ characters)</Muted> : null}
      <ErrorBox error={save.error} />
    </Sheet>
  );
}

/* ───────────── Sell package ───────────── */

interface PackageDef {
  id: string;
  name: string;
  tier: string;
  sessionCount: number;
  validityDays: number;
  price: string;
  description: string | null;
}

export function SellPackageSheet({ patientId, open, onClose }: { patientId: string; open: boolean; onClose: () => void }) {
  const pkgs = useQuery({ queryKey: qk.packages("active"), queryFn: () => api.get<PackageDef[]>("/packages"), enabled: open });
  const [packageId, setPackageId] = useState("");
  const [discount, setDiscount] = useState("");
  const [reason, setReason] = useState("");
  const chosen = pkgs.data?.find((p) => p.id === packageId);
  const discountNum = discount ? Number(discount) : 0;

  const sell = useAction(
    () =>
      api.post<{ invoice: { id: string } }>("/patient-packages", {
        patientId,
        packageId,
        discountAmount: discountNum,
        discountReason: reason.trim() || undefined,
      }),
    {
      refresh: ["packages", "billing"],
      onSuccess: (r) => {
        onClose();
        setPackageId("");
        setDiscount("");
        setReason("");
        router.push({ pathname: "/invoice/[id]", params: { id: r.invoice.id } });
      },
    },
  );

  const problem = !packageId
    ? "Choose a package"
    : chosen && discountNum > Number(chosen.price)
      ? "Discount can't be more than the price"
      : discountNum > 0 && !reason.trim()
        ? "Add a reason for the discount"
        : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Sell treatment package"
      footer={<Button title="Create package & invoice" icon="pricetags-outline" onPress={() => sell.mutate()} disabled={!!problem} loading={sell.isPending} />}
    >
      {pkgs.isLoading ? (
        <Loading />
      ) : pkgs.error ? (
        <ErrorBox error={pkgs.error} onRetry={() => pkgs.refetch()} />
      ) : !pkgs.data?.length ? (
        <Muted>No packages are on sale. An admin can add them on the Packages screen.</Muted>
      ) : (
        pkgs.data.map((p) => {
          const on = p.id === packageId;
          return (
            <Pressable key={p.id} onPress={() => setPackageId(p.id)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.pkg, on && styles.pkgOn]}>
              <View style={{ flex: 1 }}>
                <Text weight="bold">{p.name}</Text>
                <Muted style={{ fontSize: 12 }}>{p.sessionCount} sessions · {p.validityDays} days</Muted>
              </View>
              <Text weight="bold" style={{ color: colors.navy700 }}>{inr(p.price)}</Text>
            </Pressable>
          );
        })
      )}
      <Row gap={space.sm}>
        <View style={{ flex: 1 }}>
          <Field label="Discount (₹)"><Input value={discount} onChangeText={(t) => setDiscount(t.replace(/[^\d.]/g, ""))} keyboardType="decimal-pad" placeholder="0" /></Field>
        </View>
        <View style={{ flex: 1.4 }}>
          <Field label="Discount reason"><Input value={reason} onChangeText={setReason} /></Field>
        </View>
      </Row>
      <Muted style={{ fontSize: 12 }}>An invoice with GST is created automatically. Collect payment from the invoice.</Muted>
      {problem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
      <ErrorBox error={sell.error} />
    </Sheet>
  );
}

/* ───────────── Pain progress ───────────── */

interface Progress {
  activePlan: { id: string; title: string; prescribedSessions: number; completedSessions: number; percent: number } | null;
  initialPain: number | null;
  latestPain: number | null;
  painReduction: number | null;
  timeline: { id: string; sessionNumber: number | null; completedAt: string; painBefore: number | null; painAfter: number | null }[];
  /** Daily check-ins, oldest first (last 30). Absent when the server is older than the app. */
  dailyLog?: { date: string; painScore: number | null; status: "IMPROVED" | "SAME" | "WORSE" | null }[];
  dailyCount?: number;
  dailyStatus?: { improved: number; same: number; worse: number };
}

export function PainProgressCard({ patientId }: { patientId: string }) {
  const q = useQuery({ queryKey: qk.patientProgress(patientId), queryFn: () => api.get<Progress>(`/patients/${patientId}/progress`) });
  const p = q.data;
  // Older servers don't send the daily check-ins; treat them as none rather than crashing.
  const dailyLog = p && p.dailyLog ? p.dailyLog : [];
  const dailyStatus = p && p.dailyStatus ? p.dailyStatus : { improved: 0, same: 0, worse: 0 };
  return (
    <Card>
      <H2>Progress</H2>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : p ? (
        <>
          <View style={styles.tiles}>
            <StatTile label="Active plan" value={p.activePlan ? `${p.activePlan.percent}%` : "—"} hint={p.activePlan ? `${p.activePlan.completedSessions}/${p.activePlan.prescribedSessions} sessions` : undefined} />
            <StatTile label="Pain start → now" value={p.initialPain !== null || p.latestPain !== null ? `${p.initialPain ?? "–"} → ${p.latestPain ?? "–"}` : "—"} hint="0–10 scale" good={p.painReduction !== null && p.painReduction > 0} />
          </View>
          {p.activePlan ? <ProgressBar percent={p.activePlan.percent} /> : null}
          {p.timeline.length === 0 ? (
            <Muted style={{ fontSize: 12 }}>The pain trend appears after the first completed therapy session.</Muted>
          ) : (
            <>
              <View style={styles.chart}>
                {p.timeline.slice(-12).map((s) => (
                  <View key={s.id} style={styles.barGroup} accessible accessibilityLabel={`Session ${s.sessionNumber ?? ""}: pain ${s.painBefore ?? "?"} before, ${s.painAfter ?? "?"} after`}>
                    <View style={styles.bars}>
                      <View style={[styles.bar, { height: `${(s.painBefore ?? 0) * 10}%`, backgroundColor: colors.navy100 }]} />
                      <View style={[styles.bar, { height: `${(s.painAfter ?? 0) * 10}%`, backgroundColor: colors.gold500 }]} />
                    </View>
                    <Muted style={{ fontSize: 10 }}>#{s.sessionNumber ?? "–"}</Muted>
                  </View>
                ))}
              </View>
              <Row gap={space.lg}>
                <Legend color={colors.navy100} text="Before session" />
                <Legend color={colors.gold500} text="After session" />
              </Row>
            </>
          )}
          {dailyLog.length > 0 ? (
            <View style={{ gap: space.xs }}>
              <Text weight="semibold" style={{ fontSize: 13 }}>Daily check-ins</Text>
              <View style={styles.checkRow}>
                {dailyLog.slice(-14).map((c) => (
                  <View
                    key={c.date}
                    style={[styles.check, c.status === "IMPROVED" ? styles.checkGood : c.status === "WORSE" ? styles.checkBad : null]}
                    accessible
                    accessibilityLabel={`${c.date}: pain ${c.painScore ?? "not recorded"}, ${c.status ? c.status.toLowerCase() : "no status"}`}
                  >
                    <Text weight="semibold" style={{ fontSize: 11, color: c.status === "IMPROVED" ? colors.success : c.status === "WORSE" ? colors.danger : colors.muted }}>{c.painScore ?? "–"}</Text>
                  </View>
                ))}
              </View>
              <Muted style={{ fontSize: 12 }}>
                {dailyStatus.improved} improved · {dailyStatus.same} same · {dailyStatus.worse} worse · pain score each day (last {Math.min(14, dailyLog.length)})
              </Muted>
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <Row gap={6}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
      <Muted style={{ fontSize: 12 }}>{text}</Muted>
    </Row>
  );
}

const styles = StyleSheet.create({
  pkg: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  pkgOn: { borderColor: colors.gold500, backgroundColor: colors.gold100 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 130 },
  barGroup: { flex: 1, alignItems: "center", gap: 4 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 106, width: "100%", justifyContent: "center" },
  checkRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  check: { minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.navy50 },
  checkGood: { backgroundColor: colors.successBg },
  checkBad: { backgroundColor: colors.dangerBg },
  bar: { width: "40%", borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 2 },
});
