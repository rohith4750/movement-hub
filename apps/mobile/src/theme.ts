/** Movement Hub brand theme — deep navy + gold, soft and modern: rounded cards, light borders, gentle shadows, airy spacing. */
export const colors = {
  navy950: "#050A24",
  navy900: "#0A1033",
  navy800: "#0E1645",
  navy700: "#121B57",
  navy600: "#1C2670",
  navy500: "#2C378A",
  navy100: "#DCE0F0",
  navy50: "#F0F2F9",
  gold700: "#94702A",
  gold500: "#C9A14A",
  gold300: "#E5C67F",
  gold100: "#F7EFDC",
  bg: "#F3F5FB",
  white: "#FFFFFF",
  /** Filled input / select background (white when focused). */
  field: "#F6F7FC",
  text: "#0A1033",
  muted: "#5A6288",
  border: "#E1E5F1",
  /** Hairlines inside a card (table rows, dividers): lighter than a card's outline. */
  divider: "#ECEFF7",
  danger: "#E11D48",
  dangerBg: "#FFF1F2",
  success: "#047857",
  successBg: "#ECFDF5",
  warning: "#B45309",
  warningBg: "#FFFBEB",
};

export const fonts = {
  regular: "Montserrat_400Regular",
  medium: "Montserrat_500Medium",
  semibold: "Montserrat_600SemiBold",
  bold: "Montserrat_700Bold",
};

/** Soft rounded corners: small controls 10–14, cards 20, hero headers 28, pills fully round. */
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const shadow = {
  shadowColor: "#1C2670",
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 5 },
  elevation: 2,
};

/** Stronger lift for headers and primary surfaces. */
export const shadowStrong = {
  shadowColor: "#050A24",
  shadowOpacity: 0.18,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 6,
};

/** Status → badge colours (mirrors the web StatusBadge). */
export const statusColors: Record<string, { bg: string; fg: string }> = {
  SCHEDULED: { bg: colors.navy50, fg: colors.navy600 },
  CONFIRMED: { bg: "#EFF6FF", fg: "#1D4ED8" },
  CHECKED_IN: { bg: colors.warningBg, fg: colors.warning },
  IN_PROGRESS: { bg: colors.gold100, fg: colors.gold700 },
  COMPLETED: { bg: colors.successBg, fg: colors.success },
  CANCELLED: { bg: colors.dangerBg, fg: colors.danger },
  NO_SHOW: { bg: colors.dangerBg, fg: colors.danger },
  RESCHEDULED: { bg: "#F1F5F9", fg: "#475569" },
  ACTIVE: { bg: colors.successBg, fg: colors.success },
  DRAFT: { bg: "#F1F5F9", fg: "#475569" },
  EXHAUSTED: { bg: "#F1F5F9", fg: "#475569" },
  EXPIRED: { bg: colors.dangerBg, fg: colors.danger },
  ISSUED: { bg: colors.warningBg, fg: colors.warning },
  PARTIALLY_PAID: { bg: colors.gold100, fg: colors.gold700 },
  PAID: { bg: colors.successBg, fg: colors.success },
  REFUNDED: { bg: "#F1F5F9", fg: "#475569" },
  SUCCESS: { bg: colors.successBg, fg: colors.success },
  PENDING: { bg: colors.warningBg, fg: colors.warning },
  FAILED: { bg: colors.dangerBg, fg: colors.danger },
  MISSED: { bg: colors.dangerBg, fg: colors.danger },
  // Patient category and visit source labels
  NEW: { bg: "#EFF6FF", fg: "#1D4ED8" },
  REGULAR: { bg: colors.successBg, fg: colors.success },
  OCCASIONAL: { bg: "#F1F5F9", fg: "#475569" },
  WALK_IN: { bg: colors.gold100, fg: colors.gold700 },
  FINAL: { bg: colors.successBg, fg: colors.success },
};
