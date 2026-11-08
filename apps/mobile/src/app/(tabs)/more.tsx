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
type Section = { title: string; items: Item[] };

const ITEMS = {
  addPatient: { href: "/patient/new", title: "Add patient", subtitle: "Register a new patient", icon: "person-add-outline", roles: ["ADMIN", "RECEPTIONIST"] },
  planner: { href: "/planner", title: "Day planner", subtitle: "Plan tomorrow's visits", icon: "clipboard-outline", roles: ["ADMIN", "RECEPTIONIST"] },
  book: { href: "/book", title: "Book appointment", subtitle: "New visit or walk-in", icon: "add-circle-outline", roles: ["ADMIN", "RECEPTIONIST"] },
  schedule: { href: "/schedule", title: "Schedule", subtitle: "Day grid and blocked slots", icon: "grid-outline", roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"] },
  homeVisits: { href: "/home-visits", title: "Home visits", subtitle: "Visits at home, GPS check-in", icon: "home-outline", roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"] },
  plans: { href: "/treatment-plans", title: "Treatment plans", subtitle: "Plans, progress and status", icon: "clipboard-outline", roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"] },
  allVisits: { href: "/appointments", title: "All appointments", subtitle: "Any day, every physio's visits", icon: "calendar-outline", roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"] },
  billing: { href: "/billing", title: "Billing", subtitle: "Invoices and payments", icon: "wallet-outline", roles: ["ADMIN", "RECEPTIONIST", "ACCOUNTANT"] },
  packages: { href: "/packages", title: "Packages", subtitle: "Catalogue and patient packages", icon: "pricetags-outline", roles: ["ADMIN", "RECEPTIONIST", "ACCOUNTANT"] },
  reports: { href: "/reports", title: "Reports", subtitle: "Revenue, visits and dues", icon: "bar-chart-outline", roles: ["ADMIN", "ACCOUNTANT"] },
  therapists: { href: "/therapists", title: "Therapists", subtitle: "Physios, leave and app PINs", icon: "medkit-outline", roles: ["ADMIN", "RECEPTIONIST"] },
  staff: { href: "/staff", title: "Staff", subtitle: "Accounts, roles and PINs", icon: "people-circle-outline", roles: ["ADMIN"] },
  settings: { href: "/settings", title: "Settings", subtitle: "Fees, GST, slot length, hours", icon: "settings-outline", roles: ["SUPER_ADMIN"] },
} satisfies Record<string, Item>;

/** Everything that doesn't fit in the tab bar, grouped like the web sidebar and filtered by role. */
const SECTIONS: Section[] = [
  { title: "Front desk", items: [ITEMS.addPatient, ITEMS.planner, ITEMS.book, ITEMS.schedule, ITEMS.homeVisits] },
  { title: "Clinical", items: [ITEMS.plans] },
  { title: "Finance", items: [ITEMS.billing, ITEMS.packages, ITEMS.reports] },
  { title: "Administration", items: [ITEMS.therapists, ITEMS.staff, ITEMS.settings] },
];

/**
 * Physiotherapists: their own work comes first, then the front-desk jobs they also do. Today's patients are on the
 * My day tab and patient search is the Patients tab, so this menu is only for the less frequent jobs.
 */
const THERAPIST_SECTIONS: Section[] = [
  { title: "My work", items: [ITEMS.plans, ITEMS.homeVisits, ITEMS.schedule, ITEMS.allVisits] },
  { title: "Front desk", items: [ITEMS.book, ITEMS.addPatient, ITEMS.planner] },
  { title: "Billing", items: [ITEMS.billing, ITEMS.packages] },
  { title: "Clinic", items: [ITEMS.reports, ITEMS.therapists] },
];

export default function More() {
  const user = useAuth((s) => s.user);
  const base = user?.role === "PHYSIOTHERAPIST" ? THERAPIST_SECTIONS : SECTIONS;
  const sections = base.map((s) => ({ ...s, items: s.items.filter((i) => hasRole(user, ...i.roles)) })).filter((s) => s.items.length);

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
