import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { goBack, RequireRole } from "@/components/form";
import { PlanEditor } from "@/components/plan-editor";
import { Button, Card, H2, Input, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { PatientListItem } from "@/lib/types";
import { colors, space } from "@/theme";

/** New treatment plan. Opened with ?patientId=… from a patient, or picks the patient here. */
export default function NewPlanScreen() {
  return (
    <RequireRole roles={["PHYSIOTHERAPIST", "ADMIN"]} title="New treatment plan">
      <NewPlan />
    </RequireRole>
  );
}

function NewPlan() {
  const params = useLocalSearchParams<{ patientId?: string }>();
  const fixed = typeof params.patientId === "string" ? params.patientId : undefined;
  const [chosen, setChosen] = useState<PatientListItem | null>(null);
  const [search, setSearch] = useState("");
  const patientId = fixed ?? chosen?.id;

  const patients = useQuery({
    queryKey: qk.patients.list("plan-new", { search }),
    queryFn: () => api.page<PatientListItem>("/patients", { search: search.trim() || undefined, limit: 8 }),
    enabled: !fixed && !chosen,
  });

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title="New treatment plan" onBack={() => goBack("/treatment-plans")} />
      {!fixed ? (
        <Card>
          <H2>Patient</H2>
          {chosen ? (
            <Row style={{ justifyContent: "space-between" }}>
              <Text weight="semibold" style={{ flex: 1 }}>{fullName(chosen)} · {chosen.patientCode}</Text>
              <Button title="Change" variant="ghost" small onPress={() => setChosen(null)} />
            </Row>
          ) : (
            <>
              <Input value={search} onChangeText={setSearch} placeholder="Search name, phone or MH-P code" autoCorrect={false} />
              {patients.isLoading ? (
                <Loading />
              ) : (
                (patients.data?.data ?? []).map((p) => (
                  <Pressable key={p.id} onPress={() => setChosen(p)} accessibilityRole="button" style={styles.pick}>
                    <Text weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{fullName(p)}</Text>
                    <Muted style={{ fontSize: 12 }}>{p.patientCode}</Muted>
                  </Pressable>
                ))
              )}
            </>
          )}
        </Card>
      ) : null}
      <PlanEditor patientId={patientId} onSaved={(id) => router.replace({ pathname: "/plan/[id]", params: { id } })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pick: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
