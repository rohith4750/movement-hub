/** Movement Hub brand theme — deep navy + gold, tuned for a crisp, corporate look. */
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
  bg: "#F2F4F9",
  white: "#FFFFFF",
  text: "#0A1033",
  muted: "#5D6487",
  border: "#E3E6EF",
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

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const shadow = {
  shadowColor: "#0A1033",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
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
};
