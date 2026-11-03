import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "@/lib/api";
import { useAction } from "@/lib/refresh";
import { colors, space } from "@/theme";
import { Sheet } from "./form";
import { Button, ErrorBox, Field, Input, Muted, Row, Text } from "./ui";

export const PIN_LENGTH = 6;

/** Mirrors the API / web weak-PIN rules so admins get instant feedback. */
export function pinProblem(pin: string, confirm: string): string | null {
  if (!pin) return "Enter a 6-digit PIN";
  if (!/^\d{6}$/.test(pin)) return "PIN must be exactly 6 digits";
  if (/^(\d)\1+$/.test(pin)) return "Too easy to guess (repeated digits)";
  const d = pin.split("").map(Number);
  const up = d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10);
  const down = d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10);
  if (up || down) return "Too easy to guess (sequential digits)";
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d\d\d)\1$/.test(pin)) return "Too easy to guess (repeating pattern)";
  if (["112233", "102030", "147258", "159753", "123321", "696969"].includes(pin)) return "Too easy to guess";
  if (pin !== confirm) return "PINs don't match";
  return null;
}

const clean = (v: string) => v.replace(/\D/g, "").slice(0, PIN_LENGTH);

/** PIN + confirm (masked, numeric) with show/hide and a live hint. */
export function PinFields({ pin, confirm, onPin, onConfirm }: { pin: string; confirm: string; onPin: (v: string) => void; onConfirm: (v: string) => void }) {
  const [show, setShow] = useState(false);
  const problem = pin || confirm ? pinProblem(pin, confirm) : null;
  return (
    <View style={{ gap: space.sm }}>
      <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Field label="App PIN *">
            <Input value={pin} onChangeText={(t) => onPin(clean(t))} keyboardType="number-pad" secureTextEntry={!show} maxLength={6} placeholder="••••••" autoComplete="off" style={{ letterSpacing: 4 }} />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Confirm PIN *">
            <Input value={confirm} onChangeText={(t) => onConfirm(clean(t))} keyboardType="number-pad" secureTextEntry={!show} maxLength={6} placeholder="••••••" autoComplete="off" style={{ letterSpacing: 4 }} />
          </Field>
        </View>
      </Row>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <Text style={{ flex: 1, fontSize: 12, color: problem ? colors.warning : pin ? colors.success : colors.muted }}>
          {problem ?? (pin ? "✓ PIN looks good" : "6 digits, different for every staff member. This PIN alone signs them in to the app.")}
        </Text>
        <Pressable onPress={() => setShow((s) => !s)} hitSlop={8} accessibilityRole="button" accessibilityLabel={show ? "Hide PIN" : "Show PIN"}>
          <Row gap={4}>
            <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={16} color={colors.muted} />
            <Muted style={{ fontSize: 12 }}>{show ? "Hide" : "Show"}</Muted>
          </Row>
        </Pressable>
      </Row>
    </View>
  );
}

/** Small PIN status pill. */
export function PinBadge({ hasPin }: { hasPin?: boolean }) {
  return (
    <View style={{ alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: hasPin ? colors.successBg : colors.warningBg }}>
      <Text weight="semibold" style={{ fontSize: 11, color: hasPin ? colors.success : colors.warning }}>{hasPin ? "App PIN ✓" : "No app PIN"}</Text>
    </View>
  );
}

/** Admin sheet to set / reset someone's app PIN (POST /users/:id/pin). Open by passing a user; null closes. */
export function SetPinSheet({ user, onClose }: { user: { id: string; name: string; hasPin?: boolean } | null; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const close = () => {
    setPin("");
    setConfirm("");
    save.reset();
    onClose();
  };
  const save = useAction(() => api.post(`/users/${user!.id}/pin`, { pin }), { refresh: ["staff"], onSuccess: () => close() });
  const problem = pinProblem(pin, confirm);
  return (
    <Sheet
      open={!!user}
      onClose={close}
      title={`${user?.hasPin ? "Reset" : "Set"} app PIN`}
      footer={<Button title={save.isPending ? "Saving…" : "Save PIN"} icon="key-outline" onPress={() => save.mutate()} disabled={!!problem} loading={save.isPending} />}
    >
      <Muted>
        {user?.name} signs in to the mobile app with this PIN only, so it must be different from everyone else&apos;s. Saving signs them out of the app on all devices and unlocks the account if it was locked.
      </Muted>
      <PinFields pin={pin} confirm={confirm} onPin={setPin} onConfirm={setConfirm} />
      <ErrorBox error={save.error} />
    </Sheet>
  );
}
