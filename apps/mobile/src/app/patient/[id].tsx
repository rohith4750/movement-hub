import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { CategoryBadge, visitSummary } from "@/components/patient-visits";
import { usePatient } from "@/lib/queries";
import { qk } from "@/lib/query-keys";
import { forget, refresh, useAction } from "@/lib/refresh";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { QuickPlanForm } from "@/components/clinical-plan-form";
import { ListRow, SectionTitle, Sheet } from "@/components/form";
import { MedicalHistorySheet, PainProgressCard, SellPackageSheet } from "@/components/patient-sheets";
import { Badge, Button, Card, ErrorBox, H2, KeyValue, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { ageYears, date, dateTime, fullName, label } from "@/lib/format";
import { colors, space } from "@/theme";

type Panel = "history" | "package" | "plan" | null;

export default function PatientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const q = usePatient(id);
  const p = q.data;
  const age = ageYears(p?.dateOfBirth);
  const [panel, setPanel] = useState<Panel>(null);

  // Same role rules as the API routes.
  const canBook = hasRole(user, "ADMIN", "RECEPTIONIST");
  const canEdit = hasRole(user, "ADMIN", "RECEPTIONIST");
  const canDelete = hasRole(user, "ADMIN");
  const canAddHistory = hasRole(user, "PHYSIOTHERAPIST", "RECEPTIONIST");
  const canSell = hasRole(user, "ADMIN", "RECEPTIONIST");
  const canPlan = hasRole(user, "PHYSIOTHERAPIST", "ADMIN");
  const canSeeProgress = hasRole(user, "PHYSIOTHERAPIST", "ADMIN");

  const remove = useAction(
    async () => {
      if (!p) return false;
      const ok = await confirm(
        `Delete ${fullName(p)}?`,
        "They will be removed from the patient list and search, and any active package is cancelled. Past consultations, sessions and invoices are kept for records.",
        "Delete",
        true,
      );
      if (!ok) return false;
      await api.del(`/patients/${p.id}`);
      return true;
    },
    {
      onSuccess: (deleted) => {
        if (!deleted) return;
        forget(qc, qk.patient(id));
        void refresh(qc, "patients");
        router.replace("/patients");
      },
    },
  );

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar
        title="Patient"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/patients"))}
        right={
          canEdit && p ? (
            <Pressable onPress={() => router.push({ pathname: "/patient/edit/[id]", params: { id: p.id } })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit patient">
              <Ionicons name="create-outline" size={22} color={colors.navy700} />
            </Pressable>
          ) : undefined
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : p ? (
        <>
          <Card style={{ backgroundColor: colors.navy700, borderColor: colors.navy700 }}>
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <Text weight="bold" style={{ color: colors.white, fontSize: 20, flex: 1 }}>{fullName(p)}</Text>
              <CategoryBadge visits={p.visits} />
            </Row>
            <Text style={{ color: colors.gold300 }}>{p.patientCode} · {label(p.gender)}{age !== null ? ` · ${age} yrs` : ""}</Text>
            {p.primaryTherapist ? <Text style={{ color: colors.navy100, fontSize: 13 }}>Regular physio: {p.primaryTherapist.user.name}</Text> : null}
            {p.visits ? <Text style={{ color: colors.navy100, fontSize: 13 }}>{visitSummary(p.visits)}</Text> : null}
            <Pressable onPress={() => Linking.openURL(`tel:${p.phone}`)} accessibilityRole="link" accessibilityLabel={`Call ${p.phone}`}>
              <Row gap={6} style={{ marginTop: space.xs }}>
                <Ionicons name="call" size={14} color={colors.navy100} />
                <Text style={{ color: colors.navy100, textDecorationLine: "underline" }}>{p.phone}</Text>
              </Row>
            </Pressable>
          </Card>

          {canBook ? (
            <Button title="Book appointment" variant="gold" icon="add-circle-outline" onPress={() => router.push({ pathname: "/book", params: { patientId: p.id } })} />
          ) : null}

          {canSell || canPlan || canAddHistory ? (
            <View style={{ gap: space.sm }}>
              <SectionTitle>Actions</SectionTitle>
              {canPlan ? <ListRow icon="clipboard-outline" title="Create treatment plan" subtitle="Write a plan for this patient" onPress={() => router.push({ pathname: "/plan/new", params: { patientId: id } })} /> : null}
              {canSell ? <ListRow icon="pricetags-outline" title="Sell package" subtitle="Creates the package and a GST invoice" onPress={() => setPanel("package")} /> : null}
              {canAddHistory ? <ListRow icon="medkit-outline" title="Add medical history" subtitle="Conditions, medications, allergies" onPress={() => setPanel("history")} /> : null}
            </View>
          ) : null}

          {canSeeProgress ? <PainProgressCard patientId={p.id} /> : null}

          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <H2>Details</H2>
              {canEdit ? <Button title="Edit" variant="ghost" small icon="create-outline" onPress={() => router.push({ pathname: "/patient/edit/[id]", params: { id: p.id } })} /> : null}
            </Row>
            <KeyValue k="Email" v={p.email ?? "—"} />
            <KeyValue k="Date of birth" v={date(p.dateOfBirth)} />
            <KeyValue k="Emergency" v={p.emergencyName ? `${p.emergencyName}${p.emergencyPhone ? ` · ${p.emergencyPhone}` : ""}` : "—"} />
            {p.referredBy ? <KeyValue k="Referred by" v={p.referredBy} /> : null}
            {p.addresses.map((a) => (
              <KeyValue key={a.id} k={a.label} v={`${a.line1}, ${a.city}`} />
            ))}
          </Card>

          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <H2>Medical history</H2>
              {canAddHistory ? <Button title="Add" variant="ghost" small icon="add" onPress={() => setPanel("history")} /> : null}
            </Row>
            {p.medicalHistory.length === 0 ? (
              <Muted>None recorded.</Muted>
            ) : (
              p.medicalHistory.map((h) => (
                <View key={h.id} style={{ paddingVertical: 4 }}>
                  <Row gap={6}>
                    <Text weight="semibold">{h.condition}</Text>
                    {h.isOngoing ? <Badge status="ACTIVE" text="Ongoing" /> : null}
                  </Row>
                  {h.details ? <Muted style={{ fontSize: 12 }}>{h.details}</Muted> : null}
                  {h.medications || h.allergies ? <Muted style={{ fontSize: 12 }}>Medications: {h.medications ?? "—"} · Allergies: {h.allergies ?? "—"}</Muted> : null}
                </View>
              ))
            )}
          </Card>

          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <H2>Treatment plans</H2>
              {canPlan ? <Button title="New" variant="ghost" small icon="add" onPress={() => setPanel("plan")} /> : null}
            </Row>
            {p.treatmentPlans.length === 0 ? (
              <Muted>No plans yet.</Muted>
            ) : (
              p.treatmentPlans.map((t) => (
                <Pressable key={t.id} onPress={() => router.push({ pathname: "/plan/[id]", params: { id: t.id } })} accessibilityRole="button">
                  <Row style={{ justifyContent: "space-between", paddingVertical: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Text weight="semibold">{t.title}</Text>
                      <Muted style={{ fontSize: 12 }}>{t.prescribedSessions} sessions · {date(t.createdAt)}</Muted>
                    </View>
                    <Badge status={t.status} />
                  </Row>
                </Pressable>
              ))
            )}
          </Card>

          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <H2>Packages</H2>
              {canSell ? <Button title="Sell" variant="ghost" small icon="add" onPress={() => setPanel("package")} /> : null}
            </Row>
            {p.packages.length === 0 ? (
              <Muted>No packages.</Muted>
            ) : (
              p.packages.map((k) => (
                <Row key={k.id} style={{ justifyContent: "space-between", paddingVertical: 4 }}>
                  <View style={{ flex: 1 }}>
                    <Text weight="semibold">{k.package.name}</Text>
                    <Muted style={{ fontSize: 12 }}>{k.remainingSessions}/{k.totalSessions} left · till {date(k.expiryDate)}</Muted>
                  </View>
                  <Badge status={k.status} />
                </Row>
              ))
            )}
          </Card>

          <Card>
            <H2>Recent visits</H2>
            {p.appointments.length === 0 ? (
              <Muted>No visits yet.</Muted>
            ) : (
              p.appointments.map((a) => (
                <Pressable key={a.id} onPress={() => router.push({ pathname: "/appointment/[id]", params: { id: a.id } })} accessibilityRole="button">
                  <Row style={{ justifyContent: "space-between", paddingVertical: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Text weight="semibold" style={{ fontSize: 13 }}>{dateTime(a.startAt)}</Text>
                      <Muted style={{ fontSize: 12 }}>{label(a.type)} · {a.therapist.user.name}</Muted>
                    </View>
                    <Badge status={a.status} />
                  </Row>
                </Pressable>
              ))
            )}
          </Card>

          {canDelete ? (
            <>
              <ErrorBox error={remove.error} />
              <Button title="Delete patient" variant="danger" icon="trash-outline" onPress={() => remove.mutate()} loading={remove.isPending} />
              <Muted style={{ fontSize: 12, textAlign: "center" }}>Patients with upcoming appointments or unpaid invoices can&apos;t be deleted until those are cleared.</Muted>
            </>
          ) : null}

          <MedicalHistorySheet patientId={p.id} open={panel === "history"} onClose={() => setPanel(null)} />
          <SellPackageSheet patientId={p.id} open={panel === "package"} onClose={() => setPanel(null)} />
          <Sheet open={panel === "plan"} onClose={() => setPanel(null)} title={`New plan · ${fullName(p)}`}>
            <QuickPlanForm
              patientId={p.id}
              onCancel={() => setPanel(null)}
              onCreated={(planId) => {
                setPanel(null);
                router.push({ pathname: "/plan/[id]", params: { id: planId } });
              }}
            />
          </Sheet>
        </>
      ) : null}
    </Screen>
  );
}
