import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useWindowDimensions, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hasRole, useAuth } from "@/lib/auth";
import { colors, fonts } from "@/theme";

/**
 * Height of the row that holds the icon and its label (top padding 8 + icon 28 + label 14 + item padding 10 = 60, plus a little air).
 * The tab bar's own default is 49, which is too short for this design: the labels spilled past the bar and
 * ended up underneath the phone's back / home / recents buttons. The phone's navigation-bar inset is added below this row.
 */
const TAB_ROW_HEIGHT = 66;

type IconName = ComponentProps<typeof Ionicons>["name"];
type TabIconProps = { color: ColorValue; size: number; focused: boolean };

function TabIcon({ on, off, color, size, focused }: TabIconProps & { on: IconName; off: IconName }) {
  return <Ionicons name={focused ? on : off} size={size} color={typeof color === "string" ? color : colors.navy700} />;
}

const TodayIcon = (p: TabIconProps) => <TabIcon on="today" off="today-outline" {...p} />;
const VisitsIcon = (p: TabIconProps) => <TabIcon on="calendar" off="calendar-outline" {...p} />;
const SessionsIcon = (p: TabIconProps) => <TabIcon on="pulse" off="pulse-outline" {...p} />;
const PatientsIcon = (p: TabIconProps) => <TabIcon on="people" off="people-outline" {...p} />;
const MoreIcon = (p: TabIconProps) => <TabIcon on="grid" off="grid-outline" {...p} />;

/** Role-based tabs: each staff member only sees what their role can use (same rules as the web). */
export default function TabLayout() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const narrow = width < 340; // the smallest phones: five labels share ~64 dp each, so the text goes one step smaller
  if (status !== "signedIn") return <Redirect href="/login" />;

  const show = (ok: boolean) => (ok ? undefined : null); // href: null hides a tab
  // Physiotherapists get three plain tabs: My day (their patients, one button each), Patients, More.
  // "Visits" and "Sessions" were two lists of the same patients, so their screens now live inside My day.
  const simple = user?.role === "PHYSIOTHERAPIST";
  const visits = !simple && hasRole(user, "ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST");
  const sessions = !simple && hasRole(user, "ADMIN", "PHYSIOTHERAPIST");
  const patients = hasRole(user, "ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST", "ACCOUNTANT");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold600,
        tabBarInactiveTintColor: "#8E95B0",
        // Labels keep one size whatever the phone's "font size" setting is, so they always fit in the bar.
        tabBarAllowFontScaling: false,
        // Three tabs have room for bigger, easier-to-read labels than five.
        tabBarLabelStyle: simple
          ? { fontFamily: fonts.bold, fontSize: 13, lineHeight: 16 }
          : { fontFamily: fonts.semibold, fontSize: narrow ? 10 : 11, lineHeight: 14, letterSpacing: narrow ? 0 : 0.1 },
        tabBarStyle: {
          // An explicit height replaces the default, so the phone's navigation bar (insets.bottom) has to be added here.
          height: TAB_ROW_HEIGHT + (simple ? 4 : 0) + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom,
          backgroundColor: colors.white,
          borderTopWidth: 0,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          elevation: 16,
          shadowColor: "#0C2344",
          shadowOpacity: 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: -6 },
        },
        tabBarItemStyle: { borderRadius: 18 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: simple ? "My day" : "Today", tabBarIcon: TodayIcon }} />
      <Tabs.Screen name="appointments" options={{ title: "Visits", tabBarIcon: VisitsIcon, href: show(visits) }} />
      <Tabs.Screen name="patients" options={{ title: "Patients", tabBarIcon: PatientsIcon, href: show(patients) }} />
      <Tabs.Screen name="sessions" options={{ title: "Sessions", tabBarIcon: SessionsIcon, href: show(sessions) }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: MoreIcon }} />
    </Tabs>
  );
}
