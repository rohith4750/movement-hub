import { useRef, type ComponentRef } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { colors, radius } from "@/theme";

export const PIN_LENGTH = 6;

/**
 * 6-box PIN entry. A single hidden TextInput holds the value (so paste, autofill and
 * the numeric keyboard all work); the boxes just show filled / empty dots.
 */
export function PinInput({
  value,
  onChange,
  onComplete,
  autoFocus,
  error,
  accessibilityLabel = "PIN",
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  error?: boolean;
  accessibilityLabel?: string;
}) {
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityRole="none">
      <View style={styles.row}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => {
          const filled = i < value.length;
          const active = i === value.length;
          return (
            <View
              key={i}
              style={[styles.box, active && styles.boxActive, filled && styles.boxFilled, error && styles.boxError]}
            >
              {filled ? <View style={styles.dot} /> : null}
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => {
          const v = t.replace(/\D/g, "").slice(0, PIN_LENGTH);
          onChange(v);
          if (v.length === PIN_LENGTH) onComplete?.(v);
        }}
        keyboardType="number-pad"
        maxLength={PIN_LENGTH}
        autoFocus={autoFocus}
        secureTextEntry
        textContentType="password"
        autoComplete="off"
        accessibilityLabel={accessibilityLabel}
        caretHidden
        style={styles.hidden}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  box: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  boxActive: { borderColor: colors.gold500 },
  boxFilled: { borderColor: colors.navy700, backgroundColor: colors.navy50 },
  boxError: { borderColor: colors.danger },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.navy700 },
  // Kept in the layout (not display:none) so it can receive focus on Android.
  hidden: { position: "absolute", opacity: 0, width: 1, height: 1 },
});
