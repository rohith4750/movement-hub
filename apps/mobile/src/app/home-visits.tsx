import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { DateField, goBack, RequireRole } from "@/components/form";
import { Badge, Button, Card, Empty, ErrorBox, KeyValue, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { addDays, date, fullName, inr, time, today } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useAction } from "@/lib/refresh";
import { colors, space } from "@/theme";

interface Visit {
  id: string;
  status: string;
  distanceKm: string | null;
  travelCharge: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  notes: string | null;
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null; phone: string };
  therapist: { id: string; user: { name: string; phone: string } };
  address: { line1: string; line2: string | null; landmark: string | null; city: string; pincode: string; latitude: string | null; longitude: string | null };
  appointment: { id: string; appointmentNo: string; startAt: string; endAt: string; status: string };
}

type Step = "en-route" | "check-in" | "check-out";

/** Home physiotherapy visits for a day. The assigned physio moves the visit along: on my way → check in (GPS) → check out. */
export default function HomeVisits() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST", "PHYSIOTHERAPIST"]} title="Home visits">
      <VisitList />
    </RequireRole>
  );
}

/** Best-effort GPS fix for check-in. Never throws: returns coordinates or a reason why there are none. */
async function currentPosition(): Promise<{ latitude?: number; longitude?: number; note?: string }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { note: "Location permission was not given, so the check-in has no GPS position." };
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000));
    const pos = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), timeout]);
    if (!pos) return { note: "Couldn't get a GPS fix in time, so the check-in has no position." };
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return { note: "Location is unavailable on this device, so the check-in has no GPS position." };
  }
}

