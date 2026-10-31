/** Patient-profile building blocks: medical-history and sell-package sheets, pain-progress card. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { DateField, Sheet, StatTile } from "@/components/form";
import { Button, Card, ErrorBox, Field, H2, Input, Loading, Muted, ProgressBar, Row, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { inr, today } from "@/lib/format";
import { colors, radius, space } from "@/theme";

/* ───────────── Medical history ───────────── */

export function MedicalHistorySheet({ patientId, open, onClose }: { patientId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ condition: "", details: "", diagnosedOn: "", medications: "", surgeries: "", allergies: "" });
  const [ongoing, setOngoing] = useState(true);
  const set = (k: keyof typeof f) => (t: string) => setF((x) => ({ ...x, [k]: t }));

  const save = useMutation({
    mutationFn: () =>
      api.post(`/patients/${patientId}/medical-history`, {
        condition: f.condition.trim(),
        details: f.details.trim() || undefined,
        diagnosedOn: f.diagnosedOn || undefined,
        medications: f.medications.trim() || undefined,
        surgeries: f.surgeries.trim() || undefined,
        allergies: f.allergies.trim() || undefined,
        isOngoing: ongoing,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patientId] });
      setF({ condition: "", details: "", diagnosedOn: "", medications: "", surgeries: "", allergies: "" });
      setOngoing(true);
      onClose();
    },
  });

  const ok = f.condition.trim().length >= 2;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add medical history"
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
  const qc = useQueryClient();
  const pkgs = useQuery({ queryKey: ["packages"], queryFn: () => api.get<PackageDef[]>("/packages"), enabled: open });
  const [packageId, setPackageId] = useState("");
  const [discount, setDiscount] = useState("");
  const [reason, setReason] = useState("");
  const chosen = pkgs.data?.find((p) => p.id === packageId);
  const discountNum = discount ? Number(discount) : 0;

  const sell = useMutation({
    mutationFn: () =>
      api.post<{ invoice: { id: string } }>("/patient-packages", {
        patientId,
        packageId,
        discountAmount: discountNum,
        discountReason: reason.trim() || undefined,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["patient", patientId] });
      qc.invalidateQueries({ queryKey: ["patient-packages"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      onClose();
      setPackageId("");
      setDiscount("");
      setReason("");
      router.push({ pathname: "/invoice/[id]", params: { id: r.invoice.id } });
    },
  });

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
}

export function PainProgressCard({ patientId }: { patientId: string }) {
  const q = useQuery({ queryKey: ["progress", patientId], queryFn: () => api.get<Progress>(`/patients/${patientId}/progress`) });
  const p = q.data;
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
  bar: { width: "40%", borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 2 },
});
