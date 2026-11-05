import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  const insets = useSafeAreaInsets();

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
    <View style={styles.screen}>
      {/* Navy hero with the logo, curving into the light sign-in area */}
      <View style={[styles.hero, { paddingTop: insets.top + 36 }]}>
        <View pointerEvents="none" style={styles.wave} />
        <View pointerEvents="none" style={styles.waveSmall} />
        <View style={styles.logoRing}>
          <Logo size={140} />
        </View>
      </View>

      <View style={[styles.body, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.top}>
          <Text weight="bold" style={styles.title}>Staff Sign In</Text>
          <Text style={styles.prompt}>Enter your 6-digit PIN</Text>

          <View style={styles.dots} accessible accessibilityLabel={`${pin.length} of ${PIN_LENGTH} digits entered`}>
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled, !!error && styles.dotError]} />
            ))}
          </View>

          <View style={styles.message}>
            {busy ? (
              <ActivityIndicator color={colors.gold600} />
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
                  {k === "del" ? <Ionicons name="backspace-outline" size={26} color={colors.navy700} /> : <Text weight="semibold" style={styles.keyText}>{k}</Text>}
                </Pressable>
              </View>
            ),
          )}
        </View>

        <Text style={styles.help}>Forgot PIN? Ask your admin to reset it.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy900 },
  hero: { backgroundColor: colors.navy900, alignItems: "center", paddingBottom: 84, overflow: "hidden" },
  // Fine gold arcs sweeping across the bottom-left of the hero (the hero clips the rest of each circle).
  wave: { position: "absolute", left: -150, bottom: -80, width: 460, height: 460, borderRadius: 230, borderWidth: 2, borderColor: "rgba(229,198,127,0.40)" },
  waveSmall: { position: "absolute", left: -190, bottom: -120, width: 460, height: 460, borderRadius: 230, borderWidth: 2, borderColor: "rgba(229,198,127,0.20)" },
  logoRing: { padding: 4, borderRadius: 84, borderWidth: 2, borderColor: "rgba(229,198,127,0.75)" },
  body: { flex: 1, justifyContent: "flex-start", gap: space.lg, paddingHorizontal: space.xl, paddingTop: space.xl, marginTop: -34, backgroundColor: "#FAF7EE", borderTopLeftRadius: 40, borderTopRightRadius: 40 },
  top: { alignItems: "center", gap: 6 },
  title: { color: colors.navy900, fontSize: 24, letterSpacing: -0.3 },
  prompt: { color: colors.muted, fontSize: 14 },
  dots: { flexDirection: "row", gap: 18, marginTop: space.lg },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.gold500 },
  dotFilled: { backgroundColor: colors.navy800, borderColor: colors.navy800 },
  dotError: { borderColor: colors.danger },
  message: { minHeight: 40, justifyContent: "center", paddingHorizontal: space.md },
  error: { color: colors.danger, textAlign: "center", fontSize: 13 },
  pad: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignSelf: "center", width: "100%", maxWidth: 320 },
  key: { width: "33.33%", height: 78, alignItems: "center", justifyContent: "center" },
  keyBtn: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, shadowColor: "#0C2344", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  keyDel: { backgroundColor: "transparent", borderWidth: 0, shadowOpacity: 0, elevation: 0 },
  keyPressed: { backgroundColor: colors.gold100, transform: [{ scale: 0.95 }] },
  keyText: { color: colors.navy900, fontSize: 26 },
  help: { color: colors.navy600, fontSize: 13, textAlign: "center", marginTop: space.sm },
});
