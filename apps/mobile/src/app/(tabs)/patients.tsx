import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { BrandHeader, Button, Chips, Empty, ErrorBox, Input, Loading, Muted, Row, Screen, Text } from "@/components/ui";
import { useAuth, useHasRole } from "@/lib/auth";
import { api } from "@/lib/api";
import { ageFrom, fullName, label } from "@/lib/format";
import type { PatientListItem } from "@/lib/types";
import { colors, radius, shadow, space } from "@/theme";

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
    queryKey: ["patients", "mobile", debounced, mine],
    queryFn: () => api.page<PatientListItem>("/patients", { search: debounced || undefined, limit: 40, sort: "createdAt:desc", mine: mine ? "true" : undefined }),
  });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <BrandHeader title="Patients" subtitle={q.data ? `${q.data.meta.total} registered` : "Search by name, phone or code"} />
      {canAdd ? <Button title="Add patient" variant="gold" icon="person-add-outline" onPress={() => router.push("/patient/new")} /> : null}
      {isPhysio ? (
        <Chips<"mine" | "all"> value={scope} onChange={setScope} options={[{ value: "mine", label: "My patients" }, { value: "all", label: "All patients" }]} />
      ) : null}
      <Row style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <Input value={search} onChangeText={setSearch} placeholder="Name, phone or MH-P code" autoCorrect={false} style={{ flex: 1, borderWidth: 0, paddingHorizontal: 0 }} returnKeyType="search" />
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
        <View style={{ gap: space.sm }}>
          {q.data.data.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push({ pathname: "/patient/[id]", params: { id: p.id } })}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
            >
              <View style={styles.avatar}>
                <Text weight="bold" style={{ color: colors.navy700 }}>{(p.firstName[0] ?? "?").toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="semibold" style={{ fontSize: 15 }} numberOfLines={1}>{fullName(p)}</Text>
                <Muted style={{ fontSize: 12 }} numberOfLines={1}>{p.patientCode} · {p.phone} · {label(p.gender)}{ageFrom(p.dateOfBirth) !== null ? ` · ${ageFrom(p.dateOfBirth)} yrs` : ""}</Muted>
                {p.primaryTherapist && !mine ? <Muted style={{ fontSize: 12 }} numberOfLines={1}>Physio: {p.primaryTherapist.user.name}</Muted> : null}
                {p.treatmentPlans?.[0] ? <Muted style={{ fontSize: 12, color: colors.gold700 }} numberOfLines={1}>{p.treatmentPlans[0].title}</Muted> : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.white, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.navy50, ...shadow },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gold100, alignItems: "center", justifyContent: "center" },
});
