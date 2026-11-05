import { Dimensions } from "react-native";

/** Movement Hub brand theme — blue-navy + gold: navy header bands, a white panel curving up over them, gold actions, light cards. */
export const colors = {
  navy950: "#071A33",
  navy900: "#0C2344",
  navy800: "#102E54",
  navy700: "#173B69",
  navy600: "#245089",
  navy500: "#3F6CA8",
  navy100: "#D6E0EE",
  navy50: "#EEF2F8",
  gold700: "#94702A",
  /** Gold used for active icons and links on white (darker than gold500 so it stays readable). */
  gold600: "#B08A33",
  gold500: "#C9A14A",
  gold300: "#E5C67F",
  gold100: "#F7EFDC",
  /** Warm cream for quick-action tiles and highlighted cards. */
  cream: "#FDF8EA",
  creamBorder: "#EFE5C8",
  bg: "#F8F9FB",
  white: "#FFFFFF",
  /** Input / select background. */
  field: "#FFFFFF",
  text: "#0C2344",
  muted: "#55657D",
  border: "#E3E8F0",
  /** Hairlines inside a card (table rows, dividers): lighter than a card's outline. */
  divider: "#EDF0F5",
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

/**
 * Most Android phones are 360–393 dp wide. Below 400 dp the layout is a little tighter (less padding and gap,
 * type about 6% smaller) so labels and names stay on one line instead of wrapping, and less of the screen is blank.
 * Read once at start-up: the app is portrait only.
 */
export const compact = Dimensions.get("window").width < 400;

/** Font size for this phone: a bit smaller on compact screens, but never below 11 so captions stay readable. */
export const fs = (size: number) => (compact && size > 11 ? Math.max(11, Math.round(size * 0.94 * 2) / 2) : size);

/** Rounded corners: small controls 10–12, cards 16, hero headers 24, pills fully round. */
export const radius = { sm: 10, md: 12, lg: 16, xl: 24, pill: 999 };
export const space = compact ? { xs: 4, sm: 6, md: 10, lg: 14, xl: 20 } : { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

/** Heights shared by buttons, inputs and dropdowns. */
export const control = compact ? { minHeight: 46, padH: 12, padV: 10 } : { minHeight: 52, padH: 16, padV: 12 };

export const shadow = {
  shadowColor: "#0C2344",
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 5 },
  elevation: 2,
};

/** Stronger lift for headers and primary surfaces. */
export const shadowStrong = {
  shadowColor: "#071A33",
  shadowOpacity: 0.18,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 6,
};

/** Status → badge colours (mirrors the web StatusBadge). */
export const statusColors: Record<string, { bg: string; fg: string }> = {
  SCHEDULED: { bg: colors.navy50, fg: colors.navy600 },
  CONFIRMED: { bg: "#E6EEF9", fg: "#1D4B93" },
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
  NEW: { bg: "#E3F4E5", fg: "#1F7A3A" },
  REGULAR: { bg: "#E6EEF9", fg: "#1D4B93" },
  OCCASIONAL: { bg: "#FBEFD2", fg: "#9A6B12" },
  WALK_IN: { bg: "#FCE9E6", fg: "#B4453A" },
  FINAL: { bg: colors.successBg, fg: colors.success },
};