function VisitList() {
  const user = useAuth((s) => s.user);
  const canBook = hasRole(user, "ADMIN", "RECEPTIONIST");
  const [day, setDay] = useState(today());
  const [notice, setNotice] = useState<string | null>(null);
  const q = useQuery({
    queryKey: qk.homeVisits(day),
    queryFn: () => api.page<Visit>("/home-visits", { date: day, limit: 100 }),
    select: (r) => r.data,
  });

  const step = useAction(
    // `gps` is true only for the assigned physio. A Super Admin updating on their behalf never
    // sends a position: the admin's location is not the visit's location.
    async ({ v, action, gps }: { v: Visit; action: Step; gps: boolean }) => {
      if (action === "check-out" && !(await confirm("Check out and complete?", `This completes the home visit for ${fullName(v.patient)}.`, "Complete"))) return null;
      let body: { latitude?: number; longitude?: number } = {};
      let note: string | undefined;
      if (gps && (action === "check-in" || action === "check-out")) {
        const pos = await currentPosition();
        note = pos.note?.replace("the check-in", action === "check-in" ? "the check-in" : "the check-out");
        if (pos.latitude !== undefined) body = { latitude: pos.latitude, longitude: pos.longitude };
      }
      await api.post(`/home-visits/${v.id}/${action}`, body);
      return { note };
    },
    { refresh: ["appointments"], onSuccess: (r) => setNotice(r?.note ?? null) },
  );

  const openMap = (v: Visit) => {
    const url = v.address.latitude && v.address.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${v.address.latitude},${v.address.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.address.line1}, ${v.address.city} ${v.address.pincode}`)}`;
    Linking.openURL(url).catch(() => setNotice("Couldn't open maps on this device."));
  };

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar title="Home visits" onBack={() => goBack("/more")} />
      {canBook ? (
        <Button title="Book home visit" variant="gold" icon="add-circle-outline" onPress={() => router.push({ pathname: "/book", params: { type: "HOME_VISIT" } })} />
      ) : null}

      <Card>
        <Row>
          <Button title="" icon="chevron-back" variant="ghost" small onPress={() => setDay(addDays(day, -1))} />
          <View style={{ flex: 1 }}>
            <DateField label="Date" value={day} onChange={(v) => v && setDay(v)} />
          </View>
          <Button title="" icon="chevron-forward" variant="ghost" small onPress={() => setDay(addDays(day, 1))} />
        </Row>
        {day !== today() ? <Button title="Back to today" variant="ghost" small onPress={() => setDay(today())} style={{ alignSelf: "flex-start" }} /> : null}
      </Card>

      {notice ? (
        <Card style={{ backgroundColor: colors.warningBg, borderColor: "#C98A12" }}>
          <Row style={{ alignItems: "flex-start" }}>
            <Ionicons name="information-circle" size={18} color={colors.warning} />
            <Text style={{ flex: 1, color: colors.warning, fontSize: 13 }}>{notice}</Text>
            <Pressable onPress={() => setNotice(null)} hitSlop={8} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={16} color={colors.warning} />
            </Pressable>
          </Row>
        </Card>
      ) : null}
      <ErrorBox error={step.error} />

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty icon="home-outline" title="No home visits" message={`Nothing scheduled on ${date(`${day}T06:00:00Z`)}.`} />
      ) : (
        q.data.map((v) => {
          const assigned = user?.role === "PHYSIOTHERAPIST" && user.therapistId === v.therapist.id;
          const adminOverride = user?.role === "SUPER_ADMIN"; // updates on the physio's behalf, without GPS
          const mine = assigned || adminOverride;
          const go = (action: Step) => step.mutate({ v, action, gps: assigned });
          const busy = step.isPending && step.variables?.v.id === v.id;
          return (
            <Card key={v.id}>
              <Row style={{ justifyContent: "space-between" }}>
                <Text weight="bold" style={{ fontSize: 18, color: colors.navy700 }}>{time(v.appointment.startAt)}</Text>
                <Badge status={v.status} />
              </Row>
              <Pressable onPress={() => router.push({ pathname: "/appointment/[id]", params: { id: v.appointment.id } })} accessibilityRole="button">
                <Text weight="semibold" style={{ fontSize: 15 }}>{fullName(v.patient)}</Text>
                <Muted style={{ fontSize: 12 }}>{v.patient.patientCode} · {v.appointment.appointmentNo}</Muted>
              </Pressable>

              <Pressable onPress={() => Linking.openURL(`tel:${v.patient.phone}`)} accessibilityRole="link" accessibilityLabel={`Call ${v.patient.phone}`}>
                <Row gap={6}>
                  <Ionicons name="call-outline" size={15} color={colors.navy500} />
                  <Text style={{ color: colors.navy500, textDecorationLine: "underline" }}>{v.patient.phone}</Text>
                </Row>
              </Pressable>
              <Pressable onPress={() => openMap(v)} accessibilityRole="link" accessibilityLabel="Open address in maps">
                <Row gap={6} style={{ alignItems: "flex-start" }}>
                  <Ionicons name="location-outline" size={15} color={colors.navy500} style={{ marginTop: 2 }} />
                  <Text style={[styles.addr]}>
                    {v.address.line1}
                    {v.address.line2 ? `, ${v.address.line2}` : ""}
                    {v.address.landmark ? ` (near ${v.address.landmark})` : ""}, {v.address.city} {v.address.pincode}
                  </Text>
                </Row>
              </Pressable>

              <KeyValue k="Physiotherapist" v={v.therapist.user.name} />
              <KeyValue k="Travel" v={`${v.distanceKm ? `${v.distanceKm} km · ` : ""}${inr(v.travelCharge)}`} />
              {v.checkInAt ? <KeyValue k="Checked in" v={time(v.checkInAt)} /> : null}
              {v.checkOutAt ? <KeyValue k="Checked out" v={time(v.checkOutAt)} /> : null}

              {mine && ["SCHEDULED", "EN_ROUTE", "CHECKED_IN"].includes(v.status) ? (
                <View style={{ gap: space.sm, marginTop: space.xs }}>
                  {adminOverride && !assigned ? (
                    <Muted style={{ fontSize: 12 }}>Admin: update on {v.therapist.user.name}&apos;s behalf. No GPS is recorded.</Muted>
                  ) : null}
                  {v.status === "SCHEDULED" ? (
                    <Button title={assigned ? "On my way" : "Mark on the way"} variant="ghost" icon="car-outline" onPress={() => go("en-route")} loading={busy && step.variables?.action === "en-route"} disabled={step.isPending} />
                  ) : null}
                  {["SCHEDULED", "EN_ROUTE"].includes(v.status) ? (
                    <Button title={assigned ? "Check in (with GPS)" : "Mark checked in"} variant="gold" icon="navigate-outline" onPress={() => go("check-in")} loading={busy && step.variables?.action === "check-in"} disabled={step.isPending} />
                  ) : null}
                  {v.status === "CHECKED_IN" ? (
                    <Button title={assigned ? "Check out & complete (with GPS)" : "Mark completed"} icon="checkmark-done-outline" onPress={() => go("check-out")} loading={busy} disabled={step.isPending} />
                  ) : null}
                </View>
              ) : !mine && user?.role === "PHYSIOTHERAPIST" && ["SCHEDULED", "EN_ROUTE", "CHECKED_IN"].includes(v.status) ? (
                <Muted style={{ fontSize: 12 }}>Assigned to {v.therapist.user.name}.</Muted>
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  addr: { flex: 1, color: colors.navy500, textDecorationLine: "underline", fontSize: 13 },
});
