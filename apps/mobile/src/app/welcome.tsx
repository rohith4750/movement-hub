import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import { welcome } from "@/lib/welcome";

/** First screen on every app launch: the Movement Hub welcome image, then the PIN sign-in (tap to skip). */
export default function Welcome() {
  useEffect(() => {
    const t = setTimeout(() => {
      welcome.seen = true;
      router.replace("/login");
    }, 2600);
    return () => clearTimeout(t);
  }, []);

  return (
    <Pressable
      style={styles.screen}
      onPress={() => {
        welcome.seen = true;
        router.replace("/login");
      }}
      accessibilityRole="button"
      accessibilityLabel="Movement Hub, physiotherapy and rehab. Tap to continue"
    >
      {/* The picture is shaped like a modern phone; anchoring it to the top means any small difference in screen shape trims only the empty bottom, never the logo. */}
      <Image source={require("@/assets/images/welcome.png")} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FDFBF6" },
});
