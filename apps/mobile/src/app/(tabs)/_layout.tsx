import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { hasRole, useAuth } from "@/lib/auth";
import { colors, fonts } from "@/theme";

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
  if (status !== "signedIn") return <Redirect href="/login" />;

  const show = (ok: boolean) => (ok ? undefined : null); // href: null hides a tab
  const visits = hasRole(user, "ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST");
  const sessions = hasRole(user, "ADMIN", "PHYSIOTHERAPIST");
  const patients = hasRole(user, "ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST", "ACCOUNTANT");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navy800,
        tabBarInactiveTintColor: "#9AA1C2",
        tabBarActiveBackgroundColor: colors.gold100,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.1 },
        tabBarStyle: { backgroundColor: colors.white, borderTopWidth: 0, paddingTop: 8, borderTopLeftRadius: 26, borderTopRightRadius: 26, elevation: 16, shadowColor: "#1C2670", shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: -6 } },
        tabBarItemStyle: { borderRadius: 18, marginHorizontal: 4, marginBottom: 2 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Today", tabBarIcon: TodayIcon }} />
      <Tabs.Screen name="appointments" options={{ title: "Visits", tabBarIcon: VisitsIcon, href: show(visits) }} />
      <Tabs.Screen name="patients" options={{ title: "Patients", tabBarIcon: PatientsIcon, href: show(patients) }} />
      <Tabs.Screen name="sessions" options={{ title: "Sessions", tabBarIcon: SessionsIcon, href: show(sessions) }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: MoreIcon }} />
    </Tabs>
  );
}
