import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Switch } from "react-native";
import { DobAgeFields, goBack, RegularPhysioField, RequireRole, SectionTitle } from "@/components/form";
import { Button, Card, Chips, ErrorBox, Field, Input, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useQuery } from "@tanstack/react-query";
import { useAction } from "@/lib/refresh";
import type { PatientDetail } from "@/lib/types";
import { colors, space } from "@/theme";

type Gender = "MALE" | "FEMALE" | "OTHER";
type PatientType = "REGULAR" | "WALK_IN";

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
  const [patientType, setPatientType] = useState<PatientType>((patient.patientType as PatientType) ?? "REGULAR");
  const [consent, setConsent] = useState(!!patient.consentGiven);
  const [physio, setPhysio] = useState(patient.primaryTherapistId ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const set = (k: keyof typeof f) => (t: string) => setF((x) => ({ ...x, [k]: t }));
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
  if (f.emergencyPhone.trim() && f.emergencyPhone.replace(/\D/g, "").length < 10) {
    errors.emergencyPhone = "Enter a valid emergency phone number";
  }

  const err = (k: string) => ((submitted || touched[k]) ? errors[k] : undefined);

  const save = useAction(
    () =>
      api.patch(`/patients/${patient.id}`, {
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim() || undefined,
        gender,
        patientType,
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

  const handleSave = () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    save.mutate();
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title={`Edit ${fullName(patient)}`} onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: "/patient/[id]", params: { id: patient.id } }))} />
      <Muted>{patient.patientCode}</Muted>

      <Card style={{ gap: space.md }}>
        <SectionTitle>Personal details</SectionTitle>
        <Field label="First name *" error={err("firstName")}>
          <Input value={f.firstName} onChangeText={set("firstName")} onBlur={() => mark("firstName")} autoCapitalize="words" />
        </Field>
        <Field label="Last name">
          <Input value={f.lastName} onChangeText={set("lastName")} autoCapitalize="words" />
        </Field>
        <Field label="Mobile number *" error={err("phone")}>
          <Input value={f.phone} onChangeText={set("phone")} onBlur={() => mark("phone")} keyboardType="phone-pad" maxLength={18} />
        </Field>
        <Field label="Patient type">
          <Chips<PatientType> value={patientType} onChange={setPatientType} options={[{ value: "REGULAR", label: "Regular" }, { value: "WALK_IN", label: "Walk-in" }]} />
        </Field>
        <Field label="Gender">
          <Chips<Gender> value={gender} onChange={setGender} options={[{ value: "FEMALE", label: "Female" }, { value: "MALE", label: "Male" }, { value: "OTHER", label: "Other" }]} />
        </Field>
        <DobAgeFields dob={f.dateOfBirth} onDob={set("dateOfBirth")} clearable />
        <Field label="Email" error={err("email")}>
          <Input value={f.email} onChangeText={set("email")} onBlur={() => mark("email")} keyboardType="email-address" autoCapitalize="none" />
        </Field>
        <Field label="Occupation">
          <Input value={f.occupation} onChangeText={set("occupation")} />
        </Field>
        <Field label="Referred by">
          <Input value={f.referredBy} onChangeText={set("referredBy")} />
        </Field>
        <RegularPhysioField value={physio} onChange={setPhysio} />
      </Card>

      <Card style={{ gap: space.md }}>
        <SectionTitle>Emergency contact</SectionTitle>
        <Field label="Name">
          <Input value={f.emergencyName} onChangeText={set("emergencyName")} autoCapitalize="words" />
        </Field>
        <Field label="Phone" error={err("emergencyPhone")}>
          <Input value={f.emergencyPhone} onChangeText={set("emergencyPhone")} onBlur={() => mark("emergencyPhone")} keyboardType="phone-pad" maxLength={18} />
        </Field>
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ flex: 1, paddingRight: space.md }}>Consent for treatment and data processing</Text>
          <Switch value={consent} onValueChange={setConsent} trackColor={{ true: colors.gold500, false: colors.navy100 }} thumbColor={colors.white} />
        </Row>
      </Card>

      <ErrorBox error={save.error} />
      <Button title="Save changes" icon="save-outline" onPress={handleSave} loading={save.isPending} />
    </Screen>
  );
}
