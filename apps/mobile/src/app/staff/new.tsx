import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { PinFields, pinProblem } from "@/components/admin-pin";
import { RequireRole, SectionTitle, goBack } from "@/components/form";
import { Button, Card, ErrorBox, Field, Input, Muted, Screen, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { colors, space } from "@/theme";


export default function NewStaffScreen() {
  return (
    <RequireRole roles={["SUPER_ADMIN"]} title="Add Super Admin">
      <NewStaff />
    </RequireRole>
  );
}

function NewStaff() {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "" });
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");

  const create = useMutation({
    mutationFn: () => api.post("/users", { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), role: "SUPER_ADMIN", password: f.password, pin }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      router.replace("/staff");
    },
  });

  const missing = f.name.trim().length < 2
    ? "Enter the name"
    : !/\S+@\S+\.\S+/.test(f.email.trim())
      ? "Enter a valid email"
      : f.phone.replace(/\D/g, "").length < 10
        ? "Enter the mobile number"
        : f.password.length < 8
          ? "Web password must be at least 8 characters"
          : pinProblem(pin, confirm);

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title="Add Super Admin" onBack={() => goBack("/staff")} />
      <Card style={{ gap: space.md }}>
        <Field label="Name *"><Input value={f.name} onChangeText={(t) => setF({ ...f, name: t })} autoCapitalize="words" /></Field>
        <Field label="Email *"><Input value={f.email} onChangeText={(t) => setF({ ...f, email: t })} keyboardType="email-address" autoCapitalize="none" autoComplete="email" /></Field>
        <Field label="Mobile number *"><Input value={f.phone} onChangeText={(t) => setF({ ...f, phone: t })} keyboardType="phone-pad" placeholder="98765 43210" /></Field>
        <Muted style={{ fontSize: 12 }}>Creates a Super Admin (full access). Add physiotherapists from Therapists so their schedule is set up.</Muted>
      </Card>

      <SectionTitle>Web portal sign-in</SectionTitle>
      <Card>
        <Field label="Temporary password * (min 8 characters)"><Input value={f.password} onChangeText={(t) => setF({ ...f, password: t })} secureTextEntry autoComplete="new-password" /></Field>
      </Card>

      <SectionTitle>Mobile app sign-in</SectionTitle>
      <Card gold>
        <PinFields pin={pin} confirm={confirm} onPin={setPin} onConfirm={setConfirm} />
      </Card>

      <ErrorBox error={create.error} />
      {missing ? <Muted style={{ fontSize: 12, color: colors.warning }}>{missing}</Muted> : null}
      <Button title={create.isPending ? "Creating…" : "Create Super Admin"} icon="checkmark-circle-outline" onPress={() => create.mutate()} disabled={!!missing} loading={create.isPending} />
    </Screen>
  );
}
