import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Children, cloneElement, isValidElement, useEffect, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
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
import { useSafeAreaInsets, type Edge } from "react-native-safe-area-context";
import { useConnection } from "@/lib/connection";
import { notifyEdit } from "@/lib/form-activity";
import { label as labelOf } from "@/lib/format";
import { colors, compact, control, fonts, fs, radius, shadow, space, statusColors } from "@/theme";

/* ───────────────────────── Text ───────────────────────── */

type Weight = "regular" | "medium" | "semibold" | "bold";
export function Text({ weight = "regular", style, ...p }: TextProps & { weight?: Weight }) {
  return <RNText {...p} style={[styles.text, { fontFamily: fonts[weight] }, compact ? scaleType(style) : style]} />;
}

/** On compact phones every explicit font size is shrunk a little (see fs() in the theme); a set line height follows it. */
function scaleType(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const flat = StyleSheet.flatten(style);
  if (!flat || typeof flat.fontSize !== "number") return style;
  const size = fs(flat.fontSize);
  return [style, { fontSize: size, ...(typeof flat.lineHeight === "number" ? { lineHeight: Math.round((flat.lineHeight * size) / flat.fontSize) } : null) }];
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
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  /** Main actions pinned to the bottom of the screen (above the safe area), outside the scrolling content. */
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const top = edges.includes("top") ? insets.top : 0;
  const bottom = edges.includes("bottom") ? insets.bottom : 0;
  const body = { paddingBottom: footer ? space.xl : space.xl * 2 + bottom };

  // Every screen starts with the navy header (BrandHeader on the tabs, TopBar on the pushed pages). It is taken out of
  // the scrolling area and pinned under the status bar, so it stays in place while the content scrolls beneath it.
  const parts = Children.toArray(children);
  const first = parts[0];
  const pinned = isValidElement(first) && (first.type === BrandHeader || first.type === TopBar) ? (first as ReactElement<HeaderProps>) : null;
  const content = pinned ? parts.slice(1) : children;
  const inner = [styles.screenContent, pinned ? styles.contentUnderHeader : null, body, contentStyle];

  return (
    <View style={styles.screen}>
      {/* The status-bar area is navy, continuing into the navy header band of each screen. */}
      {top > 0 ? <View style={{ height: top, backgroundColor: colors.navy900 }} /> : null}
      {pinned ? cloneElement(pinned, { fixed: true }) : null}
      <ConnectionStrip />
      {scroll ? (
        <ScrollView
          contentContainerStyle={inner}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.gold500} colors={[colors.navy700]} /> : undefined}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={[inner, { flex: 1 }]}>{content}</View>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: space.md + bottom }]}>{footer}</View> : null}
    </View>
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

/** Round avatar with the person's initials (there are no photos in the data). */
export function Avatar({ name, size = 44, tint }: { name: string; size?: number; tint?: string }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts.length > 0 ? parts[0].charAt(0) : "";
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  const initials = (first + last).toUpperCase() || "?";
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint ?? colors.navy50, alignItems: "center", justifyContent: "center" }}>
      <Text weight="bold" style={{ color: colors.navy700, fontSize: size * 0.36 }}>{initials}</Text>
    </View>
  );
}

/** Set by Screen when it pins the header above the scrolling content (the header then has no negative margins to cancel the page padding). */
type HeaderProps = { fixed?: boolean };

