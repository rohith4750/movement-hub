import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { PinBadge, SetPinSheet } from "@/components/admin-pin";
import { RequireRole, goBack } from "@/components/form";
import { Button, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { dateTime, label } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useAction } from "@/lib/refresh";
import { colors, radius, space } from "@/theme";

interface Staff { id: string; name: string; email: string | null; phone: string; role: string; isActive: boolean; lastLoginAt: string | null; hasPin: boolean }

export default function StaffScreen() {
  return (
    <RequireRole roles={["ADMIN"]} title="Staff">
      <StaffList />
    </RequireRole>
  );
}

function StaffList() {
  const me = useAuth((s) => s.user);
  const isSuper = me?.role === "SUPER_ADMIN";
  const [pinFor, setPinFor] = useState<Staff | null>(null);
  const q = useQuery({ queryKey: qk.users(), queryFn: () => api.page<Staff>("/users", { limit: 100 }) });

  const remove = useAction(
    async (u: Staff) => {
      if (!(await confirm(`Delete ${u.name}?`, `${u.name} (${label(u.role)}) will be signed out of the web and app and can no longer sign in. Past records stay for history.`, "Delete", true))) return null;
      return api.del(`/users/${u.id}`);
    },
    { refresh: ["staff"] },
  );

  const rows = q.data?.data ?? [];
  const withoutPin = rows.filter((u) => !u.hasPin).length;

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar title="Staff accounts" onBack={() => goBack("/more")} />
      <Button title="Add Super Admin" variant="gold" icon="person-add-outline" onPress={() => router.push("/staff/new")} />
      <Muted style={{ fontSize: 12 }}>Web: email/phone + password · App: personal 6-digit PIN. Add physiotherapists from Therapists so their schedule is created.</Muted>
      {withoutPin > 0 ? (
        <View style={styles.banner}>
          <Text style={{ color: colors.warning, fontSize: 13 }}>{withoutPin} staff member{withoutPin > 1 ? "s" : ""} can&apos;t use the mobile app yet. Tap Set PIN to give access.</Text>
        </View>
      ) : null}
      <ErrorBox error={remove.error} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <Empty icon="people-outline" title="No staff" />
      ) : (
        <View style={{ gap: space.sm }}>
          {rows.map((u) => {
            const canPin = u.role !== "SUPER_ADMIN" || isSuper;
            const self = u.id === me?.id;
            return (
              <Card key={u.id}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text weight="bold" style={{ fontSize: 15, flex: 1 }} numberOfLines={1}>{u.name}{self ? " (you)" : ""}</Text>
                  <Muted style={{ fontSize: 12 }}>{label(u.role)}</Muted>
                </Row>
                <Muted style={{ fontSize: 12 }}>{u.phone}{u.email ? ` · ${u.email}` : ""}</Muted>
                <Row style={{ justifyContent: "space-between" }}>
                  <PinBadge hasPin={u.hasPin} />
                  <Muted style={{ fontSize: 11 }}>Last login: {dateTime(u.lastLoginAt)}</Muted>
                </Row>
                <Row style={{ marginTop: 4 }}>
                  {canPin ? <Button title={u.hasPin ? "Reset PIN" : "Set PIN"} variant="ghost" small icon="key-outline" onPress={() => setPinFor(u)} style={{ flex: 1 }} /> : null}
                  {!self ? <Button title="Delete" variant="danger" small icon="trash-outline" onPress={() => remove.mutate(u)} disabled={remove.isPending} style={{ flex: 1 }} /> : null}
                </Row>
                {!canPin ? <Muted style={{ fontSize: 11 }}>Only a Super Admin can change a Super Admin&apos;s PIN.</Muted> : null}
              </Card>
            );
          })}
        </View>
      )}
      <SetPinSheet user={pinFor} onClose={() => setPinFor(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.warningBg, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: "#FDE68A" },
});
