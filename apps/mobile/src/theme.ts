/** Movement Hub brand theme — deep navy + gold: formal and official (square 4px corners, solid borders, flat surfaces). */
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
  bg: "#E8EBF4",
  white: "#FFFFFF",
  text: "#0A1033",
  muted: "#454D70",
  border: "#8D96B8",
  /** Hairlines inside a card (table rows, dividers): lighter than a card's outline. */
  divider: "#C3C9DD",
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

/** Every corner is 4px (circles — avatars, dots — set their own size/2). */
export const radius = { sm: 12, md: 12, lg: 12, xl: 12, pill: 12 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const shadow = {
  shadowColor: "#0A1033",
  shadowOpacity: 0.08,
  shadowRadius: 3,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
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
