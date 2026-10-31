"use client";

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity, BarChart3, CalendarClock, CalendarDays, ClipboardList, CreditCard, Home, LayoutDashboard, LogOut, Menu, Package, Settings, Stethoscope, UserCog, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { hasRole, useAuth, type Role } from "@/lib/auth-store";
import { label } from "@/lib/format";

type NavItem = { href: string; label: string; icon: typeof Home; roles: Role[] };

/** Sidebar, grouped the way the clinic works. Sections with no visible items are hidden. */
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST", "ACCOUNTANT"] },
      { href: "/schedule", label: "Schedule", icon: CalendarDays, roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"] },
    ],
  },
  {
    section: "Front desk",
    items: [
      { href: "/appointments", label: "Appointments", icon: CalendarClock, roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST", "PATIENT"] },
      { href: "/patients", label: "Patients", icon: Users, roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST", "ACCOUNTANT"] },
      { href: "/home-visits", label: "Home Visits", icon: Home, roles: ["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"] },
    ],
  },
  {
    section: "Clinical",
    items: [
      { href: "/therapy-sessions", label: "Therapy Sessions", icon: Activity, roles: ["ADMIN", "PHYSIOTHERAPIST", "RECEPTIONIST"] },
      { href: "/treatment-plans", label: "Treatment Plans", icon: ClipboardList, roles: ["ADMIN", "PHYSIOTHERAPIST", "RECEPTIONIST", "PATIENT"] },
    ],
  },
  {
    section: "Finance",
    items: [
      { href: "/billing", label: "Billing", icon: CreditCard, roles: ["ADMIN", "ACCOUNTANT", "RECEPTIONIST", "PATIENT"] },
      { href: "/packages", label: "Packages", icon: Package, roles: ["ADMIN", "RECEPTIONIST", "ACCOUNTANT", "PATIENT"] },
      { href: "/reports", label: "Reports", icon: BarChart3, roles: ["ADMIN", "ACCOUNTANT"] },
    ],
  },
  {
    section: "Administration",
    items: [
      { href: "/therapists", label: "Therapists", icon: Stethoscope, roles: ["ADMIN", "RECEPTIONIST"] },
      { href: "/staff", label: "Staff", icon: UserCog, roles: ["ADMIN"] },
      { href: "/settings", label: "Settings", icon: Settings, roles: ["SUPER_ADMIN"] },
    ],
  },
];

export function Logo({ size = 44 }: { size?: number }) {
  return <Image src="/brand/movement-hub-logo.jpg" alt="Movement Hub" width={size} height={size} className="rounded-full" priority />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, accessToken, refreshToken, clear } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (hydrated && !accessToken) router.replace("/login");
  }, [hydrated, accessToken, router]);
  useEffect(() => setOpen(false), [pathname]);

  if (!hydrated || !user) return null;

  const logout = async () => {
    try {
      await api.post("/auth/logout", { refreshToken });
    } catch {
      /* already logged out */
    }
    clear();
    router.replace("/login");
  };

  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((n) => hasRole(user, ...n.roles)) })).filter((s) => s.items.length);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Fixed sidebar: never scrolls with the page; its own menu scrolls if it is taller than the screen */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 transform flex-col bg-navy-700 text-white transition lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-white/10 p-4">
          <Logo />
          <div>
            <div className="font-bold tracking-wide">MOVEMENT HUB</div>
            <div className="text-[10px] uppercase tracking-widest text-gold-300">Physiotherapy &amp; Rehab</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {sections.map(({ section, items }) => (
            <div key={section} className="mb-2">
              <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-gold-300/80">{section}</div>
              <div className="space-y-0.5">
                {items.map(({ href, label: l, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    aria-current={isActive(href) ? "page" : undefined}
                    className={clsx(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                      isActive(href) ? "bg-gold-500 text-navy-900 shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Icon size={18} /> {l}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Fixed top toolbar */}
        <header className="z-20 flex shrink-0 items-center justify-between border-b border-navy-100 bg-white px-4 py-3 shadow-sm">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu />
          </button>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-semibold">{user.name}</div>
              <div className="text-xs text-navy-500">{label(user.role)}</div>
            </div>
            <button onClick={logout} className="btn-ghost" title="Log out">
              <LogOut size={16} />
            </button>
          </div>
        </header>
        {/* Only this area scrolls */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-4 md:p-6">{children}</div>
        </main>

        {/* Fixed footer */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-navy-100 bg-white px-4 py-2 text-xs text-navy-500">
          <span>© {new Date().getFullYear()} Movement Hub – Physiotherapy &amp; Rehab</span>
          <span className="text-gold-700">Move better. Live better.</span>
        </footer>
      </div>
    </div>
  );
}
