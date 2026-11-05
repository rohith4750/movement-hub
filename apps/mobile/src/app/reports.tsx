import Ionicons from "@expo/vector-icons/Ionicons";
import { useIsFetching, useQuery } from "@tanstack/react-query";
import { useMonthlyReport } from "@/lib/queries";
import { qk } from "@/lib/query-keys";
import { TherapistFilter } from "@/components/therapist-filter";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Bars, DateField, goBack, RequireRole, SectionTitle, StatTile } from "@/components/form";
import { FinanceTab, OperationsTab, OutcomesTab, PatientsTab } from "@/components/analytics-tabs";
import { Card, Chips, ErrorBox, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { hasRole, useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useRefresh } from "@/lib/refresh";
import { date, fullName, inr, label, today } from "@/lib/format";
import { colors, space } from "@/theme";

interface Revenue {
  netRevenue: number;
  series: { period: string; method: string; total: number }[];
  byServiceType: { type: string; total: number }[];
  /** Super Admin view: money in on each physio's bills. */
  byTherapist?: { therapistId: string | null; name: string; total: number; payments: number }[];
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

type ReportView = "overview" | "patients" | "outcomes" | "operations" | "finance";

function ReportsScreen() {
  const user = useAuth((s) => s.user);
  const isAdmin = hasRole(user, "ADMIN");
  // Physios see what they collected from their own patients; the Super Admin can pick one physio.
  const isPhysio = user?.role === "PHYSIOTHERAPIST";
  const [physio, setPhysio] = useState("");
  const [view, setView] = useState<ReportView>("overview");
  const refreshAll = useRefresh();
  // Any report query (overview or a tab) refreshing shows the pull-to-refresh spinner.
  const fetching = useIsFetching({ predicate: (q) => q.queryKey[0] === "report" }) > 0;
  const who = isPhysio ? "me" : physio;
  const money = { therapistId: isPhysio ? undefined : physio || undefined };
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(() => today());
  const rangeOk = !!from && !!to && from <= to;
  const range = { from, to };

  const revenue = useQuery({ queryKey: qk.report("revenue", { ...range, who }), queryFn: () => api.get<Revenue>("/reports/revenue", { ...range, ...money }), enabled: rangeOk });
  const appts = useQuery({ queryKey: qk.report("appointments", range), queryFn: () => api.get<Appts>("/reports/appointments", range), enabled: rangeOk && isAdmin });
  const util = useQuery({ queryKey: qk.report("utilization", range), queryFn: () => api.get<Util>("/reports/therapist-utilization", range), enabled: rangeOk && isAdmin });
  const pkgs = useQuery({ queryKey: qk.report("packages", { ...range, who }), queryFn: () => api.get<Pkgs>("/reports/packages", { ...range, ...money }), enabled: rangeOk });
  const due = useQuery({ queryKey: qk.report("outstanding", { who }), queryFn: () => api.get<Outstanding>("/reports/outstanding", money) });
  const monthly = useMonthlyReport(6, isAdmin);

  const all = [revenue, appts, util, pkgs, due, monthly];
  const walkIns = appts.data?.bySource?.find((x) => x.source === "WALK_IN")?.count ?? 0;
  const ahead = appts.data?.bySource?.find((x) => x.source === "SCHEDULED")?.count ?? 0;

  // Collections per day (series is per day per payment method).
  const daily = Object.entries(
    (revenue.data?.series ?? []).reduce<Record<string, number>>((acc, s) => {
      const d = String(s.period).slice(0, 10);
      acc[d] = (acc[d] ?? 0) + s.total;
      return acc;
    }, {}),
  ).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Screen edges={["top", "bottom"]} refreshing={fetching} onRefresh={() => refreshAll("billing")}>
      <TopBar title={isPhysio ? "My collections" : "Reports"} onBack={() => goBack("/more")} />
      {isPhysio ? (
        <Muted style={{ fontSize: 12 }}>Money in, packages and outstanding bills for your own patients.</Muted>
      ) : view === "overview" || view === "finance" ? (
        <TherapistFilter value={physio} onChange={setPhysio} />
      ) : null}

      {!isPhysio ? (
        <Chips<ReportView>
          value={view}
          onChange={setView}
          options={[
            { value: "overview", label: "Overview" },
            ...(isAdmin
              ? [
                  { value: "patients" as const, label: "Patients" },
                  { value: "outcomes" as const, label: "Outcomes" },
                  { value: "operations" as const, label: "Operations" },
                ]
              : []),
            { value: "finance", label: "Finance" },
          ]}
        />
      ) : null}

      <Card>
        <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}><DateField label="From" value={from} onChange={setFrom} /></View>
          <View style={{ flex: 1 }}><DateField label="To" value={to} onChange={setTo} /></View>
        </Row>
        {!rangeOk ? <Muted style={{ fontSize: 12, color: colors.warning }}>“From” must be on or before “To”.</Muted> : null}
        <Muted style={{ fontSize: 12 }}>CSV export is available on the web portal (Reports).</Muted>
      </Card>

      {view === "patients" && isAdmin ? <PatientsTab range={range} /> : null}
      {view === "outcomes" && isAdmin ? <OutcomesTab range={range} /> : null}
      {view === "operations" && isAdmin ? <OperationsTab range={range} /> : null}
      {view === "finance" ? <FinanceTab range={range} therapistId={money.therapistId} /> : null}

      {view === "overview" ? (
        <>
      <View style={styles.grid}>
        <StatTile icon="stats-chart-outline" tint="#E6EEF9" tone="#1D4B93" label="Net revenue" value={revenue.data ? inr(revenue.data.netRevenue) : "…"} hint="collected − refunds" />
        <StatTile icon="time-outline" tint="#FCEBE7" tone="#C2503A" label="Outstanding" value={due.data ? inr(due.data.totalDue) : "…"} hint={due.data ? `${due.data.count} invoices` : undefined} />
        {isAdmin ? <StatTile icon="calendar-outline" tint="#EFEAFB" tone="#5B3FB5" label="Appointments" value={appts.data?.total ?? "…"} hint={appts.data ? `No-show ${appts.data.noShowRate}% · Cancel ${appts.data.cancellationRate}%` : undefined} /> : null}
        <StatTile icon="pricetags-outline" tint="#E3F4E5" tone="#1F7A3A" label="Packages sold" value={pkgs.data ? pkgs.data.sales.reduce((s, x) => s + x.count, 0) : "…"} />
      </View>
      {all.map((x, i) => (x.error ? <ErrorBox key={i} error={x.error} onRetry={() => x.refetch()} /> : null))}

      <SectionTitle>Daily collections</SectionTitle>
      <Card>{revenue.isLoading ? <Loading /> : <Bars rows={daily.map(([d, v]) => ({ label: date(`${d}T06:00:00Z`), value: v, display: inr(v), color: colors.gold500 }))} />}</Card>

      {isAdmin && !physio && revenue.data?.byTherapist?.length ? (
        <>
          <SectionTitle>Collections by physio</SectionTitle>
          <Card>
            <Bars rows={revenue.data.byTherapist.map((t) => ({ label: `${t.name} (${t.payments})`, value: t.total, display: inr(t.total), color: colors.navy600 }))} />
          </Card>
        </>
      ) : null}

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
        </>
      ) : null}
    </Screen>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

const styles = StyleSheet.create({
  cell: { flex: 1, textAlign: "right", fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tableRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
});
