import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { goBack, RequireRole, SectionTitle, SelectField, Sheet } from "@/components/form";
import { Badge, Button, Card, Chips, Empty, ErrorBox, Field, Input, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { date, fullName, inr, label } from "@/lib/format";
import { colors, space } from "@/theme";

type Tier = "BASIC" | "STANDARD" | "PREMIUM" | "CUSTOM";
type PkgStatus = "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "CANCELLED" | "all";

interface PackageDef {
  id: string;
  name: string;
  tier: Tier;
  description: string | null;
  sessionCount: number;
  validityDays: number;
  price: string;
  includesHomeVisit: boolean;
  isActive: boolean;
}
interface PatientPackageRow {
  id: string;
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  pricePaid: string;
  expiryDate: string;
  status: string;
  package: { name: string };
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null };
}

/** Package catalogue (admin can create / edit) and the packages patients have bought. */
export default function Packages() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST", "ACCOUNTANT"]} title="Packages">
      <PackagesScreen />
    </RequireRole>
  );
}

function PackagesScreen() {
  const user = useAuth((s) => s.user);
  const isAdmin = hasRole(user, "ADMIN");
  const [status, setStatus] = useState<PkgStatus>("ACTIVE");
  const [editing, setEditing] = useState<PackageDef | "new" | null>(null);

  const catalogue = useQuery({
    queryKey: ["packages", isAdmin ? "all" : "active"],
    queryFn: () => api.get<PackageDef[]>("/packages", { includeInactive: isAdmin || undefined }),
  });
  const sold = useQuery({
    queryKey: ["patient-packages", "list", status],
    queryFn: () => api.page<PatientPackageRow>("/patient-packages", { status: status === "all" ? undefined : status, limit: 100 }),
  });

  return (
    <Screen
      edges={["top", "bottom"]}
      refreshing={catalogue.isRefetching || sold.isRefetching}
      onRefresh={() => {
        catalogue.refetch();
        sold.refetch();
      }}
    >
      <TopBar title="Packages" onBack={() => goBack("/more")} />

      <SectionTitle action={isAdmin ? <Button title="New package" variant="ghost" small icon="add" onPress={() => setEditing("new")} /> : undefined}>Catalogue</SectionTitle>
      {catalogue.isLoading ? (
        <Loading />
      ) : catalogue.error ? (
        <ErrorBox error={catalogue.error} onRetry={() => catalogue.refetch()} />
      ) : !catalogue.data?.length ? (
        <Empty icon="pricetags-outline" title="No packages yet" message={isAdmin ? "Tap “New package” to create one." : undefined} />
      ) : (
        catalogue.data.map((p) => {
          const premium = p.tier === "PREMIUM";
          return (
            <Card key={p.id} gold={premium} style={[premium ? { borderWidth: 2 } : null, !p.isActive ? { opacity: 0.55 } : null]}>
              <Row style={{ justifyContent: "space-between" }}>
                <Text weight="bold" style={{ color: colors.gold700, fontSize: 11, letterSpacing: 1.5 }}>{label(p.tier).toUpperCase()}</Text>
                {!p.isActive ? <Badge status="CANCELLED" text="Not offered" /> : null}
              </Row>
              <Text weight="bold" style={{ fontSize: 17, color: colors.navy700 }}>{p.name}</Text>
              <Text weight="bold" style={{ fontSize: 24, color: colors.navy700 }}>{inr(p.price)}</Text>
              <View style={{ gap: 3 }}>
                <Feature text={`${p.sessionCount} sessions · valid ${p.validityDays} days`} />
                <Feature text={`${inr(Number(p.price) / Math.max(p.sessionCount, 1))} per session`} />
                {p.includesHomeVisit ? <Feature text="Home visits included" /> : null}
              </View>
              {p.description ? <Muted style={{ fontSize: 12 }}>{p.description}</Muted> : null}
              {isAdmin ? <Button title="Edit" variant="ghost" small icon="create-outline" onPress={() => setEditing(p)} style={{ alignSelf: "flex-start" }} /> : null}
            </Card>
          );
        })
      )}
      {!isAdmin ? <Muted style={{ fontSize: 12 }}>To sell a package to a patient, open the patient from the Patients tab.</Muted> : null}

      <SectionTitle>Patient packages</SectionTitle>
      <Chips<PkgStatus>
        value={status}
        onChange={setStatus}
        options={[
          { value: "ACTIVE", label: "Active" },
          { value: "EXHAUSTED", label: "Used up" },
          { value: "EXPIRED", label: "Expired" },
          { value: "CANCELLED", label: "Cancelled" },
          { value: "all", label: "All" },
        ]}
      />
      {sold.isLoading ? (
        <Loading />
      ) : sold.error ? (
        <ErrorBox error={sold.error} onRetry={() => sold.refetch()} />
      ) : !sold.data?.data.length ? (
        <Empty icon="pricetags-outline" title="No packages in this list" />
      ) : (
        <View style={{ gap: space.sm }}>
          {sold.data.data.map((p) => (
            <Pressable key={p.id} onPress={() => router.push({ pathname: "/patient/[id]", params: { id: p.patient.id } })} accessibilityRole="button">
              <Card>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{fullName(p.patient)}</Text>
                  <Badge status={p.status} />
                </Row>
                <Muted style={{ fontSize: 12 }}>{p.package.name} · {p.patient.patientCode}</Muted>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text weight="bold" style={{ color: colors.navy700 }}>{p.remainingSessions} left <Text style={{ fontSize: 12, color: colors.muted }}>({p.usedSessions}/{p.totalSessions} used)</Text></Text>
                  <Muted style={{ fontSize: 12 }}>till {date(p.expiryDate)}</Muted>
                </Row>
                <Muted style={{ fontSize: 12 }}>Paid {inr(p.pricePaid)}</Muted>
              </Card>
            </Pressable>
          ))}
        </View>
      )}

      {editing ? <PackageEditor pkg={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Screen>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <Row gap={6}>
      <Ionicons name="checkmark-circle" size={15} color={colors.gold500} />
      <Text style={{ fontSize: 13 }}>{text}</Text>
    </Row>
  );
}

const TIERS: { value: Tier; label: string }[] = [
  { value: "BASIC", label: "Basic" },
  { value: "STANDARD", label: "Standard" },
  { value: "PREMIUM", label: "Premium" },
  { value: "CUSTOM", label: "Custom" },
];

/** Admin: create a package or edit an existing one (incl. whether it's offered for sale). */
function PackageEditor({ pkg, onClose }: { pkg: PackageDef | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: pkg?.name ?? "",
    tier: (pkg?.tier ?? "CUSTOM") as Tier,
    price: pkg ? String(Number(pkg.price)) : "",
    sessionCount: pkg ? String(pkg.sessionCount) : "10",
    validityDays: pkg ? String(pkg.validityDays) : "60",
    description: pkg?.description ?? "",
    includesHomeVisit: pkg?.includesHomeVisit ?? false,
    isActive: pkg?.isActive ?? true,
  });

  const price = Number(f.price);
  const sessions = Number(f.sessionCount);
  const validity = Number(f.validityDays);
  const problem =
    f.name.trim().length < 2
      ? "Name needs at least 2 characters"
      : !f.price || !(price >= 0)
        ? "Enter a price"
        : !(Number.isInteger(sessions) && sessions >= 1 && sessions <= 500)
          ? "Sessions must be 1–500"
          : !(Number.isInteger(validity) && validity >= 1 && validity <= 730)
            ? "Validity must be 1–730 days"
            : null;

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name.trim(),
        tier: f.tier,
        price,
        sessionCount: sessions,
        validityDays: validity,
        description: f.description.trim() || undefined,
        includesHomeVisit: f.includesHomeVisit,
      };
      if (!pkg) return api.post("/packages", body);
      await api.patch(`/packages/${pkg.id}`, body);
      if (f.isActive !== pkg.isActive) await api.patch(`/packages/${pkg.id}/status`, { isActive: f.isActive });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages"] });
      onClose();
    },
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title={pkg ? `Edit ${pkg.name}` : "New package"}
      footer={
        <View style={{ gap: space.sm }}>
          {problem ? <Muted style={{ fontSize: 12, color: colors.warning }}>{problem}</Muted> : null}
          <Button title={pkg ? "Save changes" : "Create package"} onPress={() => save.mutate()} disabled={!!problem} loading={save.isPending} />
        </View>
      }
    >
      <Field label="Name"><Input value={f.name} onChangeText={(t) => setF({ ...f, name: t })} placeholder="e.g. Back Rehab 12" /></Field>
      <SelectField<Tier> label="Tier" value={f.tier} options={TIERS} onChange={(v) => setF({ ...f, tier: v })} />
      <Row gap={space.sm}>
        <View style={{ flex: 1 }}><Field label="Price (₹)"><Input value={f.price} onChangeText={(t) => setF({ ...f, price: t.replace(/[^\d.]/g, "") })} keyboardType="decimal-pad" /></Field></View>
        <View style={{ flex: 1 }}><Field label="Sessions"><Input value={f.sessionCount} onChangeText={(t) => setF({ ...f, sessionCount: t.replace(/\D/g, "") })} keyboardType="number-pad" /></Field></View>
      </Row>
      <Field label="Validity (days)"><Input value={f.validityDays} onChangeText={(t) => setF({ ...f, validityDays: t.replace(/\D/g, "") })} keyboardType="number-pad" /></Field>
      <Field label="Description (optional)"><Input value={f.description} onChangeText={(t) => setF({ ...f, description: t })} multiline /></Field>
      <ToggleRow title="Includes home visits" value={f.includesHomeVisit} onChange={(v) => setF({ ...f, includesHomeVisit: v })} />
      {pkg ? <ToggleRow title="Offered for sale" value={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} /> : null}
      {price > 0 && sessions > 0 ? <Muted style={{ fontSize: 12 }}>{inr(price / sessions)} per session, before GST.</Muted> : null}
      <ErrorBox error={save.error} />
    </Sheet>
  );
}

function ToggleRow({ title, value, onChange }: { title: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row style={{ justifyContent: "space-between" }}>
      <Text>{title}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.gold500, false: colors.navy100 }} thumbColor={colors.white} />
    </Row>
  );
}
