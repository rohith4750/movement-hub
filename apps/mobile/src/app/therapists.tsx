import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { PinBadge } from "@/components/admin-pin";
import { RequireRole, goBack } from "@/components/form";
import { Button, Empty, ErrorBox, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { colors, radius, shadow, space } from "@/theme";

interface TherapistRow {
  id: string;
  qualification: string;
  experienceYears: number;
  colorTag: string | null;
  isAvailableForHomeVisit: boolean;
  isActive: boolean;
  user: { id: string; name: string; email: string | null; phone: string; hasPin?: boolean };
  specializations: { specialization: { id: string; name: string } }[];
}

export default function TherapistsScreen() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST"]} title="Therapists">
      <Therapists />
    </RequireRole>
  );
}

function Therapists() {
  const user = useAuth((s) => s.user);
  const isAdmin = hasRole(user, "ADMIN");
  const q = useQuery({
    queryKey: ["therapists", "admin-list", isAdmin],
    queryFn: () => api.get<TherapistRow[]>("/therapists", { includeInactive: isAdmin || undefined }),
  });
  const noPin = isAdmin ? (q.data ?? []).filter((t) => t.isActive && !t.user.hasPin).length : 0;

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar title="Physiotherapists" onBack={() => goBack("/more")} />
      {isAdmin ? <Button title="Add physiotherapist" variant="gold" icon="person-add-outline" onPress={() => router.push("/therapist/new")} /> : null}
      {noPin > 0 ? (
        <View style={styles.banner}>
          <Text style={{ color: colors.warning, fontSize: 13 }}>{noPin} physiotherapist{noPin > 1 ? "s" : ""} can&apos;t use the mobile app yet. Open them and tap Set PIN.</Text>
        </View>
      ) : null}
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty icon="medkit-outline" title="No physiotherapists yet" />
      ) : (
        <View style={{ gap: space.md }}>
          {q.data.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => router.push({ pathname: "/therapist/[id]", params: { id: t.id } })}
              accessibilityRole="button"
              style={({ pressed }) => [styles.card, { borderTopColor: t.colorTag ?? colors.gold500 }, !t.isActive && { opacity: 0.55 }, pressed && { opacity: 0.85 }]}
            >
              <Row style={{ justifyContent: "space-between" }}>
                <Text weight="bold" style={{ fontSize: 16, flex: 1 }} numberOfLines={1}>{t.user.name}</Text>
                {!t.isActive ? <Muted style={{ fontSize: 12 }}>Inactive</Muted> : null}
              </Row>
              <Muted>{t.qualification} · {t.experienceYears} yrs experience</Muted>
              <View style={styles.chips}>
                {t.specializations.map((s) => (
                  <View key={s.specialization.id} style={[styles.chip, { backgroundColor: colors.gold100 }]}>
                    <Text weight="semibold" style={{ fontSize: 11, color: colors.gold700 }}>{s.specialization.name}</Text>
                  </View>
                ))}
                {t.isAvailableForHomeVisit ? (
                  <View style={[styles.chip, { backgroundColor: colors.navy50 }]}>
                    <Text weight="semibold" style={{ fontSize: 11, color: colors.navy700 }}>Home visits</Text>
                  </View>
                ) : null}
              </View>
              <Muted style={{ fontSize: 12 }}>{t.user.phone}{t.user.email ? ` · ${t.user.email}` : ""}</Muted>
              {isAdmin ? <PinBadge hasPin={t.user.hasPin} /> : null}
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space.lg, gap: 6, borderWidth: 1, borderColor: colors.navy50, borderTopWidth: 4, ...shadow },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  banner: { backgroundColor: colors.warningBg, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: "#FDE68A" },
});
