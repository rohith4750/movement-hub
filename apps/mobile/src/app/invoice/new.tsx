import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { goBack, RequireRole, SectionTitle, SelectField, type Option } from "@/components/form";
import { Button, Card, Divider, ErrorBox, Field, Input, KeyValue, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { fullName, inr } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useAction } from "@/lib/refresh";
import { colors, radius, space } from "@/theme";

type ItemType = "CONSULTATION" | "THERAPY_SESSION" | "PACKAGE" | "HOME_VISIT" | "TRAVEL_CHARGE" | "OTHER";
interface Line {
  key: number;
  type: ItemType;
  description: string;
  quantity: string;
  unitPrice: string;
}
interface PatientRow {
  id: string;
  patientCode: string;
  firstName: string;
  lastName: string | null;
  phone: string;
}
interface Preview {
  subtotal: string;
  taxableAmount: string;
  gstPercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalAmount: string;
}

const TYPES: (Option<ItemType> & { price: number })[] = [
  { value: "CONSULTATION", label: "Consultation", price: 500 },
  { value: "THERAPY_SESSION", label: "Therapy session", price: 800 },
  { value: "HOME_VISIT", label: "Home visit", price: 1200 },
  { value: "TRAVEL_CHARGE", label: "Travel charge", price: 0 },
  { value: "PACKAGE", label: "Package", price: 0 },
  { value: "OTHER", label: "Other", price: 0 },
];
const defaultsFor = (t: ItemType) => TYPES.find((x) => x.value === t)!;
const DEFAULT_DESCRIPTIONS = new Set(TYPES.map((t) => t.label));

let lineSeq = 1;
const newLine = (type: ItemType = "CONSULTATION"): Line => ({ key: lineSeq++, type, description: defaultsFor(type).label, quantity: "1", unitPrice: String(defaultsFor(type).price) });

/** New invoice: patient → line items → discount → live GST preview → save draft or issue. */
export default function NewInvoice() {
  return (
    <RequireRole roles={["ACCOUNTANT", "RECEPTIONIST", "ADMIN"]} title="New invoice">
      <NewInvoiceForm />
    </RequireRole>
  );
}

