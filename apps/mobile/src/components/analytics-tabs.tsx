import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Bars, SectionTitle, StatTile } from "@/components/form";
import { Card, ErrorBox, KeyValue, Loading, Muted, Row, Text } from "@/components/ui";
import { fullName, inr, label } from "@/lib/format";
import { useFinanceAnalytics, useOperationsAnalytics, useOutcomeAnalytics, usePatientAnalytics } from "@/lib/queries";
import type { DateRange } from "@/lib/types";
import { colors, radius, space } from "@/theme";

/**
 * The analytics tabs of the Reports screen. Each tab loads its own data for the chosen date range
 * (see the /reports/patients, /outcomes, /operations and /finance endpoints).
 */

const grid = { flexDirection: "row", flexWrap: "wrap", gap: space.md } as const;

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
const hourLong = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
const oneDecimal = (v: number | null) => (v === null ? "—" : String(v));

/** Shared loading / error / empty handling so each tab only describes its content. */
function Frame({ query, children }: { query: { isLoading: boolean; error: unknown; refetch: () => unknown }; children: ReactNode }) {
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorBox error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children}</>;
}

/* ───────────────────────── Patients & retention ───────────────────────── */

export function PatientsTab({ range }: { range: DateRange }) {
  const q = usePatientAnalytics(range);
  const d = q.data;
  return (
    <Frame query={q}>
      {d ? (
        <>
          <View style={grid}>
            <StatTile label="New patients" value={d.newPatients} hint={`${d.totalPatients} in total`} />
            <StatTile label="Patients seen" value={d.activePatients} hint={`${d.returningPatients} returning · ${d.returningRate}%`} />
            <StatTile label="To call back" value={d.dropOffCapped ? `${d.dropOffCount}+` : d.dropOffCount} hint={`not seen in ${d.dropOffDays}+ days`} />
          </View>

          <SectionTitle>Patients to call back</SectionTitle>
          <Card>
            {d.dropOffs.length === 0 ? (
              <Muted>Nobody has been away for {d.dropOffDays}+ days without a visit booked.</Muted>
            ) : (
              d.dropOffs.map((p) => (
                <Row key={p.id} style={styles.row} gap={space.md}>
                  <Pressable style={{ flex: 1, gap: 2 }} onPress={() => router.push({ pathname: "/patient/[id]", params: { id: p.id } })} accessibilityRole="button">
                    <Text weight="semibold" numberOfLines={1}>{fullName(p)}</Text>
                    <Muted style={{ fontSize: 12 }}>{p.patientCode} · last seen {p.daysAgo} days ago · {p.visits} visit{p.visits === 1 ? "" : "s"}</Muted>
                  </Pressable>
                  <Pressable onPress={() => void Linking.openURL(`tel:${p.phone}`)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Call ${fullName(p)}`} style={styles.callBtn}>
                    <Ionicons name="call" size={16} color={colors.navy700} />
                  </Pressable>
                </Row>
              ))
            )}
            {d.dropOffCount > d.dropOffs.length ? <Muted style={{ fontSize: 12 }}>Showing the {d.dropOffs.length} most recent of {d.dropOffCount}{d.dropOffCapped ? "+" : ""}.</Muted> : null}
          </Card>

          <SectionTitle>Where new patients come from</SectionTitle>
          <Card>
            {d.referralSources.length === 0 ? (
              <Muted>No “referred by” entered for patients registered in this period.</Muted>
            ) : (
              <Bars rows={d.referralSources.map((r) => ({ label: r.name, value: r.count, color: colors.gold500 }))} />
            )}
          </Card>

          <SectionTitle>Age groups</SectionTitle>
          <Card><Bars rows={d.ageGroups.map((a) => ({ label: a.bucket, value: a.count, color: colors.navy600 }))} /></Card>

          <SectionTitle>Gender and patient type</SectionTitle>
          <Card>
            <Bars rows={d.gender.map((g) => ({ label: label(g.gender), value: g.count }))} />
            <View style={styles.sep} />
            <Bars rows={d.patientTypes.map((t) => ({ label: label(t.type), value: t.count, color: colors.gold500 }))} />
          </Card>
        </>
      ) : null}
    </Frame>
  );
}

/* ───────────────────────── Clinical outcomes ───────────────────────── */

export function OutcomesTab({ range }: { range: DateRange }) {
  const q = useOutcomeAnalytics(range);
  const d = q.data;
  return (
    <Frame query={q}>
      {d ? (
        <>
          <View style={grid}>
            <StatTile
              label="Avg pain relief"
              value={d.avgPainReduction === null ? "—" : `${d.avgPainReduction > 0 ? "−" : ""}${Math.abs(d.avgPainReduction)} pts`}
              good={d.avgPainReduction !== null && d.avgPainReduction > 0}
              hint={d.avgPainBefore !== null && d.avgPainAfter !== null ? `${d.avgPainBefore} → ${d.avgPainAfter} out of 10` : "no pain scores yet"}
            />
            <StatTile label="Sessions with relief" value={`${d.reliefRate}%`} hint={`of ${d.sessionsMeasured} measured`} />
            <StatTile label="Plans completed" value={d.completedPlans} hint={`${d.goalsMetRate}% met their goals`} />
            <StatTile label="Progress rating" value={d.avgProgressRating === null ? "—" : `${d.avgProgressRating} / 5`} hint={`${d.sessionsCompleted} sessions`} />
          </View>

          <SectionTitle>Treatment outcomes</SectionTitle>
          <Card>
            {d.completedPlans === 0 ? (
              <Muted>No treatment plans were completed in this period.</Muted>
            ) : (
              <Bars
                rows={[
                  { label: "Goals met", value: d.outcomes.goalsMet, color: colors.success },
                  { label: "Partially met", value: d.outcomes.partiallyMet, color: colors.gold500 },
                  { label: "Not met", value: d.outcomes.notMet, color: colors.danger },
                  { label: "Discontinued", value: d.outcomes.discontinued, color: colors.muted },
                  { label: "Outcome not recorded", value: d.outcomes.notRecorded, color: colors.navy100 },
                ]}
              />
            )}
          </Card>

          <SectionTitle>Plan length</SectionTitle>
          <Card>
            <KeyValue k="Active plans right now" v={String(d.activePlans)} />
            <KeyValue k="Avg sessions prescribed" v={oneDecimal(d.avgPrescribedSessions)} />
            <KeyValue k="Avg sessions actually done" v={oneDecimal(d.avgSessionsDone)} />
            <KeyValue k="Avg final pain score" v={d.avgFinalPain === null ? "—" : `${d.avgFinalPain} / 10`} />
          </Card>

          <SectionTitle>By physiotherapist</SectionTitle>
          <Card>
            {d.byTherapist.length === 0 ? (
              <Muted>No completed sessions in this period.</Muted>
            ) : (
              d.byTherapist.map((t) => (
                <View key={t.therapistId} style={styles.row}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{t.name}</Text>
                    <Muted style={{ fontSize: 12 }}>{t.sessions} session{t.sessions === 1 ? "" : "s"}</Muted>
                  </Row>
                  <Muted style={{ fontSize: 12 }}>
                    Pain {t.avgReduction === null ? "—" : `${t.avgReduction > 0 ? "↓" : t.avgReduction < 0 ? "↑" : ""} ${Math.abs(t.avgReduction)} pts`} · relief in {t.reliefRate}% · rating {t.avgRating === null ? "—" : `${t.avgRating}/5`}
                  </Muted>
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </Frame>
  );
}

/* ───────────────────────── Operations & peak times ───────────────────────── */

/** Day × hour grid: darker = busier. */
function Heatmap({ hours, days, cells }: { hours: number[]; days: string[]; cells: { day: string; hour: number; count: number }[] }) {
  const max = Math.max(1, ...cells.map((c) => c.count));
  const countAt = (day: string, hour: number) => {
    const hit = cells.find((c) => c.day === day && c.hour === hour);
    return hit ? hit.count : 0;
  };
  if (!hours.length) return <Muted>No visits in this period.</Muted>;
  return (
    <View style={{ gap: 4 }}>
      <Row gap={4}>
        <View style={styles.heatDay} />
        {hours.map((h) => (
          <Text key={h} style={styles.heatHour}>{hourLabel(h)}</Text>
        ))}
      </Row>
      {days.map((day) => (
        <Row key={day} gap={4}>
          <Text weight="medium" style={styles.heatDay}>{day}</Text>
          {hours.map((h) => {
            const n = countAt(day, h);
            return (
              <View key={h} style={[styles.heatCell, { backgroundColor: n ? `rgba(28,38,112,${(0.14 + 0.86 * (n / max)).toFixed(2)})` : colors.navy50 }]} accessibilityLabel={`${day} ${hourLong(h)}: ${n} visits`}>
                {n ? <Text weight="semibold" style={{ fontSize: 10, color: n / max > 0.45 ? colors.white : colors.navy800 }}>{n}</Text> : null}
              </View>
            );
          })}
        </Row>
      ))}
    </View>
  );
}

export function OperationsTab({ range }: { range: DateRange }) {
  const q = useOperationsAnalytics(range);
  const d = q.data;
  return (
    <Frame query={q}>
      {d ? (
        <>
          <View style={grid}>
            <StatTile label="Visits" value={d.totalVisits} hint={d.busiestDay ? `busiest: ${d.busiestDay}${d.busiestHour !== null ? ` · ${hourLong(d.busiestHour)}` : ""}` : undefined} />
            <StatTile label="Slots used" value={`${d.slotFillRate}%`} hint={`${d.slotsBooked} booked · ${d.slotsUnused} unused`} />
            <StatTile label="Home visits" value={`${d.homeVisitShare}%`} hint="of all visits" />
            <StatTile label="Avg session" value={d.avgSessionMinutes === null ? "—" : `${Math.round(d.avgSessionMinutes)} min`} hint={d.sessionsTimed ? `${d.sessionsTimed} timed sessions` : "start/finish not recorded"} />
          </View>

          <SectionTitle>Busy times</SectionTitle>
          <Card>
            <Heatmap hours={d.heatmap.hours} days={d.heatmap.days} cells={d.heatmap.cells} />
            <Muted style={{ fontSize: 11 }}>Visits by weekday and hour. Darker means busier.</Muted>
          </Card>

          <SectionTitle>Visits by weekday</SectionTitle>
          <Card><Bars rows={d.perDay.map((x) => ({ label: x.day, value: x.count, color: colors.navy600 }))} /></Card>

          <SectionTitle>Visit types</SectionTitle>
          <Card>
            {d.byType.length === 0 ? <Muted>No visits in this period.</Muted> : <Bars rows={d.byType.map((t) => ({ label: label(t.type), value: t.count, color: colors.gold500 }))} />}
          </Card>

          <SectionTitle>No-shows and cancellations</SectionTitle>
          <Card>
            {d.perTherapist.length === 0 ? (
              <Muted>No visits in this period.</Muted>
            ) : (
              d.perTherapist.map((t) => (
                <View key={t.therapistId} style={styles.row}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{t.name}</Text>
                    <Muted style={{ fontSize: 12 }}>{t.visits} visits · {t.completed} done</Muted>
                  </Row>
                  <Row gap={space.lg}>
                    <Text style={{ fontSize: 12, color: t.noShowRate >= 10 ? colors.danger : colors.muted }}>No-show {t.noShowRate}%</Text>
                    <Text style={{ fontSize: 12, color: t.cancelRate >= 15 ? colors.danger : colors.muted }}>Cancelled {t.cancelRate}%</Text>
                  </Row>
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </Frame>
  );
}

/* ───────────────────────── Finance deep-dive ───────────────────────── */

export function FinanceTab({ range, therapistId }: { range: DateRange; therapistId?: string }) {
  const q = useFinanceAnalytics(range, therapistId);
  const d = q.data;
  return (
    <Frame query={q}>
      {d ? (
        <>
          <View style={grid}>
            <StatTile
              label="Net revenue"
              value={inr(d.netRevenue)}
              hint={d.changePct === null ? "no earlier period to compare" : `${d.changePct >= 0 ? "▲" : "▼"} ${Math.abs(d.changePct)}% vs previous ${d.previousRange.from.slice(5)} – ${d.previousRange.to.slice(5)}`}
              good={d.changePct !== null && d.changePct > 0}
            />
            <StatTile label="Collection rate" value={`${d.collectionRate}%`} hint={`${inr(d.collected)} of ${inr(d.billed)} billed`} good={d.billed > 0 && d.collectionRate >= 90} />
            <StatTile label="Per visit" value={d.revenuePerVisit === null ? "—" : inr(d.revenuePerVisit)} hint={`${d.completedVisits} completed visits`} />
            <StatTile label="Per patient" value={d.revenuePerPatient === null ? "—" : inr(d.revenuePerPatient)} hint={`${d.payingPatients} paying patients`} />
          </View>

          <SectionTitle>Billed vs collected</SectionTitle>
          <Card>
            <Bars
              rows={[
                { label: `Billed (${d.invoicesIssued} invoices)`, value: d.billed, display: inr(d.billed), color: colors.navy600 },
                { label: "Collected", value: d.collected, display: inr(d.collected), color: colors.success },
                { label: "Still due", value: d.stillDue, display: inr(d.stillDue), color: colors.danger },
              ]}
            />
            <Muted style={{ fontSize: 11 }}>Invoices issued in this period, and how much of them has been paid so far.</Muted>
          </Card>

          <SectionTitle>How patients pay</SectionTitle>
          <Card>
            {d.paymentMethods.length === 0 ? (
              <Muted>No payments in this period.</Muted>
            ) : (
              <Bars rows={d.paymentMethods.map((m) => ({ label: `${label(m.method)} (${m.count})`, value: m.total, display: `${inr(m.total)} · ${m.share}%`, color: colors.gold500 }))} />
            )}
          </Card>

          <SectionTitle>Packages</SectionTitle>
          <Card>
            <KeyValue k="Sold in this period" v={String(d.packagesSold)} />
            <KeyValue k="Package revenue" v={inr(d.packageRevenue)} />
            {d.packageSessionsRedeemed !== null ? <KeyValue k="Package sessions used" v={String(d.packageSessionsRedeemed)} /> : null}
          </Card>
        </>
      ) : null}
    </Frame>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 8, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  sep: { height: space.md },
  callBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.navy50, alignItems: "center", justifyContent: "center" },
  heatDay: { width: 32, fontSize: 11, color: colors.muted },
  heatHour: { flex: 1, textAlign: "center", fontSize: 10, color: colors.muted },
  heatCell: { flex: 1, height: 28, borderRadius: radius.sm - 4, alignItems: "center", justifyContent: "center" },
});
