import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { RequireRole, SectionTitle, SelectField, goBack, type Option } from "@/components/form";
import { Button, Card, ErrorBox, Field, Input, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { colors, space } from "@/theme";

interface Settings {
  defaultSlotMinutes: number;
  openingTime: string;
  closingTime: string;
  gstPercent: string;
  consultationFee: string;
  therapySessionFee: string;
  homeVisitFee: string;
  travelChargePerKm: string;
  cancellationHours: number;
  reminderHoursBefore: number;
  invoicePrefix: string;
  branch: { name: string; gstin: string | null };
}
type Form = Record<"consultationFee" | "therapySessionFee" | "homeVisitFee" | "travelChargePerKm" | "gstPercent" | "defaultSlotMinutes" | "openingTime" | "closingTime" | "cancellationHours" | "reminderHoursBefore" | "invoicePrefix", string>;

const TIMES: Option[] = Array.from({ length: 24 * 4 }, (_, i) => {
  const m = i * 15;
  const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  return { value: v, label: `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` };
});
const SLOTS: Option[] = [10, 15, 20, 30, 45, 60, 90, 120].map((n) => ({ value: String(n), label: `${n} min` }));

const toForm = (s: Settings): Form => ({
  consultationFee: String(Number(s.consultationFee)),
  therapySessionFee: String(Number(s.therapySessionFee)),
  homeVisitFee: String(Number(s.homeVisitFee)),
  travelChargePerKm: String(Number(s.travelChargePerKm)),
  gstPercent: String(Number(s.gstPercent)),
  defaultSlotMinutes: String(s.defaultSlotMinutes),
  openingTime: s.openingTime,
  closingTime: s.closingTime,
  cancellationHours: String(s.cancellationHours),
  reminderHoursBefore: String(s.reminderHoursBefore),
  invoicePrefix: s.invoicePrefix,
});

export default function SettingsScreen() {
  return (
    <RequireRole roles={["SUPER_ADMIN"]} title="Settings">
      <SettingsForm />
    </RequireRole>
  );
}

function SettingsForm() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  // null = untouched → show the saved values
  const [draft, setDraft] = useState<Form | null>(null);
  const f: Form | null = draft ?? (q.data ? toForm(q.data) : null);
  const set = (k: keyof Form, v: string) => f && setDraft({ ...f, [k]: v });
  const num = (v: string) => v.replace(/[^\d.]/g, "");

  const save = useMutation({
    mutationFn: () =>
      api.patch<Settings>("/settings", {
        consultationFee: Number(f!.consultationFee),
        therapySessionFee: Number(f!.therapySessionFee),
        homeVisitFee: Number(f!.homeVisitFee),
        travelChargePerKm: Number(f!.travelChargePerKm),
        gstPercent: Number(f!.gstPercent),
        defaultSlotMinutes: Number(f!.defaultSlotMinutes),
        openingTime: f!.openingTime,
        closingTime: f!.closingTime,
        cancellationHours: Number(f!.cancellationHours),
        reminderHoursBefore: Number(f!.reminderHoursBefore),
        invoicePrefix: f!.invoicePrefix.trim(),
      }),
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const problem = !f
    ? null
    : Number(f.gstPercent) > 28
      ? "GST can't be more than 28%"
      : f.openingTime >= f.closingTime
        ? "Opening time must be before closing time"
        : Number(f.cancellationHours) > 72 || Number(f.reminderHoursBefore) < 1 || Number(f.reminderHoursBefore) > 72
          ? "Cancellation hours 0–72, reminder hours 1–72"
          : !f.invoicePrefix.trim() || f.invoicePrefix.trim().length > 10
            ? "Invoice prefix must be 1–10 characters"
            : null;

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => { setDraft(null); q.refetch(); }}>
      <TopBar title="Hospital settings" onBack={() => goBack("/more")} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : f && q.data ? (
        <>
          <Card>
            <Text weight="bold" style={{ fontSize: 16 }}>{q.data.branch.name}</Text>
            {q.data.branch.gstin ? <Muted>GSTIN {q.data.branch.gstin}</Muted> : null}
          </Card>

          <SectionTitle>Fees (₹)</SectionTitle>
          <Card style={{ gap: space.md }}>
            <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}><Field label="Consultation"><Input value={f.consultationFee} onChangeText={(t) => set("consultationFee", num(t))} keyboardType="decimal-pad" /></Field></View>
              <View style={{ flex: 1 }}><Field label="Therapy session"><Input value={f.therapySessionFee} onChangeText={(t) => set("therapySessionFee", num(t))} keyboardType="decimal-pad" /></Field></View>
            </Row>
            <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}><Field label="Home visit"><Input value={f.homeVisitFee} onChangeText={(t) => set("homeVisitFee", num(t))} keyboardType="decimal-pad" /></Field></View>
              <View style={{ flex: 1 }}><Field label="Travel per km"><Input value={f.travelChargePerKm} onChangeText={(t) => set("travelChargePerKm", num(t))} keyboardType="decimal-pad" /></Field></View>
            </Row>
            <Field label="GST %"><Input value={f.gstPercent} onChangeText={(t) => set("gstPercent", num(t))} keyboardType="decimal-pad" /></Field>
          </Card>

          <SectionTitle>Clinic hours & booking</SectionTitle>
          <Card style={{ gap: space.md }}>
            <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}><SelectField label="Opening" value={f.openingTime} options={TIMES} onChange={(v) => set("openingTime", v)} /></View>
              <View style={{ flex: 1 }}><SelectField label="Closing" value={f.closingTime} options={TIMES} onChange={(v) => set("closingTime", v)} /></View>
            </Row>
            <SelectField label="Default slot length" value={f.defaultSlotMinutes} options={SLOTS} onChange={(v) => set("defaultSlotMinutes", v)} />
            <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}><Field label="Cancel up to (hours before)"><Input value={f.cancellationHours} onChangeText={(t) => set("cancellationHours", t.replace(/\D/g, ""))} keyboardType="number-pad" /></Field></View>
              <View style={{ flex: 1 }}><Field label="Reminder (hours before)"><Input value={f.reminderHoursBefore} onChangeText={(t) => set("reminderHoursBefore", t.replace(/\D/g, ""))} keyboardType="number-pad" /></Field></View>
            </Row>
          </Card>

          <SectionTitle>Invoices</SectionTitle>
          <Card>
            <Field label="Invoice prefix"><Input value={f.invoicePrefix} onChangeText={(t) => set("invoicePrefix", t.toUpperCase())} autoCapitalize="characters" maxLength={10} /></Field>
          </Card>

          <ErrorBox error={save.error} />
          {problem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
          {save.isSuccess && !draft ? <Text style={{ color: colors.success, fontSize: 13 }}>✓ Settings saved</Text> : null}
          <Row>
            {draft ? <Button title="Discard" variant="ghost" onPress={() => setDraft(null)} style={{ flex: 1 }} /> : null}
            <Button title="Save settings" icon="save-outline" onPress={() => save.mutate()} disabled={!draft || !!problem} loading={save.isPending} style={{ flex: 1 }} />
          </Row>
          {!draft ? <Muted style={{ fontSize: 12, textAlign: "center" }}>Change any value to enable Save.</Muted> : null}
        </>
      ) : null}
    </Screen>
  );
}
