import Ionicons from "@expo/vector-icons/Ionicons";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CategoryBadge, VisitLine } from "@/components/patient-visits";
import { qk } from "@/lib/query-keys";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Avatar, BrandHeader, Button, Card, Chips, Empty, ErrorBox, Input, Loading, Muted, Row, Screen, Text } from "@/components/ui";
import { useAuth, useHasRole } from "@/lib/auth";
import { api } from "@/lib/api";
import { ageFrom, fullName, label } from "@/lib/format";
import type { PatientListItem } from "@/lib/types";
import { colors, compact, radius, space } from "@/theme";

/** Search patients by name, phone or patient code. */
export default function Patients() {
  const canAdd = useHasRole("ADMIN", "RECEPTIONIST"); // Super Admin + physiotherapists (who run the front desk)
  const isPhysio = useAuth((s) => s.user?.role === "PHYSIOTHERAPIST");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const mine = isPhysio && scope === "mine";
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const q = useQuery({
    queryKey: qk.patients.list("tab", { search: debounced, mine }),
    queryFn: () => api.page<PatientListItem>("/patients", { search: debounced || undefined, limit: 40, sort: "createdAt:desc", mine: mine ? "true" : undefined }),
    placeholderData: keepPreviousData, // keep the list on screen while a new search loads
  });

  return (
    <Screen
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
      footer={canAdd ? <Button title="Add patient" variant="gold" icon="person-add-outline" onPress={() => router.push("/patient/new")} /> : undefined}
    >
      <BrandHeader title="Patients" subtitle={q.data ? `${q.data.meta.total} registered` : "Search by name, phone or code"} />
      {isPhysio ? (
        <Chips<"mine" | "all"> value={scope} onChange={setScope} options={[{ value: "mine", label: "My patients" }, { value: "all", label: "All patients" }]} />
      ) : null}
      <Row style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <Input value={search} onChangeText={setSearch} placeholder="Name, phone or MH-P code" autoCorrect={false} style={{ flex: 1, borderWidth: 0, paddingHorizontal: 0, backgroundColor: "transparent" }} returnKeyType="search" />
        {search ? (
          <Pressable onPress={() => setSearch("")} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </Row>

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <Empty
          icon="people-outline"
          title="No patients found"
          message={search ? "Try a different name or number." : mine ? "No regular patients yet — switch to All patients, or set yourself as their regular physio." : undefined}
          action={canAdd ? <Button title="Add a new patient" variant="ghost" small icon="person-add-outline" onPress={() => router.push("/patient/new")} /> : undefined}
        />
      ) : (
        <Card style={styles.list}>
          {q.data.data.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => router.push({ pathname: "/patient/[id]", params: { id: p.id } })}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && { opacity: 0.85 }]}
            >
              <Avatar name={fullName(p)} size={compact ? 40 : 46} />
              <View style={{ flex: 1, gap: 2 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text weight="bold" style={{ fontSize: 12, color: colors.navy700 }}>{p.patientCode}</Text>
                  <CategoryBadge visits={p.visits} />
                </Row>
                <Text weight="semibold" style={{ fontSize: 15 }} numberOfLines={2}>{fullName(p)}</Text>
                <Muted style={{ fontSize: 12 }} numberOfLines={2}>{p.phone} · {p.patientType === "WALK_IN" ? "Walk-in" : "Regular"} · {label(p.gender)}{ageFrom(p.dateOfBirth) !== null ? ` · ${ageFrom(p.dateOfBirth)} yrs` : ""}</Muted>
                <VisitLine visits={p.visits} />
                {p.primaryTherapist && !mine ? <Muted style={{ fontSize: 12 }} numberOfLines={1}>Physio: {p.primaryTherapist.user.name}</Muted> : null}
                {p.treatmentPlans?.[0] ? <Muted style={{ fontSize: 12, color: colors.gold700 }} numberOfLines={1}>{p.treatmentPlans[0].title}</Muted> : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { backgroundColor: colors.navy50, borderRadius: radius.md, paddingHorizontal: space.md },
  list: { paddingVertical: space.xs, paddingHorizontal: space.md, gap: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 12 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
});
