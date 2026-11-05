import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Sheet } from "@/components/form";
import { Avatar, Input, Loading, Muted, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { PatientListItem } from "@/lib/types";
import { colors, space } from "@/theme";

/** Search for a patient by name, phone or MH-P code and pick one. */
export function PatientPickerSheet({ open, onClose, onPick, title = "Choose a patient" }: { open: boolean; onClose: () => void; onPick: (patient: PatientListItem) => void; title?: string }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const patients = useQuery({
    queryKey: qk.patients.list("picker", { search: debounced }),
    queryFn: () => api.page<PatientListItem>("/patients", { search: debounced || undefined, limit: 10 }),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <Input value={search} onChangeText={setSearch} placeholder="Search name, phone or MH-P code" autoCorrect={false} />
      {patients.isLoading ? <Loading /> : null}
      {(patients.data ? patients.data.data : []).map((p) => (
        <Pressable key={p.id} onPress={() => onPick(p)} accessibilityRole="button" style={styles.row}>
          <Avatar name={fullName(p)} size={40} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="semibold" numberOfLines={1}>{fullName(p)}</Text>
            <Muted style={{ fontSize: 12 }}>{p.patientCode} · {p.phone}</Muted>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </Pressable>
      ))}
      {patients.data && patients.data.data.length === 0 ? <Muted>No patient found.</Muted> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
});