function NewInvoiceForm() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [notes, setNotes] = useState("");

  const patients = useQuery({
    queryKey: qk.patients.list("invoice", { search: debounced }),
    queryFn: () => api.page<PatientRow>("/patients", { search: debounced || undefined, limit: 8 }),
    enabled: !patient,
  });

  const items = lines.map((l) => ({ type: l.type, description: l.description.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }));
  const linesOk = items.length > 0 && items.every((i) => i.description.length >= 2 && Number.isInteger(i.quantity) && i.quantity >= 1 && Number.isFinite(i.unitPrice) && i.unitPrice >= 0);
  const discountAmount = discount ? Number(discount) : 0;
  const discountOk = Number.isFinite(discountAmount) && discountAmount >= 0;
  const body = { patientId: patient?.id, items, discountAmount, discountReason: discountReason.trim() || undefined, notes: notes.trim() || undefined };

  const preview = useQuery({
    queryKey: qk.invoicePreview(body),
    queryFn: () => api.post<Preview>("/invoices/preview", body),
    enabled: !!patient && linesOk && discountOk,
  });

  const save = useAction((issue: boolean) => api.post<{ id: string }>("/invoices", { ...body, issue }), {
    refresh: ["billing"],
    onSuccess: (inv) => router.replace({ pathname: "/invoice/[id]", params: { id: inv.id } }),
  });

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const missing = !patient ? "Choose the patient" : !linesOk ? "Each line needs a description, quantity of 1+ and a price" : !discountOk ? "Discount must be 0 or more" : null;

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title="New invoice" onBack={() => goBack("/billing")} />

      <Card>
        <SectionTitle>1. Patient</SectionTitle>
        {patient ? (
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text weight="semibold">{fullName(patient)}</Text>
              <Muted style={{ fontSize: 12 }}>{patient.patientCode} · {patient.phone}</Muted>
            </View>
            <Button title="Change" variant="ghost" small onPress={() => setPatient(null)} />
          </Row>
        ) : (
          <>
            <Input value={search} onChangeText={setSearch} placeholder="Search name, phone or MH-P code" autoCorrect={false} />
            {patients.isLoading ? (
              <Loading />
            ) : patients.error ? (
              <ErrorBox error={patients.error} onRetry={() => patients.refetch()} />
            ) : (
              (patients.data?.data ?? []).map((p) => (
                <Pressable key={p.id} onPress={() => setPatient(p)} accessibilityRole="button" style={styles.pick}>
                  <Text weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{fullName(p)}</Text>
                  <Muted style={{ fontSize: 12 }}>{p.patientCode}</Muted>
                </Pressable>
              ))
            )}
            {patients.data?.data.length === 0 ? <Muted style={{ fontSize: 12 }}>No patients match.</Muted> : null}
          </>
        )}
      </Card>

      <Card>
        <SectionTitle>2. Items</SectionTitle>
        {lines.map((l, idx) => (
          <View key={l.key} style={styles.line}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text weight="semibold" style={{ fontSize: 13, color: colors.navy500 }}>Line {idx + 1}</Text>
              {lines.length > 1 ? (
                <Pressable onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} hitSlop={8} accessibilityLabel={`Remove line ${idx + 1}`}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              ) : null}
            </Row>
            <SelectField<ItemType>
              label="Type"
              value={l.type}
              options={TYPES}
              onChange={(t) => {
                const d = defaultsFor(t);
                // Only replace the description/price if the user hasn't typed their own.
                update(l.key, {
                  type: t,
                  description: DEFAULT_DESCRIPTIONS.has(l.description) || !l.description ? d.label : l.description,
                  unitPrice: l.unitPrice === String(defaultsFor(l.type).price) || !l.unitPrice ? String(d.price) : l.unitPrice,
                });
              }}
            />
            <Field label="Description">
              <Input value={l.description} onChangeText={(t) => update(l.key, { description: t })} />
            </Field>
            <Row gap={space.sm}>
              <View style={{ width: 90 }}>
                <Field label="Qty">
                  <Input value={l.quantity} onChangeText={(t) => update(l.key, { quantity: t.replace(/\D/g, "") })} keyboardType="number-pad" />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Unit price (₹)">
                  <Input value={l.unitPrice} onChangeText={(t) => update(l.key, { unitPrice: t.replace(/[^\d.]/g, "") })} keyboardType="decimal-pad" />
                </Field>
              </View>
            </Row>
            <Muted style={{ fontSize: 12, textAlign: "right" }}>Line total {inr((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}</Muted>
          </View>
        ))}
        <Button title="Add line" variant="ghost" small icon="add" onPress={() => setLines((ls) => [...ls, newLine("THERAPY_SESSION")])} style={{ alignSelf: "flex-start" }} />
      </Card>

      <Card>
        <SectionTitle>3. Discount & notes</SectionTitle>
        <Row gap={space.sm}>
          <View style={{ width: 130 }}>
            <Field label="Discount (₹)">
              <Input value={discount} onChangeText={(t) => setDiscount(t.replace(/[^\d.]/g, ""))} keyboardType="decimal-pad" placeholder="0" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Reason">
              <Input value={discountReason} onChangeText={setDiscountReason} placeholder="e.g. First visit offer" />
            </Field>
          </View>
        </Row>
        <Field label="Notes (optional)">
          <Input value={notes} onChangeText={setNotes} multiline maxLength={500} />
        </Field>
      </Card>

      <Card gold>
        <SectionTitle>Total</SectionTitle>
        {!patient || !linesOk || !discountOk ? (
          <Muted>The GST total appears once the patient and items are filled in.</Muted>
        ) : preview.isLoading ? (
          <Loading />
        ) : preview.error ? (
          <ErrorBox error={preview.error} onRetry={() => preview.refetch()} />
        ) : preview.data ? (
          <>
            <KeyValue k="Subtotal" v={inr(preview.data.subtotal)} />
            {discountAmount > 0 ? <KeyValue k="Discount" v={`-${inr(discountAmount)}`} /> : null}
            <KeyValue k="Taxable" v={inr(preview.data.taxableAmount)} />
            {Number(preview.data.igstAmount) > 0 ? (
              <KeyValue k={`IGST ${preview.data.gstPercent}%`} v={inr(preview.data.igstAmount)} />
            ) : (
              <>
                <KeyValue k={`CGST ${Number(preview.data.gstPercent) / 2}%`} v={inr(preview.data.cgstAmount)} />
                <KeyValue k={`SGST ${Number(preview.data.gstPercent) / 2}%`} v={inr(preview.data.sgstAmount)} />
              </>
            )}
            <Divider />
            <KeyValue k="Total" v={inr(preview.data.totalAmount)} vStyle={{ fontSize: 20, color: colors.navy700 }} />
          </>
        ) : null}
        <ErrorBox error={save.error} />
        {missing ? <Muted style={{ fontSize: 12, color: colors.warning }}>{missing}</Muted> : null}
        <Row>
          <Button title="Save draft" variant="ghost" onPress={() => save.mutate(false)} disabled={!!missing || save.isPending} style={{ flex: 1 }} />
          <Button title="Issue invoice" icon="checkmark-circle-outline" onPress={() => save.mutate(true)} disabled={!!missing} loading={save.isPending} style={{ flex: 1 }} />
        </Row>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pick: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  line: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy50, backgroundColor: colors.bg },
});
