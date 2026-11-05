import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { RequireRole, SectionTitle, SelectField, goBack, type Option } from "@/components/form";
import { Button, Card, ErrorBox, Field, Input, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useTreatmentPrices } from "@/lib/queries";
import { qk } from "@/lib/query-keys";
import { useAction } from "@/lib/refresh";
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
  branchId: string;
  branch: Clinic;
}
/** The clinic's details printed on every invoice and receipt. */
interface Clinic {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
}
type ClinicForm = Record<"name" | "address" | "city" | "state" | "pincode" | "phone" | "email" | "gstin", string>;
const toClinicForm = (b: Clinic): ClinicForm => ({ name: b.name, address: b.address, city: b.city, state: b.state, pincode: b.pincode, phone: b.phone ?? "", email: b.email ?? "", gstin: b.gstin ?? "" });
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
  const q = useQuery({ queryKey: qk.settings(), queryFn: () => api.get<Settings>("/settings") });
  // null = untouched → show the saved values
  const [draft, setDraft] = useState<Form | null>(null);
  const f: Form | null = draft ?? (q.data ? toForm(q.data) : null);
  const set = (k: keyof Form, v: string) => f && setDraft({ ...f, [k]: v });
  const num = (v: string) => v.replace(/[^\d.]/g, "");

  // The form is passed in when saving (not read from `f` here): the React Compiler would turn
  // `f!.x` in this callback into a change-check that crashes while settings are still loading.
  const save = useAction(
    (form: Form) =>
      api.patch<Settings>("/settings", {
        consultationFee: Number(form.consultationFee),
        therapySessionFee: Number(form.therapySessionFee),
        homeVisitFee: Number(form.homeVisitFee),
        travelChargePerKm: Number(form.travelChargePerKm),
        gstPercent: Number(form.gstPercent),
        defaultSlotMinutes: Number(form.defaultSlotMinutes),
        openingTime: form.openingTime,
        closingTime: form.closingTime,
        cancellationHours: Number(form.cancellationHours),
        reminderHoursBefore: Number(form.reminderHoursBefore),
        invoicePrefix: form.invoicePrefix.trim(),
      }),
    { refresh: ["settings"], onSuccess: () => setDraft(null) },
  );

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
          <ClinicDetails clinic={q.data.branch} />

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

          <TreatmentPrices />

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
            <Button title="Save settings" icon="save-outline" onPress={() => f && save.mutate(f)} disabled={!draft || !!problem} loading={save.isPending} style={{ flex: 1 }} />
          </Row>
          {!draft ? <Muted style={{ fontSize: 12, textAlign: "center" }}>Change any value to enable Save.</Muted> : null}
        </>
      ) : null}
    </Screen>
  );
}

/**
 * Price per treatment, used when billing: pick a treatment on an invoice and its price is filled in.
 * Saves on its own (separate from the settings form above).
 */