/** Navy header band used at the top of each tab. Its bottom edge is a light panel with rounded top corners. */
export function BrandHeader({ title, subtitle, right, fixed }: { title: string; subtitle?: string; right?: ReactNode } & HeaderProps) {
  return (
    <View style={[styles.brandHeader, fixed && styles.headerFixed]}>
      {/* Decorative depth: soft rings in the corner */}
      <View pointerEvents="none" style={styles.ringLarge} />
      <View pointerEvents="none" style={styles.ringSmall} />
      <View style={[styles.headerRow, { justifyContent: "space-between" }]}>
        <Row gap={space.md} style={{ flex: 1 }}>
          <View style={styles.logoRing}><Logo size={compact ? 40 : 44} /></View>
          <View style={{ flex: 1 }}>
            <Text weight="bold" style={{ color: colors.white, fontSize: 19, letterSpacing: -0.3 }} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text weight="medium" style={{ color: colors.gold300, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
        </Row>
        {right}
      </View>
      <View style={styles.panelCap} />
    </View>
  );
}

/** Top bar for pushed screens: white back arrow and a centred white title on the navy band. */
export function TopBar({ title, onBack, right, fixed }: { title: string; onBack: () => void; right?: ReactNode } & HeaderProps) {
  return (
    <View style={[styles.topBar, fixed && styles.headerFixed]}>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back" style={styles.topBack}>
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text weight="bold" style={styles.topTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.topRight}>{right}</View>
      </View>
      <View style={styles.panelCap} />
    </View>
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
          {icon ? <Ionicons name={icon} size={small ? 15 : compact ? 17 : 18} color={v.fg} /> : null}
          {/* One line: it shrinks a little to fit (Android/iOS) instead of wrapping into a taller button. */}
          <Text weight="semibold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: v.fg, fontSize: small ? 13 : 15, letterSpacing: 0.2, flexShrink: 1 }}>{title}</Text>
        </Row>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.gold500, fg: colors.navy950, border: colors.gold500 },
  gold: { bg: colors.gold500, fg: colors.navy950, border: colors.gold500 },
  ghost: { bg: colors.white, fg: colors.navy800, border: "#D5DAEA" },
  danger: { bg: colors.dangerBg, fg: colors.danger, border: colors.dangerBg },
};

/** A cream tile with a gold icon, for a grid of actions (Reschedule, Sell package, …). Put tiles inside a TileGrid. */
export function ActionTile({ icon, title, onPress, danger, disabled }: { icon: ComponentProps<typeof Ionicons>["name"]; title: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.tile, danger && styles.tileDanger, pressed && !disabled && { opacity: 0.85 }, disabled && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={compact ? 24 : 26} color={danger ? colors.danger : colors.gold700} />
      <Text weight="semibold" style={{ fontSize: 12, textAlign: "center", color: danger ? colors.danger : colors.navy800 }} numberOfLines={2}>{title}</Text>
    </Pressable>
  );
}

/**
 * Tiles side by side that always fill their row: up to three per row (four become 2 × 2), and a last row with
 * fewer tiles stretches to the full width, so there is never a blank gap or a lone tile.
 * Each row is its own flex row whose tiles share the width equally (flex: 1). Widths are never worked out in
 * code: tiles sized to an exact third plus gaps came out a fraction of a pixel too wide on real phones,
 * and the third tile of each row dropped to the next line.
 */
export function TileGrid({ children, gap = space.sm, maxCols }: { children: ReactNode; gap?: number; maxCols?: number }) {
  const items = Children.toArray(children);
  const cols = Math.max(1, Math.min(items.length, maxCols ?? (items.length === 4 ? 2 : 3)));
  const rows: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View style={{ gap }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap }}>
          {row.map((c, i) => (
            <View key={i} style={{ flex: 1 }}>
              {c}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text weight="semibold" style={{ fontSize: 13, color: colors.navy700 }}>{label}</Text>
      {children}
      {error ? <Text style={{ fontSize: 12, color: colors.danger, fontWeight: "500" }}>{error}</Text> : hint ? <Muted style={{ fontSize: 12 }}>{hint}</Muted> : null}
    </View>
  );
}

export function Input(props: TextInputProps) {
  const { onChangeText, onFocus, onBlur } = props;
  const [focused, setFocused] = useState(false);
  const changed = (t: string) => {
    notifyEdit(); // clears the previous failed-submit error
    if (onChangeText) onChangeText(t);
  };
  return (
    <TextInput
      placeholderTextColor="#A3A9C4"
      selectionColor={colors.navy600}
      {...props}
      onChangeText={changed}
      onFocus={(e) => {
        setFocused(true);
        if (onFocus) onFocus(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        if (onBlur) onBlur(e);
      }}
      style={[styles.input, focused && styles.inputFocused, props.multiline && { minHeight: 84, textAlignVertical: "top" }, props.style]}
    />
  );
}

/**
 * Choice chips. Two to four short choices read as a segmented control (like Overview | Finance);
 * longer or wordier lists wrap as pills.
 */
export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const many = options.length >= 5;
  const segmented = options.length >= 2 && options.length <= 5 && options.every((o) => o.label.length <= (many ? 11 : 18));
  // Segments are as wide as their label plus an equal share of the spare room, so "Done / cancelled" is never cut while "All" sits in a wide empty slot.
  return (
    <View style={segmented ? styles.segment : { flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={segmented ? [styles.segmentItem, on && styles.segmentOn] : [styles.chip, on && styles.chipOn]}
          >
            <Text weight={on ? "semibold" : "medium"} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: segmented && many ? 11.5 : 13, color: on ? colors.white : colors.navy800 }}>{o.label}</Text>
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
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text weight="semibold" style={{ color: c.fg, fontSize: 11 }}>{text ?? labelOf(status)}</Text>
    </View>
  );
}

/**
 * Thin notice under the header while the connection is weak. It appears only after a request has waited 5 seconds
 * (so a normal load never flashes it) and tells the person the app is still working, not frozen.
 */
function ConnectionStrip() {
  const state = useConnection((s) => s.state);
  if (state === "ok") return null;
  const offline = state === "offline";
  return (
    <View accessibilityRole="alert" style={[styles.strip, { backgroundColor: offline ? colors.dangerBg : colors.warningBg }]}>
      {offline ? <Ionicons name="cloud-offline-outline" size={16} color={colors.danger} /> : <ActivityIndicator size="small" color={colors.warning} />}
      <Text weight="semibold" style={{ flex: 1, fontSize: 12, color: offline ? colors.danger : colors.warning }}>
        {offline ? "No internet. Check your connection." : "Slow connection. Still loading, please wait."}
      </Text>
    </View>
  );
}

/** A soft pulsing block that stands in for content while it loads. */
export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: ViewStyle["width"]; style?: StyleProp<ViewStyle> }) {
  const [pulse] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ height, width, borderRadius: 8, backgroundColor: colors.navy100, opacity: pulse }, style]} />;
}

