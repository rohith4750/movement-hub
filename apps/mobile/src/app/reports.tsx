import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useMonthlyReport } from "@/lib/queries";
import { qk } from "@/lib/query-keys";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Bars, DateField, goBack, RequireRole, SectionTitle, StatTile } from "@/components/form";
import { Card, ErrorBox, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { hasRole, useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { date, fullName, inr, label, today } from "@/lib/format";
import { colors, space } from "@/theme";

interface Revenue {
  netRevenue: number;
  series: { period: string; method: string; total: number }[];
  byServiceType: { type: string; total: number }[];
}
interface Appts {
  total: number;
  noShowRate: number;
  cancellationRate: number;
  byStatus: { status: string; count: number }[];
  bySource?: { source: "SCHEDULED" | "WALK_IN"; count: number }[];
  completedByTherapist: { name?: string; count: number }[];
}
interface Util {
  therapists: { therapistId: string; name: string; colorTag: string | null; booked: number; available: number; percent: number }[];
}
interface Pkgs {
  sales: { id?: string; name?: string; count: number; revenue: number; sessionsSold: number; sessionsUsed: number }[];
}
interface Outstanding {
  totalDue: number;
  count: number;
  invoices: { id: string; invoiceNo: string; dueAmount: string; issuedAt: string | null; patient: { firstName: string; lastName: string | null; phone: string } }[];
}

/** Clinic reports. Revenue / packages / outstanding: admin + accountant. Visits & utilisation: admin only (same as the API). */
export default function Reports() {
  return (
    <RequireRole roles={["ADMIN", "ACCOUNTANT"]} title="Reports">
      <ReportsScreen />
    </RequireRole>
  );
}

function ReportsScreen() {
  const user = useAuth((s) => s.user);
  const isAdmin = hasRole(user, "ADMIN");
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(() => today());
  const rangeOk = !!from && !!to && from <= to;
  const range = { from, to };

  const revenue = useQuery({ queryKey: qk.report("revenue", range), queryFn: () => api.get<Revenue>("/reports/revenue", range), enabled: rangeOk });
  const appts = useQuery({ queryKey: qk.report("appointments", range), queryFn: () => api.get<Appts>("/reports/appointments", range), enabled: rangeOk && isAdmin });
  const util = useQuery({ queryKey: qk.report("utilization", range), queryFn: () => api.get<Util>("/reports/therapist-utilization", range), enabled: rangeOk && isAdmin });
  const pkgs = useQuery({ queryKey: qk.report("packages", range), queryFn: () => api.get<Pkgs>("/reports/packages", range), enabled: rangeOk });
  const due = useQuery({ queryKey: qk.report("outstanding"), queryFn: () => api.get<Outstanding>("/reports/outstanding") });
  const monthly = useMonthlyReport(6, isAdmin);

  const all = [revenue, appts, util, pkgs, due, monthly];
  const walkIns = appts.data?.bySource?.find((x) => x.source === "WALK_IN")?.count ?? 0;
  const ahead = appts.data?.bySource?.find((x) => x.source === "SCHEDULED")?.count ?? 0;
  const refreshing = all.some((x) => x.isRefetching);

  // Collections per day (series is per day per payment method).
  const daily = Object.entries(
    (revenue.data?.series ?? []).reduce<Record<string, number>>((acc, s) => {
      const d = String(s.period).slice(0, 10);
      acc[d] = (acc[d] ?? 0) + s.total;
      return acc;
    }, {}),
  ).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Screen edges={["top", "bottom"]} refreshing={refreshing} onRefresh={() => all.forEach((x) => x.refetch())}>
      <TopBar title="Reports" onBack={() => goBack("/more")} />

      <Card>
        <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}><DateField label="From" value={from} onChange={setFrom} /></View>
          <View style={{ flex: 1 }}><DateField label="To" value={to} onChange={setTo} /></View>
        </Row>
        {!rangeOk ? <Muted style={{ fontSize: 12, color: colors.warning }}>“From” must be on or before “To”.</Muted> : null}
        <Muted style={{ fontSize: 12 }}>CSV export is available on the web portal (Reports).</Muted>
      </Card>

      <View style={styles.grid}>
        <StatTile label="Net revenue" value={revenue.data ? inr(revenue.data.netRevenue) : "…"} hint="collected − refunds" />
        <StatTile label="Outstanding" value={due.data ? inr(due.data.totalDue) : "…"} hint={due.data ? `${due.data.count} invoices` : undefined} />
        {isAdmin ? <StatTile label="Appointments" value={appts.data?.total ?? "…"} hint={appts.data ? `No-show ${appts.data.noShowRate}% · Cancel ${appts.data.cancellationRate}%` : undefined} /> : null}
        <StatTile label="Packages sold" value={pkgs.data ? pkgs.data.sales.reduce((s, x) => s + x.count, 0) : "…"} />
      </View>
      {all.map((x, i) => (x.error ? <ErrorBox key={i} error={x.error} onRetry={() => x.refetch()} /> : null))}

      <SectionTitle>Daily collections</SectionTitle>
      <Card>{revenue.isLoading ? <Loading /> : <Bars rows={daily.map(([d, v]) => ({ label: date(`${d}T06:00:00Z`), value: v, display: inr(v), color: colors.gold500 }))} />}</Card>

      <SectionTitle>Revenue by service</SectionTitle>
      <Card>{revenue.isLoading ? <Loading /> : <Bars rows={(revenue.data?.byServiceType ?? []).map((s) => ({ label: label(s.type), value: s.total, display: inr(s.total) }))} />}</Card>

      {isAdmin ? (
        <>
          <SectionTitle>Therapist utilisation</SectionTitle>
          <Card>
            {util.isLoading ? (
              <Loading />
            ) : (
              <Bars rows={(util.data?.therapists ?? []).map((t) => ({ label: `${t.name} (${t.booked}/${t.booked + t.available})`, value: t.percent, display: `${t.percent}%`, color: t.colorTag }))} />
            )}
          </Card>

          <SectionTitle>Appointments by status</SectionTitle>
          <Card>{appts.isLoading ? <Loading /> : <Bars rows={(appts.data?.byStatus ?? []).map((s) => ({ label: label(s.status), value: s.count }))} />}</Card>

          <SectionTitle>Walk-in vs booked ahead</SectionTitle>
          <Card>
            {appts.isLoading ? (
              <Loading />
            ) : (
              <Bars
                rows={[
                  { label: "Booked ahead", value: ahead, color: colors.navy600 },
                  { label: "Walk-in", value: walkIns, color: colors.gold500 },
                ]}
              />
            )}
          </Card>

          <SectionTitle>Last 6 months</SectionTitle>
          <Card style={{ gap: 2 }}>
            {monthly.isLoading ? (
              <Loading />
            ) : (
              <>
                <Row style={styles.tableRow}>
                  <Muted style={[styles.cell, { flex: 1.4, textAlign: "left" }]}>Month</Muted>
                  <Muted style={styles.cell}>Visits</Muted>
                  <Muted style={styles.cell}>Done</Muted>
                  <Muted style={styles.cell}>Walk-in</Muted>
                  <Muted style={styles.cell}>No-show</Muted>
                  <Muted style={styles.cell}>New pts</Muted>
                </Row>
                {(monthly.data ?? []).map((m) => (
                  <Row key={m.month} style={styles.tableRow}>
                    <Text weight="semibold" style={[styles.cell, { flex: 1.4, textAlign: "left" }]}>{monthName(m.month)}</Text>
                    <Text style={styles.cell}>{m.visits}</Text>
                    <Text style={styles.cell}>{m.completed}</Text>
                    <Text style={styles.cell}>{m.walkIns}</Text>
                    <Text style={[styles.cell, m.noShows ? { color: colors.danger } : null]}>{m.noShows}</Text>
                    <Text style={styles.cell}>{m.newPatients}</Text>
                  </Row>
                ))}
                <Bars rows={(monthly.data ?? []).map((m) => ({ label: monthName(m.month), value: m.completed, display: `${m.completed} done`, color: colors.gold500 }))} />
              </>
            )}
          </Card>
        </>
      ) : null}

      <SectionTitle>Package sales</SectionTitle>
      <Card>
        {pkgs.isLoading ? (
          <Loading />
        ) : !pkgs.data?.sales.length ? (
          <Muted>No packages sold in this period.</Muted>
        ) : (
          pkgs.data.sales.map((s, i) => (
            <Row key={s.id ?? i} style={styles.tableRow}>
              <View style={{ flex: 1 }}>
                <Text weight="semibold" numberOfLines={1}>{s.name ?? "Package"}</Text>
                <Muted style={{ fontSize: 12 }}>{s.count} sold · {s.sessionsUsed}/{s.sessionsSold} sessions used</Muted>
              </View>
              <Text weight="bold">{inr(s.revenue)}</Text>
            </Row>
          ))
        )}
      </Card>

      <SectionTitle>Outstanding invoices</SectionTitle>
      <Card>
        {due.isLoading ? (
          <Loading />
        ) : !due.data?.invoices.length ? (
          <Muted>Nothing outstanding.</Muted>
        ) : (
          due.data.invoices.map((i) => (
            <Pressable key={i.id} onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: i.id } })} accessibilityRole="button">
              <Row style={styles.tableRow}>
                <View style={{ flex: 1 }}>
                  <Text weight="semibold" numberOfLines={1}>{fullName(i.patient)}</Text>
                  <Muted style={{ fontSize: 12 }}>{i.invoiceNo} · {i.patient.phone}{i.issuedAt ? ` · ${date(i.issuedAt)}` : ""}</Muted>
                </View>
                <Text weight="bold" style={{ color: colors.danger }}>{inr(i.dueAmount)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </Row>
            </Pressable>
          ))
        )}
      </Card>
    </Screen>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

const styles = StyleSheet.create({
  cell: { flex: 1, textAlign: "right", fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tableRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
