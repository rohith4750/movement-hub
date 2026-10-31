import type Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { ListRow, SectionTitle } from "@/components/form";
import { BrandHeader, Muted, Screen } from "@/components/ui";
import { hasRole, useAuth, type Role } from "@/lib/auth";
import { label } from "@/lib/format";
import { space } from "@/theme";

type Item = { href: Href; title: string; subtitle: string; icon: ComponentProps<typeof Ionicons>["name"]; roles: Role[] };

/** Everything that doesn't fit in the tab bar, grouped like the web sidebar and filtered by role. */
const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: "Front desk",
    items: [
      { href: "/patient/new", title: "Add patient", subtitle: "Add a new patient", icon: "person-add-outline", roles: ["ADMIN", "RECEPTIONIST"] },
      { href: "/book", title: "Book appointment", subtitle: "New visit for a patient", icon: "add-circle-outline", roles: ["ADMIN", "RECEPTIONIST"] },
      { href: "/schedule", title: "Schedule", subtitle: "Day grid for all physiotherapists; block slots", icon: "grid-outline", roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"] },
      { href: "/home-visits", title: "Home visits", subtitle: "Visits at patients' homes; GPS check-in", icon: "home-outline", roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"] },
    ],
  },
  {
    title: "Clinical",
    items: [
      { href: "/treatment-plans", title: "Treatment plans", subtitle: "All plans, progress and status", icon: "clipboard-outline", roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"] },
    ],
  },
  {
    title: "Finance",
    items: [
      { href: "/billing", title: "Billing", subtitle: "Invoices, payments, new invoice", icon: "wallet-outline", roles: ["ADMIN", "RECEPTIONIST", "ACCOUNTANT"] },
      { href: "/packages", title: "Packages", subtitle: "Package catalogue and patient packages", icon: "pricetags-outline", roles: ["ADMIN", "RECEPTIONIST", "ACCOUNTANT"] },
      { href: "/reports", title: "Reports", subtitle: "Revenue, visits, utilisation, outstanding", icon: "bar-chart-outline", roles: ["ADMIN", "ACCOUNTANT"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/therapists", title: "Therapists", subtitle: "Physios, schedules, leave, app PINs", icon: "medkit-outline", roles: ["ADMIN", "RECEPTIONIST"] },
      { href: "/staff", title: "Staff", subtitle: "Accounts, roles and app PINs", icon: "people-circle-outline", roles: ["ADMIN"] },
      { href: "/settings", title: "Settings", subtitle: "Fees, GST, slot length, hours", icon: "settings-outline", roles: ["SUPER_ADMIN"] },
    ],
  },
];

export default function More() {
  const user = useAuth((s) => s.user);
  const sections = SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => hasRole(user, ...i.roles)) })).filter((s) => s.items.length);

  return (
    <Screen>
      <BrandHeader title="More" subtitle={`${user?.name ?? ""} · ${label(user?.role)}`} />
      {sections.map((s) => (
        <View key={s.title} style={{ gap: space.sm }}>
          <SectionTitle>{s.title}</SectionTitle>
          {s.items.map((i) => (
            <ListRow key={i.title} icon={i.icon} title={i.title} subtitle={i.subtitle} onPress={() => router.push(i.href)} />
          ))}
        </View>
      ))}
      <View style={{ gap: space.sm }}>
        <SectionTitle>Account</SectionTitle>
        <ListRow icon="person-circle-outline" title="My account" subtitle="Profile, change PIN, sign out" onPress={() => router.push("/me")} />
      </View>
      <Muted style={{ textAlign: "center", fontSize: 12 }}>Movement Hub – Physiotherapy &amp; Rehab · Staff app</Muted>
    </Screen>
  );
}
