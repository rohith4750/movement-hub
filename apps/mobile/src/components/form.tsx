/**
 * Shared form & layout controls for the staff app (dropdown picker, date picker, bottom sheet,
 * menu rows, role guard). Every screen uses these so the app looks and behaves the same everywhere.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import RNDateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import { useState, type ComponentProps, type ReactNode } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { hasRole, useAuth, type Role } from "@/lib/auth";
import { ageFrom, date as fmtDate, dobFromAge } from "@/lib/format";
import { useTherapists } from "@/lib/queries";
import { colors, radius, shadow, space } from "@/theme";
import { Button, Caption, Empty, Field, H2, Input, Muted, Row, Screen, Text, TopBar } from "./ui";

type IconName = ComponentProps<typeof Ionicons>["name"];

/* ───────────────────────── Bottom sheet ───────────────────────── */

/** Modal sheet that slides up from the bottom. Scrollable body, keyboard-aware. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.grabber} />
          <Row style={{ justifyContent: "space-between", paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            <H2 style={{ flex: 1 }} numberOfLines={1}>{title}</H2>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.navy700} />
            </Pressable>
          </Row>
          <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ───────────────────────── Select (dropdown) ───────────────────────── */

export interface Option<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

/** Tap-to-open option list (works the same on iOS and Android). Optional search for long lists. */
export function SelectField<T extends string = string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  searchable,
  disabled,
  hint,
}: {
  label: string;
  value: T | "" | null | undefined;
  options: Option<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);
  const list = q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <View style={{ gap: 6 }}>
      <Caption>{label}</Caption>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        style={[styles.field, disabled && { opacity: 0.5 }]}
      >
        <Text style={{ flex: 1, color: current ? colors.text : "#9AA0C3" }} numberOfLines={1}>{current?.label ?? placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      {hint ? <Muted style={{ fontSize: 12 }}>{hint}</Muted> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.selectBox} pointerEvents="box-none">
          <View style={styles.selectCard}>
            <Row style={{ justifyContent: "space-between", marginBottom: space.sm }}>
              <H2 style={{ flex: 1 }}>{label}</H2>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.navy700} />
              </Pressable>
            </Row>
            {searchable ? <Input value={q} onChangeText={setQ} placeholder="Search" autoCorrect={false} style={{ marginBottom: space.sm }} /> : null}
            <FlatList
              data={list}
              keyExtractor={(o) => o.value}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Muted style={{ padding: space.md }}>No options</Muted>}
              renderItem={({ item }) => {
                const on = item.value === value;
                return (
                  <Pressable
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                      setQ("");
                    }}
                    style={[styles.option, on && { backgroundColor: colors.gold100 }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text weight={on ? "semibold" : "regular"}>{item.label}</Text>
                      {item.hint ? <Muted style={{ fontSize: 12 }}>{item.hint}</Muted> : null}
                    </View>
                    {on ? <Ionicons name="checkmark" size={18} color={colors.navy700} /> : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ───────────────────────── Date picker ───────────────────────── */

const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
};

/** Date field storing "YYYY-MM-DD". Native date dialog on Android, inline calendar sheet on iOS. */
/**
 * Date of birth + age, kept in sync: picking a date fills the age, typing an age sets an
 * approximate date of birth (today's day and month, N years back). Only the date is saved.
 */
export function DobAgeFields({ dob, onDob, clearable }: { dob: string; onDob: (v: string) => void; clearable?: boolean }) {
  const [age, setAge] = useState(() => (dob ? String(ageFrom(dob) ?? "") : ""));
  const maxDate = new Date();
  return (
    <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
      <View style={{ flex: 2 }}>
        <DateField
          label="Date of birth"
          value={dob}
          onChange={(v) => {
            onDob(v);
            setAge(v ? String(ageFrom(v) ?? "") : "");
          }}
          maximumDate={maxDate}
          clearable={clearable}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Field label="Age (years)">
          <Input
            value={age}
            onChangeText={(t) => {
              const digits = t.replace(/\D/g, "").slice(0, 3);
              const n = digits === "" ? null : Math.min(Number(digits), 120);
              setAge(n === null ? "" : String(n));
              onDob(n === null ? "" : dobFromAge(n));
            }}
            keyboardType="number-pad"
            maxLength={3}
            placeholder="e.g. 34"
          />
        </Field>
      </View>
    </Row>
  );
}

export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  placeholder = "Pick a date",
  clearable,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  placeholder?: string;
  clearable?: boolean;
}) {
  const [iosOpen, setIosOpen] = useState(false);
  const [iosValue, setIosValue] = useState<Date>(new Date());
  const current = value ? fromYmd(value) : new Date();

  const open = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: current,
        mode: "date",
        minimumDate,
        maximumDate,
        onValueChange: (_e, d) => d && onChange(toYmd(d)),
      });
    } else {
      setIosValue(current);
      setIosOpen(true);
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Caption>{label}</Caption>
      <Row gap={space.sm}>
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${label}: ${value ? fmtDate(`${value}T06:00:00Z`) : placeholder}`} style={[styles.field, { flex: 1 }]}>
          <Ionicons name="calendar-outline" size={18} color={colors.muted} />
          <Text style={{ flex: 1, color: value ? colors.text : "#9AA0C3" }}>{value ? fmtDate(`${value}T06:00:00Z`) : placeholder}</Text>
        </Pressable>
        {clearable && value ? (
          <Pressable onPress={() => onChange("")} hitSlop={8} accessibilityLabel={`Clear ${label}`}>
            <Ionicons name="close-circle" size={22} color={colors.muted} />
          </Pressable>
        ) : null}
      </Row>
      {Platform.OS !== "android" ? (
        <Sheet
          open={iosOpen}
          onClose={() => setIosOpen(false)}
          title={label}
          footer={
            <Button
              title="Done"
              onPress={() => {
                onChange(toYmd(iosValue));
                setIosOpen(false);
              }}
            />
          }
        >
          <RNDateTimePicker value={iosValue} mode="date" display="inline" minimumDate={minimumDate} maximumDate={maximumDate} onValueChange={(_e, d) => d && setIosValue(d)} />
        </Sheet>
      ) : null}
    </View>
  );
}

/* ───────────────────────── Menu rows & sections ───────────────────────── */

/** Tappable row with icon, title, subtitle and chevron — for menus and simple lists. */
export function ListRow({ icon, title, subtitle, onPress, right, danger }: { icon?: IconName; title: string; subtitle?: string; onPress?: () => void; right?: ReactNode; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} style={({ pressed }) => [styles.listRow, pressed && onPress && { opacity: 0.85 }]}>
      {icon ? (
        <View style={[styles.listIcon, danger && { backgroundColor: colors.dangerBg }]}>
          <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.navy800} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="semibold" style={{ fontSize: 15, color: danger ? colors.danger : colors.text }} numberOfLines={1}>{title}</Text>
        {subtitle ? <Muted style={{ fontSize: 12 }} numberOfLines={2}>{subtitle}</Muted> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null)}
    </Pressable>
  );
}

/** Section heading used to group content on long screens. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Row style={{ justifyContent: "space-between", marginTop: space.xs }}>
      <Row gap={8}>
        <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: colors.gold500 }} />
        <Text weight="bold" style={{ fontSize: 12, letterSpacing: 1.2, color: colors.navy700, textTransform: "uppercase" }}>{children}</Text>
      </Row>
      {action}
    </Row>
  );
}

/* ───────────────────────── Role guard ───────────────────────── */

/**
 * Wrap a screen's content: users without one of the roles see a friendly "not available" page
 * instead of API errors. (The API enforces the same rules.)
 */
export function RequireRole({ roles, title, children }: { roles: Role[]; title: string; children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (hasRole(user, ...roles)) return <>{children}</>;
  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title={title} onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      <Empty icon="lock-closed-outline" title="Not available for your role" message="Ask an admin if you need access to this." />
    </Screen>
  );
}

/** Standard back handler for pushed screens. */
export const goBack = (fallback: Parameters<typeof router.replace>[0] = "/") => (router.canGoBack() ? router.back() : router.replace(fallback));

/** Simple stat tile used on dashboards and reports. */
export function StatTile({ label, value, hint, good }: { label: string; value: string | number; hint?: string; good?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text weight="semibold" style={{ fontSize: 10, color: colors.muted, letterSpacing: 0.8, textTransform: "uppercase" }}>{label}</Text>
      <Text weight="bold" style={{ fontSize: 22, color: good ? colors.success : colors.navy900, letterSpacing: -0.3 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Muted style={{ fontSize: 10 }} numberOfLines={1}>{hint}</Muted> : null}
    </View>
  );
}

/** Horizontal bar list (reports). */
export function Bars({ rows }: { rows: { label: string; value: number; display?: string; color?: string | null }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <Muted>No data for this period.</Muted>;
  return (
    <View style={{ gap: space.sm }}>
      {rows.map((r) => (
        <View key={r.label} style={{ gap: 4 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text style={{ fontSize: 12, flex: 1 }} numberOfLines={1}>{r.label}</Text>
            <Text weight="semibold" style={{ fontSize: 12 }}>{r.display ?? r.value}</Text>
          </Row>
          <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.navy50, overflow: "hidden" }}>
            <View style={{ width: `${(r.value / max) * 100}%`, height: "100%", borderRadius: radius.pill, backgroundColor: r.color ?? colors.navy700 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(5,10,36,0.55)" },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%", ...shadow },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.navy100, marginVertical: space.sm },
  sheetFooter: { padding: space.lg, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.white },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 46,
  },
  selectBox: { flex: 1, justifyContent: "center", padding: space.lg },
  selectCard: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space.lg, maxHeight: "75%", ...shadow },
  option: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 12, paddingHorizontal: space.sm, borderRadius: radius.sm },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, ...shadow },
  listIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.navy50, alignItems: "center", justifyContent: "center" },
  stat: { flexBasis: "47%", flexGrow: 1, backgroundColor: colors.white, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.navy700, gap: 2, ...shadow },
});


/** The signed-in physio's own therapist id (null for other roles) — the default regular physio for new patients. */
export const useOwnTherapistId = () => useAuth((s) => (s.user?.role === "PHYSIOTHERAPIST" ? s.user.therapistId ?? "" : ""));

/** "Regular physiotherapist" picker. Value "" = none. */
export function RegularPhysioField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const therapists = useTherapists();
  return (
    <SelectField
      label="Regular physiotherapist"
      value={value}
      onChange={onChange}
      placeholder={therapists.isLoading ? "Loading…" : "None"}
      hint="Bookings default to this physio, and they see the patient under My patients."
      options={[{ value: "", label: "None" }, ...(therapists.data ?? []).map((t) => ({ value: t.id, label: t.user.name }))]}
    />
  );
}
