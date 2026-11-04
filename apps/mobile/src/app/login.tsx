import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Logo, Text } from "@/components/ui";
import { ApiError, api, messageOf } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { useAuth, type Session } from "@/lib/auth";
import { colors, space } from "@/theme";

const PIN_LENGTH = 6;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

/** Staff sign-in: 6-digit PIN only. Submits automatically when the 6th digit is entered. */
export default function Login() {
  const status = useAuth((s) => s.status);
  const signIn = useAuth((s) => s.signIn);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wake the server (and its database connection) while the PIN is being typed, so sign-in and
  // the first screen don't pay the "cold start" delay. Fire-and-forget: errors are ignored.
  useEffect(() => {
    fetch(`${API_URL}/health`).catch(() => {});
  }, []);

  if (status === "signedIn") return <Redirect href="/" />;

  const submit = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      const session = await api.post<Session>("/auth/pin/login", { pin: code });
      if (session.user.role === "PATIENT") throw new Error("This app is for Movement Hub staff.");
      await signIn(session);
    } catch (e) {
      const network = e instanceof ApiError && e.code === "NETWORK";
      // Show which server was tried, so "can't connect" problems are easy to diagnose.
      setError(network ? `${messageOf(e)}
Server: ${API_URL.replace(/\/api\/v1$/, "")} (is the API running?)` : messageOf(e) || "Sign-in failed. Please try again.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const press = (key: (typeof KEYS)[number]) => {
    if (busy || !key) return;
    if (key === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (error) setError(null);
    const next = (pin + key).slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) submit(next);
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.top}>
        <Logo size={96} />
        <Text weight="bold" style={styles.title}>MOVEMENT HUB</Text>
        <Text weight="semibold" style={styles.subtitle}>PHYSIOTHERAPY &amp; REHAB</Text>
        <Text style={styles.prompt}>Enter your 6-digit PIN</Text>

        <View style={styles.dots} accessible accessibilityLabel={`${pin.length} of ${PIN_LENGTH} digits entered`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled, !!error && styles.dotError]} />
          ))}
        </View>

        <View style={styles.message}>
          {busy ? (
            <ActivityIndicator color={colors.gold300} />
          ) : error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.pad}>
        {KEYS.map((k, i) =>
          k === "" ? (
            <View key={i} style={styles.key} />
          ) : (
            <View key={i} style={styles.key}>
              <Pressable
                onPress={() => press(k)}
                onLongPress={k === "del" ? () => setPin("") : undefined}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={k === "del" ? "Delete digit" : k}
                style={({ pressed }) => [styles.keyBtn, k === "del" && styles.keyDel, pressed && styles.keyPressed]}
              >
                {k === "del" ? <Ionicons name="backspace-outline" size={26} color={colors.white} /> : <Text weight="semibold" style={styles.keyText}>{k}</Text>}
              </Pressable>
            </View>
          ),
        )}
      </View>

      <Text style={styles.help}>Forgot your PIN? Ask your admin to reset it.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy900, justifyContent: "space-between", paddingHorizontal: space.xl, paddingVertical: space.lg },
  top: { alignItems: "center", gap: 6, marginTop: space.lg },
  title: { color: colors.white, fontSize: 22, letterSpacing: 2, marginTop: space.sm },
  subtitle: { color: colors.gold300, fontSize: 11, letterSpacing: 3 },
  prompt: { color: colors.navy100, fontSize: 15, marginTop: space.xl },
  dots: { flexDirection: "row", gap: 18, marginTop: space.lg },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: "rgba(229,198,127,0.45)" },
  dotFilled: { backgroundColor: colors.gold500, borderColor: colors.gold500, shadowColor: colors.gold500, shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  dotError: { borderColor: colors.danger },
  message: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.md },
  error: { color: "#FECDD3", textAlign: "center", fontSize: 13 },
  pad: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignSelf: "center", width: "100%", maxWidth: 320, rowGap: space.md },
  key: { width: "33.33%", height: 76, alignItems: "center", justifyContent: "center" },
  keyBtn: { width: 70, height: 70, borderRadius: 35, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  keyDel: { backgroundColor: "transparent" },
  keyPressed: { backgroundColor: "rgba(229,198,127,0.28)", transform: [{ scale: 0.95 }] },
  keyText: { color: colors.white, fontSize: 28 },
  help: { color: colors.navy100, fontSize: 12, textAlign: "center" },
});
