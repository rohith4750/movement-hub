import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { label as labelOf } from "@/lib/format";
import { colors, fonts, radius, shadow, shadowStrong, space, statusColors } from "@/theme";

/* ───────────────────────── Text ───────────────────────── */

type Weight = "regular" | "medium" | "semibold" | "bold";
export function Text({ weight = "regular", style, ...p }: TextProps & { weight?: Weight }) {
  return <RNText {...p} style={[styles.text, { fontFamily: fonts[weight] }, style]} />;
}

export const H1 = (p: TextProps) => <Text weight="bold" {...p} style={[{ fontSize: 24, color: colors.navy900, letterSpacing: -0.3 }, p.style]} />;
export const H2 = (p: TextProps) => <Text weight="bold" {...p} style={[{ fontSize: 17, color: colors.navy900, letterSpacing: -0.2 }, p.style]} />;
export const Muted = (p: TextProps) => <Text {...p} style={[{ fontSize: 13, color: colors.muted }, p.style]} />;
export const Caption = (p: TextProps) => (
  <Text weight="semibold" {...p} style={[{ fontSize: 11, color: colors.muted, letterSpacing: 0.9, textTransform: "uppercase" }, p.style]} />
);

/* ───────────────────────── Layout ───────────────────────── */

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  edges = ["top"],
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.screenContent, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.gold500} colors={[colors.navy700]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, { flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style, gold }: { children: ReactNode; style?: StyleProp<ViewStyle>; gold?: boolean }) {
  return <View style={[styles.card, gold && styles.cardGold, style]}>{children}</View>;
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginVertical: space.sm }} />;
}

/* ───────────────────────── Brand ───────────────────────── */

export function Logo({ size = 44 }: { size?: number }) {
  return <Image source={require("@/assets/images/logo.png")} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="contain" accessibilityLabel="Movement Hub logo" />;
}

/** Navy header band used at the top of each tab. */
export function BrandHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.brandHeader}>
      {/* Decorative depth: soft rings in the corner and a gold rule along the bottom */}
      <View pointerEvents="none" style={styles.ringLarge} />
      <View pointerEvents="none" style={styles.ringSmall} />
      <Row style={{ justifyContent: "space-between" }}>
        <Row gap={space.md} style={{ flex: 1 }}>
          <View style={styles.logoRing}><Logo size={40} /></View>
          <View style={{ flex: 1 }}>
            <Text weight="bold" style={{ color: colors.white, fontSize: 20, letterSpacing: -0.3 }} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text weight="medium" style={{ color: colors.gold300, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
        </Row>
        {right}
      </Row>
      <View pointerEvents="none" style={styles.goldRule} />
    </View>
  );
}

/** Simple top bar for pushed screens (with back button). */
export function TopBar({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <Row style={styles.topBar}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back" style={styles.iconBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.navy900} />
      </Pressable>
      <H2 style={{ flex: 1, fontSize: 19 }} numberOfLines={1}>{title}</H2>
      {right}
    </Row>
  );
}

/* ───────────────────────── Controls ───────────────────────── */

type Variant = "primary" | "gold" | "ghost" | "danger";
export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  style,
  small,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ComponentProps<typeof Ionicons>["name"];
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const v = buttonVariants[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        small && { paddingVertical: 8, paddingHorizontal: 12, minHeight: 36, borderRadius: radius.sm },
        { backgroundColor: v.bg, borderColor: v.border },
        variant === "primary" && !small && styles.buttonLift,
        pressed && !off && { opacity: 0.88, transform: [{ scale: 0.99 }] },
        off && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} size="small" />
      ) : (
        <Row gap={6} style={{ justifyContent: "center" }}>
          {icon ? <Ionicons name={icon} size={small ? 15 : 18} color={v.fg} /> : null}
          <Text weight="semibold" style={{ color: v.fg, fontSize: small ? 13 : 15, letterSpacing: 0.2 }}>{title}</Text>
        </Row>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.navy800, fg: colors.white, border: colors.navy800 },
  gold: { bg: colors.gold500, fg: colors.navy950, border: colors.gold500 },
  ghost: { bg: colors.white, fg: colors.navy800, border: colors.border },
  danger: { bg: colors.white, fg: colors.danger, border: colors.danger },
};

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Caption>{label}</Caption>
      {children}
      {error ? <Text style={{ fontSize: 12, color: colors.danger, fontWeight: "500" }}>{error}</Text> : hint ? <Muted style={{ fontSize: 12 }}>{hint}</Muted> : null}
    </View>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor="#9AA0BE" selectionColor={colors.navy600} {...props} style={[styles.input, props.multiline && { minHeight: 84, textAlignVertical: "top" }, props.style]} />;
}

