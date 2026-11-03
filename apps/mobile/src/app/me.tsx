import { useState } from "react";
import { View } from "react-native";
import { PinInput, PIN_LENGTH } from "@/components/pin-input";
import { TopBar, BrandHeader, Button, Card, ErrorBox, Field, H2, KeyValue, Loading, Muted, Row, Screen, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, type Session } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { label } from "@/lib/format";
import { useMe } from "@/lib/queries";
import { useAction } from "@/lib/refresh";
import { goBack, ListRow } from "@/components/form";
import { router } from "expo-router";
import { colors, space } from "@/theme";

/** Same weak-PIN rule as the API, for instant feedback. */
function pinProblem(pin: string) {
  if (pin.length !== PIN_LENGTH) return null;
  if (/^(\d)\1+$/.test(pin)) return "Too easy to guess (repeated digits)";
  const d = pin.split("").map(Number);
  if (d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10) || d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10)) return "Too easy to guess (sequential digits)";
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d\d\d)\1$/.test(pin)) return "Too easy to guess (repeating pattern)";
  return null;
}

export default function Profile() {
  const signIn = useAuth((s) => s.signIn);
  const signOut = useAuth((s) => s.signOut);
  const refreshToken = useAuth((s) => s.refreshToken);
  const me = useMe();

  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState(false);

  // Nothing cached depends on the PIN, so no refresh group: just keep this device's fresh session.
  const change = useAction(() => api.post<Session>("/auth/pin/change", { currentPin: current, newPin: next }), {
    onSuccess: (session) => {
      void signIn(session); // other devices are signed out; this one keeps a fresh session
      setChanging(false);
      setCurrent("");
      setNext("");
      setAgain("");
      setDone(true);
    },
  });

  const weak = pinProblem(next);
  const mismatch = again.length === PIN_LENGTH && next !== again ? "PINs don't match" : null;
  const ready = current.length === PIN_LENGTH && next.length === PIN_LENGTH && again.length === PIN_LENGTH && !weak && !mismatch;

  const logout = async () => {
    if (!(await confirm("Sign out?", "You'll need your PIN to sign in again.", "Sign out", true))) return;
    try {
      await api.post("/auth/logout", { refreshToken });
    } catch {
      /* signing out locally is enough if the server is unreachable */
    }
    await signOut();
  };

  return (
    <Screen edges={["top", "bottom"]} refreshing={me.isRefetching} onRefresh={() => me.refetch()}>
      <TopBar title="My account" onBack={() => goBack("/more")} />
      <BrandHeader title={me.data?.name ?? "My account"} subtitle={me.data ? label(me.data.role) : undefined} />

      {me.isLoading ? (
        <Loading />
      ) : me.error ? (
        <ErrorBox error={me.error} onRetry={() => me.refetch()} />
      ) : me.data ? (
        <Card>
          <H2>Account</H2>
          <KeyValue k="Role" v={label(me.data.role)} />
          <KeyValue k="Mobile" v={me.data.phone} />
          {me.data.email ? <KeyValue k="Email" v={me.data.email} /> : null}
          <Muted style={{ fontSize: 12, marginTop: space.xs }}>To change your name, number or role, ask your admin.</Muted>
        </Card>
      ) : null}

      {me.data?.therapist ? (
        <ListRow
          icon="calendar-number-outline"
          title="My schedule & leave"
          subtitle="Working hours, request time off"
          onPress={() => router.push({ pathname: "/therapist/[id]", params: { id: me.data!.therapist!.id } })}
        />
      ) : null}

      <Card style={{ gap: space.md }}>
        <Row style={{ justifyContent: "space-between" }}>
          <H2>App PIN</H2>
          {!changing ? (
            <Button
              title="Change PIN"
              variant="ghost"
              small
              icon="key-outline"
              onPress={() => {
                change.reset();
                setDone(false);
                setChanging(true);
              }}
            />
          ) : null}
        </Row>
        {done ? <Text style={{ color: colors.success }}>✓ PIN changed. Other devices have been signed out.</Text> : null}
        {changing ? (
          <View style={{ gap: space.md }}>
            <Field label="Current PIN"><PinInput value={current} onChange={setCurrent} autoFocus accessibilityLabel="Current PIN" /></Field>
            <Field label="New PIN"><PinInput value={next} onChange={setNext} error={!!weak} accessibilityLabel="New PIN" /></Field>
            <Field label="Confirm new PIN"><PinInput value={again} onChange={setAgain} error={!!mismatch} accessibilityLabel="Confirm new PIN" /></Field>
            {weak || mismatch ? <Text style={{ color: colors.warning, fontSize: 12 }}>{weak ?? mismatch}</Text> : null}
            <ErrorBox error={change.error} />
            <Row>
              <Button title="Cancel" variant="ghost" onPress={() => setChanging(false)} style={{ flex: 1 }} />
              <Button title="Save PIN" onPress={() => change.mutate()} disabled={!ready} loading={change.isPending} style={{ flex: 1 }} />
            </Row>
          </View>
        ) : (
          <Muted style={{ fontSize: 12 }}>Forgot your PIN? An admin can reset it in More → Staff.</Muted>
        )}
      </Card>

      <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={logout} />
      <Muted style={{ textAlign: "center", fontSize: 12 }}>Movement Hub – Physiotherapy &amp; Rehab · Staff app</Muted>
    </Screen>
  );
}
