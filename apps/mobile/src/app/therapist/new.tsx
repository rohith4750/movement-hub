import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { PinFields, pinProblem } from "@/components/admin-pin";
import { RequireRole, SectionTitle, goBack } from "@/components/form";
import { Button, Card, ErrorBox, Field, Input, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api, fieldErrors } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useAction } from "@/lib/refresh";
import { colors, radius, space } from "@/theme";

const SWATCHES = ["#1b2160", "#b45309", "#047857", "#7c3aed", "#be123c", "#0e7490", "#c9a14a", "#4d7c0f"];

export default function NewTherapistScreen() {
  return (
    <RequireRole roles={["ADMIN"]} title="Add physiotherapist">
      <NewTherapist />
    </RequireRole>
  );
}

function NewTherapist() {
  const specs = useQuery({ queryKey: qk.specializations(), queryFn: () => api.get<{ id: string; name: string }[]>("/specializations") });
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "", qualification: "BPT", experienceYears: "0", colorTag: SWATCHES[0], isAvailableForHomeVisit: false });
  const [specIds, setSpecIds] = useState<string[]>([]);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");

  const create = useAction(
    () =>
      api.post<{ id: string }>("/therapists", {
        name: f.name.trim(),
        email: f.email.trim(),
        phone: f.phone.trim(),
        password: f.password,
        qualification: f.qualification.trim(),
        experienceYears: Number(f.experienceYears) || 0,
        colorTag: f.colorTag,
        isAvailableForHomeVisit: f.isAvailableForHomeVisit,
        specializationIds: specIds,
        pin,
      }),
    { refresh: ["staff", "schedule"], onSuccess: (t) => router.replace({ pathname: "/therapist/[id]", params: { id: t.id } }) },
  );

  const server = fieldErrors(create.error); // e.g. "This email address is already in use"

  const missing = !f.name.trim()
    ? "Enter the name"
    : !/\S+@\S+\.\S+/.test(f.email.trim())
      ? "Enter a valid email"
      : f.phone.replace(/\D/g, "").length < 10
        ? "Enter the mobile number"
        : f.password.length < 8
          ? "Web password must be at least 8 characters"
          : f.qualification.trim().length < 2
            ? "Enter the qualification"
            : pinProblem(pin, confirm);

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title="Add physiotherapist" onBack={() => goBack("/therapists")} />
      <Card style={{ gap: space.md }}>
        <Field label="Full name *"><Input value={f.name} onChangeText={(t) => setF({ ...f, name: t })} autoCapitalize="words" /></Field>
        <Field label="Email *" error={server.email}><Input value={f.email} onChangeText={(t) => setF({ ...f, email: t })} keyboardType="email-address" autoCapitalize="none" autoComplete="email" /></Field>
        <Field label="Mobile number *" error={server.phone}><Input value={f.phone} onChangeText={(t) => setF({ ...f, phone: t })} keyboardType="phone-pad" placeholder="98765 43210" /></Field>
        <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 2 }}><Field label="Qualification *"><Input value={f.qualification} onChangeText={(t) => setF({ ...f, qualification: t })} /></Field></View>
          <View style={{ flex: 1 }}><Field label="Experience (yrs)"><Input value={f.experienceYears} onChangeText={(t) => setF({ ...f, experienceYears: t.replace(/\D/g, "").slice(0, 2) })} keyboardType="number-pad" /></Field></View>
        </Row>
        <Field label="Calendar colour">
          <View style={styles.swatches}>
            {SWATCHES.map((c) => (
              <Pressable key={c} onPress={() => setF({ ...f, colorTag: c })} accessibilityRole="button" accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: f.colorTag === c }} style={[styles.swatch, { backgroundColor: c }, f.colorTag === c && styles.swatchOn]} />
            ))}
          </View>
        </Field>
        <Row style={{ justifyContent: "space-between" }}>
          <Text>Does home visits</Text>
          <Switch value={f.isAvailableForHomeVisit} onValueChange={(v) => setF({ ...f, isAvailableForHomeVisit: v })} trackColor={{ true: colors.gold500, false: colors.navy100 }} thumbColor={colors.white} />
        </Row>
        <Field label="Specializations">
          <View style={styles.swatches}>
            {(specs.data ?? []).map((s) => {
              const on = specIds.includes(s.id);
              return (
                <Pressable key={s.id} onPress={() => setSpecIds(on ? specIds.filter((x) => x !== s.id) : [...specIds, s.id])} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
                  <Text weight={on ? "semibold" : "regular"} style={{ fontSize: 13 }}>{s.name}</Text>
                </Pressable>
              );
            })}
            {specs.data?.length === 0 ? <Muted style={{ fontSize: 12 }}>No specializations defined.</Muted> : null}
          </View>
        </Field>
      </Card>

      <SectionTitle>Web portal sign-in</SectionTitle>
      <Card>
        <Field label="Web password * (min 8 characters)"><Input value={f.password} onChangeText={(t) => setF({ ...f, password: t })} secureTextEntry autoComplete="new-password" /></Field>
      </Card>

      <SectionTitle>Mobile app sign-in</SectionTitle>
      <Card gold>
        <PinFields pin={pin} confirm={confirm} onPin={setPin} onConfirm={setConfirm} />
      </Card>

      <ErrorBox error={create.error} />
      {missing ? <Muted style={{ fontSize: 12, color: colors.warning }}>{missing}</Muted> : null}
      <Button title={create.isPending ? "Creating…" : "Create physiotherapist"} icon="checkmark-circle-outline" onPress={() => create.mutate()} disabled={!!missing} loading={create.isPending} />
      <Muted style={{ fontSize: 12 }}>After creating, set their weekly schedule so patients can be booked with them.</Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: "transparent" },
  swatchOn: { borderColor: colors.gold500, transform: [{ scale: 1.1 }] },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.gold100, borderColor: colors.gold500 },
});
