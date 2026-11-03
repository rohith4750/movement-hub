import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Switch } from "react-native";
import { DobAgeFields, goBack, RegularPhysioField, RequireRole, SectionTitle } from "@/components/form";
import { Button, Card, Chips, ErrorBox, Field, Input, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useAction } from "@/lib/refresh";
import type { PatientDetail } from "@/lib/types";
import { colors, space } from "@/theme";

type Gender = "MALE" | "FEMALE" | "OTHER";

export default function EditPatient() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST"]} title="Edit patient">
      <EditPatientLoader />
    </RequireRole>
  );
}

function EditPatientLoader() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Same cache entry as usePatient(); kept inline because this screen also reads consentGiven/occupation.
  const q = useQuery({ queryKey: qk.patient(id), queryFn: () => api.get<PatientDetail & { consentGiven?: boolean; occupation?: string | null }>(`/patients/${id}`), enabled: !!id });
  if (q.data) return <EditPatientForm patient={q.data} />;
  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title="Edit patient" onBack={() => goBack("/patients")} />
      {q.isLoading ? <Loading /> : <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
    </Screen>
  );
}

/** Mounted only after the patient loads, so the form starts from the saved values. */
function EditPatientForm({ patient }: { patient: PatientDetail & { consentGiven?: boolean; occupation?: string | null } }) {
  const [f, setF] = useState({
    firstName: patient.firstName,
    lastName: patient.lastName ?? "",
    phone: patient.phone,
    dateOfBirth: patient.dateOfBirth ? patient.dateOfBirth.slice(0, 10) : "",
    email: patient.email ?? "",
    referredBy: patient.referredBy ?? "",
    occupation: patient.occupation ?? "",
    emergencyName: patient.emergencyName ?? "",
    emergencyPhone: patient.emergencyPhone ?? "",
  });
  const [gender, setGender] = useState<Gender>((patient.gender as Gender) ?? "OTHER");
  const [consent, setConsent] = useState(!!patient.consentGiven);
  const [physio, setPhysio] = useState(patient.primaryTherapistId ?? "");
  const set = (k: keyof typeof f) => (t: string) => setF((x) => ({ ...x, [k]: t }));

  const problem = !f.firstName.trim()
    ? "Enter the first name"
    : f.phone.replace(/\D/g, "").length < 10
      ? "Enter a valid mobile number"
      : f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())
        ? "Email looks invalid"
        : f.emergencyPhone.trim() && f.emergencyPhone.replace(/\D/g, "").length < 10
          ? "Emergency phone looks invalid"
          : null;

  const save = useAction(
    () =>
      api.patch(`/patients/${patient.id}`, {
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim() || undefined,
        gender,
        dateOfBirth: f.dateOfBirth || undefined,
        phone: f.phone.trim(),
        email: f.email.trim() || undefined,
        referredBy: f.referredBy.trim() || undefined,
        primaryTherapistId: physio || null,
        occupation: f.occupation.trim() || undefined,
        emergencyName: f.emergencyName.trim() || undefined,
        emergencyPhone: f.emergencyPhone.trim() || undefined,
        consentGiven: consent,
      }),
    { refresh: ["patients"], onSuccess: () => goBack({ pathname: "/patient/[id]", params: { id: patient.id } }) },
  );

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title={`Edit ${fullName(patient)}`} onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: "/patient/[id]", params: { id: patient.id } }))} />
      <Muted>{patient.patientCode}</Muted>

      <Card style={{ gap: space.md }}>
        <SectionTitle>Personal details</SectionTitle>
        <Field label="First name *"><Input value={f.firstName} onChangeText={set("firstName")} autoCapitalize="words" /></Field>
        <Field label="Last name"><Input value={f.lastName} onChangeText={set("lastName")} autoCapitalize="words" /></Field>
        <Field label="Mobile number *"><Input value={f.phone} onChangeText={set("phone")} keyboardType="phone-pad" maxLength={18} /></Field>
        <Field label="Gender">
          <Chips<Gender> value={gender} onChange={setGender} options={[{ value: "FEMALE", label: "Female" }, { value: "MALE", label: "Male" }, { value: "OTHER", label: "Other" }]} />
        </Field>
        <DobAgeFields dob={f.dateOfBirth} onDob={set("dateOfBirth")} clearable />
        <Field label="Email"><Input value={f.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" /></Field>
        <Field label="Occupation"><Input value={f.occupation} onChangeText={set("occupation")} /></Field>
        <Field label="Referred by"><Input value={f.referredBy} onChangeText={set("referredBy")} /></Field>
        <RegularPhysioField value={physio} onChange={setPhysio} />
      </Card>

      <Card style={{ gap: space.md }}>
        <SectionTitle>Emergency contact</SectionTitle>
        <Field label="Name"><Input value={f.emergencyName} onChangeText={set("emergencyName")} autoCapitalize="words" /></Field>
        <Field label="Phone"><Input value={f.emergencyPhone} onChangeText={set("emergencyPhone")} keyboardType="phone-pad" maxLength={18} /></Field>
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ flex: 1, paddingRight: space.md }}>Consent for treatment and data processing</Text>
          <Switch value={consent} onValueChange={setConsent} trackColor={{ true: colors.gold500, false: colors.navy100 }} thumbColor={colors.white} />
        </Row>
      </Card>

      <ErrorBox error={save.error} />
      {problem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
      <Button title="Save changes" icon="save-outline" onPress={() => save.mutate()} disabled={!!problem} loading={save.isPending} />
    </Screen>
  );
}
