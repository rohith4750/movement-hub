import { router } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";
import { DobAgeFields, goBack, RegularPhysioField, RequireRole, SectionTitle, useOwnTherapistId } from "@/components/form";
import { Button, Card, Chips, ErrorBox, Field, Input, Row, Screen, Text, TopBar } from "@/components/ui";
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
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const set = (k: keyof typeof EMPTY) => (t: string) => setF((x) => ({ ...x, [k]: t }));
  const mark = (k: string) => setTouched((x) => ({ ...x, [k]: true }));

  const errors: Record<string, string | undefined> = {};
  if (!f.firstName.trim()) errors.firstName = "First name is required";
  const cleanPhone = f.phone.replace(/\D/g, "");
  if (!cleanPhone) {
    errors.phone = "Mobile number is required";
  } else if (cleanPhone.length < 10) {
    errors.phone = "Enter a valid 10-digit mobile number";
  }
  if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) {
    errors.email = "Enter a valid email address";
  }
  if (f.line1.trim()) {
    if (!f.city.trim()) errors.city = "City is required";
    if (!f.state.trim()) errors.state = "State is required";
    if (!f.pincode.trim()) {
      errors.pincode = "Pincode is required";
    } else if (!/^\d{6}$/.test(f.pincode.trim())) {
      errors.pincode = "Pincode must be 6 digits";
    }
  }

  const err = (k: string) => ((submitted || touched[k]) ? errors[k] : undefined);

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

  const handleRegister = () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    save.mutate();
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title="Register patient" onBack={() => goBack("/patients")} />

      <Card style={{ gap: space.md }}>
        <SectionTitle>Personal details</SectionTitle>
        <Field label="First name *" error={err("firstName")}>
          <Input value={f.firstName} onChangeText={set("firstName")} onBlur={() => mark("firstName")} autoCapitalize="words" autoComplete="given-name" />
        </Field>
        <Field label="Last name">
          <Input value={f.lastName} onChangeText={set("lastName")} autoCapitalize="words" autoComplete="family-name" />
        </Field>
        <Field label="Mobile number *" error={err("phone")}>
          <Input value={f.phone} onChangeText={set("phone")} onBlur={() => mark("phone")} keyboardType="phone-pad" placeholder="98765 43210" maxLength={18} />
        </Field>
        <Field label="Patient type *">
          <Chips<PatientType> value={f.patientType} onChange={(t) => setF((x) => ({ ...x, patientType: t }))} options={[{ value: "REGULAR", label: "Regular" }, { value: "WALK_IN", label: "Walk-in" }]} />
        </Field>
        <Field label="Gender *">
          <Chips<Gender> value={gender} onChange={setGender} options={[{ value: "FEMALE", label: "Female" }, { value: "MALE", label: "Male" }, { value: "OTHER", label: "Other" }]} />
        </Field>
        <DobAgeFields dob={f.dateOfBirth} onDob={set("dateOfBirth")} clearable />
        <Field label="Email" error={err("email")}>
          <Input value={f.email} onChangeText={set("email")} onBlur={() => mark("email")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        </Field>
        <Field label="Referred by">
          <Input value={f.referredBy} onChangeText={set("referredBy")} />
        </Field>
        <RegularPhysioField value={primaryTherapistId} onChange={setPhysio} />
      </Card>

      <Card style={{ gap: space.md }}>
        <SectionTitle>Address (needed for home visits)</SectionTitle>
        <Field label="Address">
          <Input value={f.line1} onChangeText={set("line1")} placeholder="House, street, area" />
        </Field>
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}>
            <Field label="City" error={err("city")}>
              <Input value={f.city} onChangeText={set("city")} onBlur={() => mark("city")} />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="State" error={err("state")}>
              <Input value={f.state} onChangeText={set("state")} onBlur={() => mark("state")} />
            </Field>
          </View>
        </Row>
        <Field label="Pincode" error={err("pincode")}>
          <Input value={f.pincode} onChangeText={(t) => set("pincode")(t.replace(/\D/g, "").slice(0, 6))} onBlur={() => mark("pincode")} keyboardType="number-pad" maxLength={6} />
        </Field>
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ flex: 1, paddingRight: space.md }}>Patient consents to treatment and data processing</Text>
          <Switch value={consent} onValueChange={setConsent} trackColor={{ true: colors.gold500, false: colors.navy100 }} thumbColor={colors.white} />
        </Row>
      </Card>

      <ErrorBox error={save.error} />
      <Button title="Register patient" icon="person-add-outline" onPress={handleRegister} loading={save.isPending} />
    </Screen>
  );
}
