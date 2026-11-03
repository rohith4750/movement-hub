import { router } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";
import { DobAgeFields, goBack, RegularPhysioField, RequireRole, SectionTitle, useOwnTherapistId } from "@/components/form";
import { Button, Card, Chips, ErrorBox, Field, Input, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction } from "@/lib/refresh";
import { colors, space } from "@/theme";

type Gender = "MALE" | "FEMALE" | "OTHER";
type PatientType = "REGULAR" | "WALK_IN";

const EMPTY = {
  firstName: "",
  patientType: "REGULAR" as PatientType,
  lastName: "",
  phone: "",
  dateOfBirth: "",
  email: "",
  referredBy: "",
  line1: "",
  city: "",
  state: "",
  pincode: "",
};

/** Same rules as the API patient schema, for instant feedback. */
function problemOf(f: typeof EMPTY): string | null {
  if (!f.firstName.trim()) return "Enter the first name";
  if (f.phone.replace(/\D/g, "").length < 10) return "Enter a valid mobile number";
  if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) return "Email looks invalid";
  if (f.line1.trim()) {
    if (!f.city.trim() || !f.state.trim()) return "Address needs city and state";
    if (!/^\d{6}$/.test(f.pincode.trim())) return "Pincode must be 6 digits";
  }
  return null;
}

export default function NewPatient() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST"]} title="Register patient">
      <NewPatientForm />
    </RequireRole>
  );
}

function NewPatientForm() {
  const [f, setF] = useState(EMPTY);
  const [gender, setGender] = useState<Gender>("FEMALE");
  const [consent, setConsent] = useState(true);
  const ownTherapist = useOwnTherapistId();
  const [physio, setPhysio] = useState<string | null>(null);
  const primaryTherapistId = physio ?? ownTherapist;
  const set = (k: keyof typeof EMPTY) => (t: string) => setF((x) => ({ ...x, [k]: t }));

  const save = useAction(
    () =>
      api.post<{ id: string }>("/patients", {
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim() || undefined,
        gender,
        patientType: f.patientType,
        dateOfBirth: f.dateOfBirth || undefined,
        phone: f.phone.trim(),
        email: f.email.trim() || undefined,
        referredBy: f.referredBy.trim() || undefined,
        primaryTherapistId: primaryTherapistId || null,
        consentGiven: consent,
        address: f.line1.trim() ? { line1: f.line1.trim(), city: f.city.trim(), state: f.state.trim(), pincode: f.pincode.trim() } : undefined,
      }),
    { refresh: ["patients"], onSuccess: (p) => router.replace({ pathname: "/patient/[id]", params: { id: p.id } }) },
  );

  const problem = problemOf(f);

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title="Register patient" onBack={() => goBack("/patients")} />

      <Card style={{ gap: space.md }}>
        <SectionTitle>Personal details</SectionTitle>
        <Field label="First name *"><Input value={f.firstName} onChangeText={set("firstName")} autoCapitalize="words" autoComplete="given-name" /></Field>
        <Field label="Last name"><Input value={f.lastName} onChangeText={set("lastName")} autoCapitalize="words" autoComplete="family-name" /></Field>
        <Field label="Mobile number *"><Input value={f.phone} onChangeText={set("phone")} keyboardType="phone-pad" placeholder="98765 43210" maxLength={18} /></Field>
        <Field label="Patient type *">
          <Chips<PatientType> value={f.patientType} onChange={(t) => setF((x) => ({ ...x, patientType: t }))} options={[{ value: "REGULAR", label: "Regular" }, { value: "WALK_IN", label: "Walk-in" }]} />
        </Field>
        <Field label="Patient type *">
          <Chips<PatientType> value={f.patientType} onChange={(t) => setF((x) => ({ ...x, patientType: t }))} options={[{ value: "REGULAR", label: "Regular" }, { value: "WALK_IN", label: "Walk-in" }]} />
        </Field>
        <Field label="Gender *">
          <Chips<Gender> value={gender} onChange={setGender} options={[{ value: "FEMALE", label: "Female" }, { value: "MALE", label: "Male" }, { value: "OTHER", label: "Other" }]} />
        </Field>
        <DobAgeFields dob={f.dateOfBirth} onDob={set("dateOfBirth")} clearable />
        <Field label="Email"><Input value={f.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" /></Field>
        <Field label="Referred by"><Input value={f.referredBy} onChangeText={set("referredBy")} /></Field>
        <RegularPhysioField value={primaryTherapistId} onChange={setPhysio} />
      </Card>

      <Card style={{ gap: space.md }}>
        <SectionTitle>Address (needed for home visits)</SectionTitle>
        <Field label="Address"><Input value={f.line1} onChangeText={set("line1")} placeholder="House, street, area" /></Field>
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}><Field label="City"><Input value={f.city} onChangeText={set("city")} /></Field></View>
          <View style={{ flex: 1 }}><Field label="State"><Input value={f.state} onChangeText={set("state")} /></Field></View>
        </Row>
        <Field label="Pincode"><Input value={f.pincode} onChangeText={(t) => set("pincode")(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} /></Field>
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ flex: 1, paddingRight: space.md }}>Patient consents to treatment and data processing</Text>
          <Switch value={consent} onValueChange={setConsent} trackColor={{ true: colors.gold500, false: colors.navy100 }} thumbColor={colors.white} />
        </Row>
      </Card>

      <ErrorBox error={save.error} />
      {problem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
      <Button title="Register patient" icon="person-add-outline" onPress={() => save.mutate()} disabled={!!problem} loading={save.isPending} />
    </Screen>
  );
}
