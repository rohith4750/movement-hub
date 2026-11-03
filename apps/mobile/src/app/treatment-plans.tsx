import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { goBack, RequireRole } from "@/components/form";
import { Badge, Button, Card, Chips, Empty, ErrorBox, Input, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { useHasRole } from "@/lib/auth";
import { api } from "@/lib/api";
import { date, fullName } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { colors, radius, space } from "@/theme";

type Status = "ACTIVE" | "DRAFT" | "COMPLETED" | "CANCELLED" | "all";

interface PlanRow {
  id: string;
  planNo: string;
  title: string;
  status: string;
  prescribedSessions: number;
  frequencyPerWeek: number;
  createdAt: string;
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null };
  therapist: { id: string; user: { name: string } };
}

export default function TreatmentPlans() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"]} title="Treatment plans">
      <PlansList />
    </RequireRole>
  );
}

function PlansList() {
  const canCreate = useHasRole("PHYSIOTHERAPIST", "ADMIN");
  const [status, setStatus] = useState<Status>("ACTIVE");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const q = useQuery({
    queryKey: qk.plans.list({ status, search: debounced }),
    queryFn: () => api.page<PlanRow>("/treatment-plans", { status: status === "all" ? undefined : status, search: debounced || undefined, limit: 100 }),
  });
  const rows = q.data?.data ?? [];

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar title="Treatment plans" onBack={() => goBack("/more")} />
      {canCreate ? <Button title="New plan" variant="gold" icon="add-circle-outline" onPress={() => router.push("/plan/new")} /> : null}
      <Muted style={{ fontSize: 12 }}>Plans are written during a consultation, or from a patient&apos;s profile.</Muted>

      <Row style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <Input value={search} onChangeText={setSearch} placeholder="Plan title or plan no." autoCorrect={false} style={{ flex: 1, borderWidth: 0, paddingHorizontal: 0 }} />
        {search ? (
          <Pressable onPress={() => setSearch("")} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </Row>

      <Chips<Status>
        value={status}
        onChange={setStatus}
        options={[
          { value: "ACTIVE", label: "Active" },
          { value: "DRAFT", label: "Draft" },
          { value: "COMPLETED", label: "Completed" },
          { value: "CANCELLED", label: "Cancelled" },
          { value: "all", label: "All" },
        ]}
      />

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <Empty icon="clipboard-outline" title="No plans" message={debounced ? "Try a different search." : undefined} />
      ) : (
        <View style={{ gap: space.sm }}>
          {q.data && q.data.meta.total > rows.length ? <Muted style={{ fontSize: 12 }}>Showing {rows.length} of {q.data.meta.total}. Search to narrow down.</Muted> : null}
          {rows.map((p) => (
            <Pressable key={p.id} onPress={() => router.push({ pathname: "/plan/[id]", params: { id: p.id } })} accessibilityRole="button" accessibilityLabel={`${p.title}, ${fullName(p.patient)}`}>
              <Card>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text weight="bold" style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>{p.title}</Text>
                  <Badge status={p.status} />
                </Row>
                <Text weight="semibold" style={{ fontSize: 13 }}>{fullName(p.patient)} · {p.patient.patientCode}</Text>
                <Row style={{ justifyContent: "space-between" }}>
                  <Muted style={{ fontSize: 12, flex: 1 }} numberOfLines={1}>
                    {p.therapist.user.name} · {p.prescribedSessions} sessions · {p.frequencyPerWeek}×/wk · {date(p.createdAt)}
                  </Muted>
                  <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                </Row>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md },
});
