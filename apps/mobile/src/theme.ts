/** Movement Hub brand theme — same palette as the web portal. */
export const colors = {
  navy900: "#10143D",
  navy700: "#1B2160",
  navy500: "#2B3483",
  navy100: "#D9DDF2",
  navy50: "#EEF0FA",
  gold700: "#9C7A2F",
  gold500: "#C9A14A",
  gold300: "#E3C27A",
  gold100: "#F6EDD8",
  bg: "#F6F7FB",
  white: "#FFFFFF",
  text: "#10143D",
  muted: "#5B6290",
  border: "#D9DDF2",
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

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const shadow = {
  shadowColor: "#1B2160",
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

/** Status → badge colours (mirrors the web StatusBadge). */
export const statusColors: Record<string, { bg: string; fg: string }> = {
  SCHEDULED: { bg: colors.navy50, fg: colors.navy700 },
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
