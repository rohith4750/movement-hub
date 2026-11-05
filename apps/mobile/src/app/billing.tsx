import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { goBack, RequireRole } from "@/components/form";
import { Badge, Button, Card, Chips, Empty, ErrorBox, Input, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { fullName, inr, shortDate } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TherapistFilter } from "@/components/therapist-filter";
import { colors, radius, space } from "@/theme";

type Filter = "due" | "DRAFT" | "PAID" | "CANCELLED" | "all";

interface InvoiceRow {
  id: string;
  invoiceNo: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  dueAmount: string;
  issuedAt: string | null;
  createdAt: string;
  patient: { id: string; patientCode: string; firstName: string; lastName: string | null };
  therapist?: { id: string; user: { name: string } } | null;
}

const DUE = ["ISSUED", "PARTIALLY_PAID"];

/** Invoices: filter by status, search by invoice no. or patient, record payments from the detail screen. */
export default function Billing() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST", "ACCOUNTANT"]} title="Billing">
      <BillingList />
    </RequireRole>
  );
}

function BillingList() {
  const user = useAuth((s) => s.user);
  // Each physio bills and collects for their own patients; the Super Admin sees everyone's.
  const isPhysio = user?.role === "PHYSIOTHERAPIST";
  const [physio, setPhysio] = useState("");
  const [filter, setFilter] = useState<Filter>("due");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // "To collect" spans two statuses, so it is fetched unfiltered and narrowed on the device.
  const apiStatus = filter === "due" || filter === "all" ? undefined : filter;
  const q = useQuery({
    queryKey: qk.invoices.list({ status: apiStatus ?? "any", search: debounced, therapistId: isPhysio ? "me" : physio }),
    queryFn: () => api.page<InvoiceRow>("/invoices", { status: apiStatus, search: debounced || undefined, therapistId: isPhysio ? undefined : physio || undefined, limit: 100 }),
  });
  const rows = (q.data?.data ?? []).filter((i) => (filter === "due" ? DUE.includes(i.status) : true));
  const outstanding = rows.filter((i) => DUE.includes(i.status)).reduce((s, i) => s + Number(i.dueAmount), 0);
  const canCreate = hasRole(user, "ACCOUNTANT", "RECEPTIONIST", "ADMIN");

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar title={isPhysio ? "My patients' bills" : "Billing"} onBack={() => goBack("/more")} />
      {isPhysio ? (
        <Muted style={{ fontSize: 12 }}>Bills for your patients. Payments you collect here count in your collections.</Muted>
      ) : (
        <TherapistFilter value={physio} onChange={setPhysio} withUnlinked />
      )}
      {canCreate ? <Button title="New invoice" variant="gold" icon="add-circle-outline" onPress={() => router.push("/invoice/new")} /> : null}

      <Row style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <Input value={search} onChangeText={setSearch} placeholder="Invoice no. or patient name" autoCorrect={false} style={{ flex: 1, borderWidth: 0, paddingHorizontal: 0 }} />
        {search ? (
          <Pressable onPress={() => setSearch("")} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </Row>

      <Chips<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: "due", label: "To collect" },
          { value: "DRAFT", label: "Draft" },
          { value: "PAID", label: "Paid" },
          { value: "CANCELLED", label: "Cancelled" },
          { value: "all", label: "All" },
        ]}
      />

      {outstanding > 0 && (filter === "due" || filter === "all") ? (
        <Card gold>
          <Muted>Outstanding</Muted>
          <Text weight="bold" style={{ fontSize: 26, color: colors.navy700 }}>{inr(outstanding)}</Text>
          <Muted style={{ fontSize: 12 }}>
            {rows.filter((i) => DUE.includes(i.status)).length} invoice(s) · tap one to record a payment
          </Muted>
        </Card>
      ) : null}

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <Empty icon="receipt-outline" title={filter === "due" ? "Nothing to collect" : "No invoices"} message={debounced ? "Try a different search." : undefined} />
      ) : (
        <View style={{ gap: space.sm }}>
          {q.data && q.data.meta.total > q.data.data.length ? <Muted style={{ fontSize: 12 }}>Showing the latest {q.data.data.length} of {q.data.meta.total}. Search to narrow down.</Muted> : null}
          {rows.map((i) => (
            <Pressable key={i.id} onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: i.id } })} accessibilityRole="button" accessibilityLabel={`${i.invoiceNo}, ${fullName(i.patient)}, ${inr(i.totalAmount)}`}>
              <Card>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Text weight="semibold" style={{ flex: 1 }} numberOfLines={2}>{fullName(i.patient)}</Text>
                  <Badge status={i.status} />
                </Row>
                <Row style={{ justifyContent: "space-between" }}>
                  <Muted style={{ fontSize: 12, flex: 1 }} numberOfLines={1}>
                    {i.invoiceNo} · {shortDate(i.issuedAt ?? i.createdAt)}
                  </Muted>
                  <Row gap={4}>
                    <Text weight="bold">{inr(i.totalAmount)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                  </Row>
                </Row>
                {/* The physio and what is still due get their own line, so neither squeezes the invoice number */}
                {!isPhysio || (Number(i.dueAmount) > 0 && DUE.includes(i.status)) ? (
                  <Row style={{ justifyContent: "space-between" }}>
                    {!isPhysio ? <Muted style={{ fontSize: 12, flex: 1 }} numberOfLines={1}>{i.therapist?.user.name ?? "No physio"}</Muted> : <View style={{ flex: 1 }} />}
                    {Number(i.dueAmount) > 0 && DUE.includes(i.status) ? <Text weight="semibold" style={{ color: colors.danger, fontSize: 12 }}>Due {inr(i.dueAmount)}</Text> : null}
                  </Row>
                ) : null}
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