/** Horizontal choice chips (segmented control). */
export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.chip, on && { backgroundColor: colors.navy800, borderColor: colors.navy800 }]}
          >
            <Text weight={on ? "semibold" : "medium"} style={{ fontSize: 13, color: on ? colors.white : colors.navy800 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ───────────────────────── Feedback ───────────────────────── */

export function Badge({ status, text }: { status: string; text?: string }) {
  const c = statusColors[status] ?? { bg: "#F1F5F9", fg: "#475569" };
  return (
    // Outlined in its own colour so a status reads clearly, not as a faint pastel chip.
    <View style={[styles.badge, { backgroundColor: c.bg, borderColor: c.fg }]}>
      <Text weight="semibold" style={{ color: c.fg, fontSize: 11 }}>{text ?? labelOf(status)}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ padding: space.xl, alignItems: "center", gap: space.sm }}>
      <ActivityIndicator color={colors.navy800} />
      {label ? <Muted>{label}</Muted> : null}
    </View>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <View style={styles.errorBox}>
      <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
        <Ionicons name="alert-circle" size={18} color={colors.danger} />
        <Text style={{ color: colors.danger, flex: 1, fontSize: 13 }}>{msg}</Text>
      </Row>
      {onRetry ? <Button title="Try again" variant="ghost" small onPress={onRetry} style={{ alignSelf: "flex-start", marginTop: space.sm }} /> : null}
    </View>
  );
}

export function Empty({ icon = "file-tray-outline", title, message, action }: { icon?: ComponentProps<typeof Ionicons>["name"]; title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", padding: space.xl, gap: space.sm }}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.gold700} />
      </View>
      <Text weight="semibold" style={{ fontSize: 15, color: colors.navy900, textAlign: "center" }}>{title}</Text>
      {message ? <Muted style={{ textAlign: "center" }}>{message}</Muted> : null}
      {action}
    </View>
  );
}

export function ProgressBar({ percent, color = colors.gold500 }: { percent: number; color?: string }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.navy50, overflow: "hidden" }}>
      <View style={{ width: `${p}%`, height: "100%", backgroundColor: color, borderRadius: radius.pill }} />
    </View>
  );
}

export function KeyValue({ k, v, vStyle }: { k: string; v: ReactNode; vStyle?: StyleProp<TextStyle> }) {
  return (
    <Row style={{ justifyContent: "space-between", paddingVertical: 4 }}>
      <Muted>{k}</Muted>
      {typeof v === "string" || typeof v === "number" ? <Text weight="semibold" style={[{ fontSize: 14 }, vStyle]}>{v}</Text> : v}
    </Row>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.text, fontSize: 14 },
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border, gap: space.sm, ...shadow },
  cardGold: { borderColor: colors.gold300, borderTopWidth: 3, borderTopColor: colors.gold500 },
  brandHeader: { backgroundColor: colors.navy900, borderRadius: radius.xl, padding: space.lg, paddingVertical: 20, overflow: "hidden", ...shadowStrong },
  ringLarge: { position: "absolute", right: -60, top: -70, width: 190, height: 190, borderRadius: 95, borderWidth: 28, borderColor: "rgba(255,255,255,0.04)" },
  ringSmall: { position: "absolute", right: 40, bottom: -50, width: 90, height: 90, borderRadius: 45, backgroundColor: "rgba(201,161,74,0.08)" },
  goldRule: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: colors.gold500, opacity: 0.9 },
  logoRing: { padding: 2, borderRadius: 24, borderWidth: 1.5, borderColor: "rgba(229,198,127,0.55)" },
  topBar: { paddingVertical: space.sm, gap: space.md },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, ...shadow },
  button: { borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 18, borderWidth: 1, alignItems: "center", justifyContent: "center", minHeight: 48 },
  buttonLift: { shadowColor: "#0A1033", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    fontSize: 15,
    color: colors.text,
    fontFamily: fonts.regular,
  },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.sm, borderWidth: 1, alignSelf: "flex-start" },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.danger },
  emptyIcon: { width: 60, height: 60, borderRadius: 12, backgroundColor: colors.navy50, alignItems: "center", justifyContent: "center" },
});
