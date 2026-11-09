import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { goBack, RequireRole, SectionTitle, SelectField, Sheet, type Option } from "@/components/form";
import { Badge, Button, Card, Divider, ErrorBox, Field, Input, KeyValue, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { fullName, inr, label } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useAction } from "@/lib/refresh";
import { useAuth } from "@/lib/auth";
import { useActivePlans, useTherapists, useTreatmentPrices } from "@/lib/queries";
import type { InvoiceDetail } from "@/lib/types";
import { colors, radius, space } from "@/theme";

type ItemType = "CONSULTATION" | "THERAPY_SESSION" | "PACKAGE" | "HOME_VISIT" | "TRAVEL_CHARGE" | "OTHER";
interface Line {
  key: number;
  type: ItemType;
  description: string;
  quantity: string;
  unitPrice: string;
  /** Carried through unchanged when editing a bill: a per-line discount and the visit / package the line belongs to. */
  discount: number;
  appointmentId?: string;
  patientPackageId?: string;
}
interface PatientRow {
  id: string;
  patientCode: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  primaryTherapist?: { id: string; user: { name: string } } | null;
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
const newLine = (type: ItemType = "CONSULTATION"): Line => ({ key: lineSeq++, type, description: defaultsFor(type).label, quantity: "1", unitPrice: String(defaultsFor(type).price), discount: 0 });
const lineFrom = (i: InvoiceDetail["items"][number]): Line => ({
  key: lineSeq++,
  type: i.type as ItemType,
  description: i.description,
  quantity: String(i.quantity),
  unitPrice: String(Number(i.unitPrice)),
  discount: Number(i.discount),
  appointmentId: i.appointmentId ?? undefined,
  patientPackageId: i.patientPackageId ?? undefined,
});

/**
 * New invoice: patient → line items → discount → live GST preview → save draft or issue.
 * With `?edit=<invoice id>` the same form opens a DRAFT bill (for example the one drafted automatically
 * when a visit was booked), so staff can change the lines, discount and notes before issuing it.
 */
export default function NewInvoice() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  return (
    <RequireRole roles={["ACCOUNTANT", "RECEPTIONIST", "ADMIN"]} title={edit ? "Edit bill" : "New invoice"}>
      {edit ? <EditDraft id={edit} /> : <NewInvoiceForm />}
    </RequireRole>
  );
}