/**
 * Card-shaped placeholders for a list that is loading. The screen shows its final shape straight away
 * and fills in, which feels much quicker than a lone spinner on a slow connection.
 */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading" style={{ gap: SCREEN_GAP }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.card, { gap: space.md }]}>
          <Skeleton height={14} width="32%" />
          <Skeleton height={18} width="72%" />
          <Skeleton height={14} width="48%" />
        </View>
      ))}
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
    // The label keeps up to half the row; the value takes the rest (right-aligned) and wraps only when it has to.
    <Row gap={space.md} style={{ justifyContent: "space-between", paddingVertical: 4, alignItems: "flex-start" }}>
      <Muted style={{ maxWidth: "50%" }}>{k}</Muted>
      {typeof v === "string" || typeof v === "number" ? <Text weight="semibold" style={[{ fontSize: 14, flex: 1, textAlign: "right" }, vStyle]}>{v}</Text> : v}
    </Row>
  );
}

/** Space between the blocks of a screen; the navy header band pulls back all but 4 of it so the page looks the same on every phone. */
const SCREEN_GAP = compact ? space.md : space.lg;

const styles = StyleSheet.create({
  text: { color: colors.text, fontSize: fs(14) },
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: space.lg, gap: SCREEN_GAP, paddingBottom: space.xl * 2 },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: compact ? 14 : 18, borderWidth: 1, borderColor: colors.border, gap: space.sm, ...shadow },
  cardGold: { backgroundColor: "#FCF8EC", borderColor: colors.gold300 },
  // Full-width navy band under the (navy) status bar; it cancels the screen's own padding to reach the edges.
  // Its bottom edge is a light panel cap with rounded top corners, so the page below reads as a sheet sliding up over the navy.
  brandHeader: { backgroundColor: colors.navy900, marginHorizontal: -space.lg, marginTop: -space.lg, marginBottom: 4 - SCREEN_GAP, paddingHorizontal: space.lg, paddingTop: space.md, overflow: "hidden" },
  topBar: { backgroundColor: colors.navy900, marginHorizontal: -space.lg, marginTop: -space.lg, marginBottom: 4 - SCREEN_GAP, paddingHorizontal: space.lg, paddingTop: space.sm, overflow: "hidden" },
  // A pinned header sits outside the padded page, so it needs no negative margins; the content starts just under its light panel cap.
  headerFixed: { marginHorizontal: 0, marginTop: 0, marginBottom: 0 },
  contentUnderHeader: { paddingTop: 4 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingBottom: compact ? space.sm : space.md },
  // The header is pinned now, so every pixel of it is permanent: a slightly slimmer rounded cap on compact phones.
  panelCap: { height: compact ? 18 : 24, marginHorizontal: -space.lg, backgroundColor: colors.bg, borderTopLeftRadius: compact ? 20 : 26, borderTopRightRadius: compact ? 20 : 26 },
  ringLarge: { position: "absolute", right: -60, top: -70, width: 190, height: 190, borderRadius: 95, borderWidth: 28, borderColor: "rgba(255,255,255,0.04)" },
  ringSmall: { position: "absolute", right: 40, bottom: -50, width: 90, height: 90, borderRadius: 45, backgroundColor: "rgba(201,161,74,0.08)" },
  logoRing: { padding: 3, borderRadius: 26, borderWidth: 1.5, borderColor: "rgba(229,198,127,0.7)" },
  topTitle: { flex: 1, textAlign: "center", color: colors.white, fontSize: 18, letterSpacing: -0.2 },
  topBack: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topRight: { minWidth: 40, minHeight: 40, alignItems: "flex-end", justifyContent: "center" },
  button: { borderRadius: radius.md + 2, paddingVertical: compact ? 11 : 14, paddingHorizontal: compact ? 14 : 20, borderWidth: 1, alignItems: "center", justifyContent: "center", minHeight: control.minHeight },
  buttonLift: { shadowColor: "#C9A14A", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  input: {
    backgroundColor: colors.field,
    borderWidth: 1.5,
    borderColor: "#D6DDE8",
    borderRadius: radius.md,
    paddingHorizontal: control.padH,
    paddingVertical: control.padV,
    minHeight: control.minHeight,
    fontSize: fs(15),
    color: colors.text,
    fontFamily: fonts.regular,
  },
  inputFocused: { backgroundColor: colors.white, borderColor: colors.navy500 },
  chip: { paddingHorizontal: compact ? 12 : 16, paddingVertical: compact ? 8 : 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.navy800, borderColor: colors.navy800 },
  footer: { backgroundColor: colors.white, paddingHorizontal: space.lg, paddingTop: space.md, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, gap: space.sm, shadowColor: "#0C2344", shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: -4 }, elevation: 10 },
  tile: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: compact ? space.md : space.lg, paddingHorizontal: 6, borderRadius: radius.lg, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.creamBorder },
  tileDanger: { backgroundColor: colors.dangerBg, borderColor: "rgba(225,29,72,0.2)" },
  segment: { flexDirection: "row", width: "100%", backgroundColor: colors.navy50, borderRadius: radius.md + 2, padding: 3, gap: 3 },
  segmentItem: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", paddingVertical: compact ? 9 : 10, paddingHorizontal: compact ? 8 : 6, borderRadius: radius.md - 1, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: colors.navy800 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: compact ? 8 : 10, paddingVertical: compact ? 3 : 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  strip: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 6 },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: "rgba(225,29,72,0.25)" },
  emptyIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.gold100, alignItems: "center", justifyContent: "center" },
});