function TreatmentPrices() {
  const q = useTreatmentPrices();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const rows = q.data ? q.data : [];
  const changed = rows.filter((r) => edits[r.category] !== undefined && Number(edits[r.category]) !== Number(r.price));
  const adding = newName.trim().length >= 2 && newPrice !== "";
  const invalid = changed.some((r) => !Number.isFinite(Number(edits[r.category])) || edits[r.category] === "") || (newName.trim() !== "" && !adding);

  const save = useAction(
    () =>
      api.put("/settings/treatment-prices", {
        prices: [
          ...changed.map((r) => ({ category: r.category, price: Number(edits[r.category]) })),
          ...(adding ? [{ category: newName.trim(), price: Number(newPrice) }] : []),
        ],
      }),
    {
      refresh: ["settings"],
      onSuccess: () => {
        setEdits({});
        setNewName("");
        setNewPrice("");
      },
    },
  );
  const dirty = changed.length > 0 || adding;

  return (
    <>
      <SectionTitle>Treatment prices (₹ each)</SectionTitle>
      <Card style={{ gap: space.md }}>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} onRetry={() => q.refetch()} />
        ) : (
          rows.map((r) => (
            <Row key={r.id} gap={space.sm}>
              <Text style={{ flex: 1 }} numberOfLines={1}>{r.category}</Text>
              <View style={{ width: 120 }}>
                <Input
                  value={edits[r.category] !== undefined ? edits[r.category] : String(Number(r.price))}
                  onChangeText={(t) => setEdits((e) => ({ ...e, [r.category]: t.replace(/[^\d.]/g, "") }))}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Price for ${r.category}`}
                />
              </View>
            </Row>
          ))
        )}
        <Muted style={{ fontSize: 12 }}>Add another treatment:</Muted>
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}><Input value={newName} onChangeText={setNewName} placeholder="Treatment name" /></View>
          <View style={{ width: 120 }}><Input value={newPrice} onChangeText={(t) => setNewPrice(t.replace(/[^\d.]/g, ""))} placeholder="Price" keyboardType="decimal-pad" /></View>
        </Row>
        <ErrorBox error={save.error} />
        {invalid ? <Muted style={{ fontSize: 12, color: colors.warning }}>Enter a price for every treatment you change or add.</Muted> : null}
        {save.isSuccess && !dirty ? <Text style={{ color: colors.success, fontSize: 13 }}>✓ Prices saved</Text> : null}
        <Button title="Save prices" icon="save-outline" onPress={() => save.mutate()} disabled={!dirty || invalid} loading={save.isPending} />
      </Card>
    </>
  );
}

/** Name, address, phone, email and GSTIN shown in the header of every invoice and receipt. */
function ClinicDetails({ clinic }: { clinic: Clinic }) {
  const [draft, setDraft] = useState<ClinicForm | null>(null);
  const f = draft ?? toClinicForm(clinic);
  const set = (k: keyof ClinicForm, v: string) => setDraft({ ...f, [k]: v });
  // The form and branch id are passed in (not read from props here) — see the note on `save` above.
  const save = useAction(
    (v: { id: string; form: ClinicForm }) =>
      api.patch(`/branches/${v.id}`, {
        name: v.form.name.trim(),
        address: v.form.address.trim(),
        city: v.form.city.trim(),
        state: v.form.state.trim(),
        pincode: v.form.pincode.trim(),
        phone: v.form.phone.trim() || undefined,
        email: v.form.email.trim() || undefined,
        gstin: v.form.gstin.trim().toUpperCase() || undefined,
      }),
    { refresh: ["settings"], onSuccess: () => setDraft(null) },
  );
  const problem =
    f.name.trim().length < 2
      ? "Enter the clinic name"
      : !f.address.trim() || !f.city.trim() || !f.state.trim()
        ? "Enter the address, city and state"
        : !/^\d{6}$/.test(f.pincode.trim())
          ? "Pincode must be 6 digits"
          : f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())
            ? "Enter a valid email"
            : f.gstin.trim() && !/^[0-9A-Z]{15}$/i.test(f.gstin.trim())
              ? "GSTIN is 15 letters/digits"
              : null;

  return (
    <>
      <SectionTitle>Clinic details on bills</SectionTitle>
      <Card style={{ gap: space.md }}>
        <Muted style={{ fontSize: 12 }}>Printed with the Movement Hub logo at the top of every invoice and receipt.</Muted>
        <Field label="Clinic name"><Input value={f.name} onChangeText={(t) => set("name", t)} /></Field>
        <Field label="Address"><Input value={f.address} onChangeText={(t) => set("address", t)} placeholder="e.g. Plot 12, Road No. 3, Manikonda" multiline /></Field>
        <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}><Field label="City"><Input value={f.city} onChangeText={(t) => set("city", t)} /></Field></View>
          <View style={{ flex: 1 }}><Field label="State"><Input value={f.state} onChangeText={(t) => set("state", t)} /></Field></View>
        </Row>
        <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}><Field label="Pincode"><Input value={f.pincode} onChangeText={(t) => set("pincode", t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" /></Field></View>
          <View style={{ flex: 1 }}><Field label="Phone"><Input value={f.phone} onChangeText={(t) => set("phone", t)} keyboardType="phone-pad" /></Field></View>
        </Row>
        <Field label="Email"><Input value={f.email} onChangeText={(t) => set("email", t)} keyboardType="email-address" autoCapitalize="none" /></Field>
        <Field label="GSTIN (optional)"><Input value={f.gstin} onChangeText={(t) => set("gstin", t.toUpperCase())} autoCapitalize="characters" maxLength={15} /></Field>
        <ErrorBox error={save.error} />
        {problem && draft ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
        {save.isSuccess && !draft ? <Text style={{ color: colors.success, fontSize: 13 }}>✓ Clinic details saved</Text> : null}
        {draft ? (
          <Row>
            <Button title="Discard" variant="ghost" onPress={() => setDraft(null)} style={{ flex: 1 }} />
            <Button title="Save clinic details" icon="save-outline" onPress={() => save.mutate({ id: clinic.id, form: f })} disabled={!!problem} loading={save.isPending} style={{ flex: 1 }} />
          </Row>
        ) : null}
      </Card>
    </>
  );
}