/** Loads the draft, then shows the form filled in. Bills that are already issued can't be edited. */
function EditDraft({ id }: { id: string }) {
  const q = useQuery({ queryKey: qk.invoice(id), queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`) });
  const back = () => goBack({ pathname: "/invoice/[id]", params: { id } });
  if (q.data && q.data.status === "DRAFT") return <NewInvoiceForm initial={q.data} />;
  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title="Edit bill" onBack={back} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <>
          <Muted>Only draft bills can be edited. {q.data.invoiceNo} is {label(q.data.status).toLowerCase()}.</Muted>
          <Button title="Open bill" onPress={back} />
        </>
      ) : null}
    </Screen>
  );
}

function NewInvoiceForm({ initial }: { initial?: InvoiceDetail }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  // Editing a draft starts from what is saved; a new invoice starts empty.
  const [patient, setPatient] = useState<PatientRow | null>(() => (initial ? { ...initial.patient } : null));
  const [lines, setLines] = useState<Line[]>(() => (initial ? initial.items.map(lineFrom) : [newLine()]));
  const [discount, setDiscount] = useState(() => (initial && Number(initial.discountAmount) > 0 ? String(Number(initial.discountAmount)) : ""));
  const [discountReason, setDiscountReason] = useState(() => (initial ? initial.discountReason ?? "" : ""));
  const [notes, setNotes] = useState(() => (initial ? initial.notes ?? "" : ""));
  // Whose bill this is. A physio always bills for themselves; the Super Admin can choose
  // ("" = automatic: the physio of the billed visit, else the patient's regular physio).
  const isPhysio = useAuth((s) => s.user?.role === "PHYSIOTHERAPIST");
  const [billFor, setBillFor] = useState(() => (initial ? initial.therapistId ?? "" : ""));
  const editId = initial ? initial.id : "";
  const interState = !!initial && Number(initial.igstAmount) > 0; // keep IGST vs CGST + SGST as it was
  const therapists = useTherapists({ enabled: !isPhysio });

  // Billing by treatment: the clinic's price list, and the priced treatments in this patient's active plan.
  const prices = useTreatmentPrices();
  const plans = useActivePlans(patient ? patient.id : undefined);
  const [picking, setPicking] = useState(false);
  const priceList = prices.data ? prices.data.filter((p) => p.isActive) : [];
  const priceOf = new Map(priceList.map((p) => [p.category, Number(p.price)]));
  const planTreatments = Array.from(new Set((plans.data ?? []).flatMap((pl) => pl.items.map((i) => i.category)))).filter((c) => priceOf.has(c));
  const planTotal = planTreatments.reduce((n, c) => n + (priceOf.get(c) ?? 0), 0);

  const patients = useQuery({
    queryKey: qk.patients.list("invoice", { search: debounced }),
    queryFn: () => api.page<PatientRow>("/patients", { search: debounced || undefined, limit: 8 }),
    enabled: !patient,
  });

  const items = lines.map((l) => ({
    type: l.type,
    description: l.description.trim(),
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    ...(l.discount ? { discount: l.discount } : {}),
    ...(l.appointmentId ? { appointmentId: l.appointmentId } : {}),
    ...(l.patientPackageId ? { patientPackageId: l.patientPackageId } : {}),
  }));
  const linesOk = items.length > 0 && items.every((i) => i.description.length >= 2 && Number.isInteger(i.quantity) && i.quantity >= 1 && Number.isFinite(i.unitPrice) && i.unitPrice >= 0);
  const discountAmount = discount ? Number(discount) : 0;
  const discountOk = Number.isFinite(discountAmount) && discountAmount >= 0;
  const body = {
    patientId: patient?.id,
    items,
    discountAmount,
    discountReason: discountReason.trim() || undefined,
    notes: notes.trim() || undefined,
    ...(interState ? { interState: true } : {}),
  };

  const preview = useQuery({
    queryKey: qk.invoicePreview(body),
    queryFn: () => api.post<Preview>("/invoices/preview", body),
    enabled: !!patient && linesOk && discountOk,
  });

  const save = useAction(
    async (issue: boolean) => {
      if (editId) {
        // Same invoice, same number: the lines and totals are replaced. Empty text clears a reason or note.
        const edited = await api.patch<{ id: string }>(`/invoices/${editId}`, {
          items,
          discountAmount,
          discountReason: discountReason.trim(),
          notes: notes.trim(),
          interState,
          therapistId: isPhysio ? undefined : billFor || undefined,
        });
        if (issue) await api.post(`/invoices/${editId}/issue`);
        return edited;
      }
      return api.post<{ id: string }>("/invoices", { ...body, issue, therapistId: isPhysio ? undefined : billFor || undefined });
    },
    {
      refresh: ["billing"],
      // An edit goes back to the bill it came from; a new invoice opens its own screen.
      onSuccess: (inv) => (editId ? goBack({ pathname: "/invoice/[id]", params: { id: editId } }) : router.replace({ pathname: "/invoice/[id]", params: { id: inv.id } })),
    },
  );

  const treatmentLine = (category: string): Line => ({ key: lineSeq++, type: "THERAPY_SESSION", description: category, quantity: "1", unitPrice: String(priceOf.get(category) ?? 0), discount: 0 });
  // The untouched starter line is replaced rather than left behind as a stray "Consultation" (only on a brand-new invoice).
  const withoutStarter = (ls: Line[]) => (!editId && ls.length === 1 && ls[0].type === "CONSULTATION" && ls[0].description === "Consultation" && ls[0].unitPrice === "500" ? [] : ls);
  const addPlanTreatments = () =>
    setLines((ls) => {
      const have = new Set(ls.map((l) => l.description));
      const fresh = planTreatments.filter((c) => !have.has(c)).map(treatmentLine);
      return fresh.length ? [...withoutStarter(ls), ...fresh] : ls;
    });
  const addTreatment = (category: string) =>
    setLines((ls) => {
      const same = ls.find((l) => l.type === "THERAPY_SESSION" && l.description === category);
      if (same) return ls.map((l) => (l.key === same.key ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      return [...withoutStarter(ls), treatmentLine(category)];
    });
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const missing = !patient ? "Choose the patient" : !linesOk ? "Each line needs a description, quantity of 1+ and a price" : !discountOk ? "Discount must be 0 or more" : null;

  return (
    <Screen
      edges={["top", "bottom"]}
      footer={
        <Row gap={space.sm}>
          <View style={{ flex: 0.9 }}>
            <Muted style={{ fontSize: 11 }}>Total</Muted>
            <Text weight="bold" style={{ fontSize: 18, color: colors.navy800 }} numberOfLines={1} adjustsFontSizeToFit>
              {preview.data && patient && linesOk && discountOk ? inr(preview.data.totalAmount) : "—"}
            </Text>
          </View>
          <Button title={editId ? "Save changes" : "Save draft"} variant="ghost" onPress={() => save.mutate(false)} disabled={!!missing || save.isPending} style={{ flex: 1 }} />
          <Button title="Issue invoice" icon="checkmark-circle-outline" onPress={() => save.mutate(true)} disabled={!!missing} loading={save.isPending} style={{ flex: 1.2 }} />
        </Row>
      }
    >
      <TopBar title={editId ? "Edit bill" : "New invoice"} onBack={() => goBack(editId ? { pathname: "/invoice/[id]", params: { id: editId } } : "/billing")} />

      <Card>
        <SectionTitle>1. Patient</SectionTitle>
        {patient ? (
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text weight="semibold">{fullName(patient)}</Text>
              <Muted style={{ fontSize: 12 }}>{patient.patientCode} · {patient.phone}</Muted>
            </View>
            {editId ? null : <Button title="Change" variant="ghost" small onPress={() => setPatient(null)} />}
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
        {patient ? (
          isPhysio ? (
            <Muted style={{ fontSize: 12 }}>{editId ? "Stays with the physio this bill belongs to." : "Billed to you: the payment counts in your collections."}</Muted>
          ) : (
            <SelectField
              label="Bill for physiotherapist"
              value={billFor}
              onChange={setBillFor}
              options={[
                { value: "", label: patient.primaryTherapist ? `Automatic (${patient.primaryTherapist.user.name})` : "Automatic", hint: "Physio of the billed visit, else the regular physio" },
                ...(therapists.data ?? []).map((t) => ({ value: t.id, label: t.user.name })),
              ]}
            />
          )
        ) : null}
      </Card>

      <Card>
        <SectionTitle>2. Items</SectionTitle>
        {editId && lines.some((l) => !!l.appointmentId) ? <Muted style={{ fontSize: 12 }}>Drafted automatically when the visit was booked. Change anything that is different, then issue it.</Muted> : null}
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
        {planTreatments.length > 0 ? (
          <Button title={`Add plan treatments · ${inr(planTotal)}`} variant="gold" small icon="medkit-outline" onPress={addPlanTreatments} style={{ alignSelf: "flex-start" }} />
        ) : null}
        <Row gap={space.sm} style={{ flexWrap: "wrap" }}>
          <Button title="Add treatment" variant="ghost" small icon="add" onPress={() => setPicking(true)} />
          <Button title="Add line" variant="ghost" small icon="add" onPress={() => setLines((ls) => [...ls, newLine("THERAPY_SESSION")])} />
        </Row>
      </Card>

      <Sheet open={picking} onClose={() => setPicking(false)} title="Add a treatment">
        {priceList.length === 0 ? (
          <Muted>No treatment prices are set up yet. A Super Admin can add them in Settings.</Muted>
        ) : (
          priceList.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => {
                addTreatment(p.category);
                setPicking(false);
              }}
              accessibilityRole="button"
              style={styles.pick}
            >
              <Text weight="semibold" style={{ flex: 1 }}>{p.category}</Text>
              {planTreatments.includes(p.category) ? <Badge status="ACTIVE" text="In plan" /> : null}
              <Text weight="bold">{inr(p.price)}</Text>
            </Pressable>
          ))
        )}
        <Muted style={{ fontSize: 12 }}>Adds a line at this price. You can change the price on the invoice.</Muted>
      </Sheet>

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
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pick: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  line: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
});
