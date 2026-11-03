import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { sharePdfFromApi } from "@/components/billing-print";
import { goBack, RequireRole, Sheet } from "@/components/form";
import { Badge, Button, Card, Chips, Divider, ErrorBox, Field, H2, Input, KeyValue, Loading, Muted, Row, Screen, Text, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { date, dateTime, fullName, inr, label } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useAction } from "@/lib/refresh";
import type { InvoiceDetail } from "@/lib/types";
import { colors, space } from "@/theme";

type Method = "CASH" | "UPI" | "CARD" | "NET_BANKING";

export default function InvoiceScreen() {
  return (
    <RequireRole roles={["ADMIN", "RECEPTIONIST", "ACCOUNTANT"]} title="Invoice">
      <InvoiceDetailScreen />
    </RequireRole>
  );
}

function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: qk.invoice(id), queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`), enabled: !!id });
  const inv = q.data;
  const half = inv ? Number(inv.gstPercent) / 2 : 0;

  /* ── record payment ── */
  const [method, setMethod] = useState<Method>("UPI");
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const pay = useAction(
    async () => {
      const value = amount ? Number(amount) : Number(inv!.dueAmount);
      if (!(value > 0)) throw new Error("Enter a valid amount");
      if (value > Number(inv!.dueAmount)) throw new Error(`Amount can't be more than the balance due (${inr(inv!.dueAmount)})`);
      const ok = await confirm("Record payment?", `${inr(value)} by ${label(method)} for ${inv!.invoiceNo}.`, "Record");
      if (!ok) return null;
      return api.post("/payments", { invoiceId: id, method, amount: value, referenceNo: ref.trim() || undefined });
    },
    {
      refresh: ["billing"],
      onSuccess: (r) => {
        if (!r) return;
        setAmount("");
        setRef("");
      },
    },
  );

  /* ── issue / cancel ── */
  const issue = useAction(
    async () => {
      const ok = await confirm("Issue invoice?", "Once issued, the invoice can't be edited. Payments can then be recorded.", "Issue");
      return ok ? api.post(`/invoices/${id}/issue`) : null;
    },
    { refresh: ["billing"] },
  );
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const cancel = useAction(() => api.post(`/invoices/${id}/cancel`, { reason: reason.trim() }), {
    refresh: ["billing"],
    onSuccess: () => {
      setCancelOpen(false);
      setReason("");
    },
  });

  /* ── PDFs ── */
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<unknown>(null);
  const sharePdf = async (key: string, path: string) => {
    setPdfBusy(key);
    setPdfError(null);
    try {
      await sharePdfFromApi(path);
    } catch (e) {
      setPdfError(e);
    } finally {
      setPdfBusy(null);
    }
  };

  const canCollect = hasRole(user, "ADMIN", "RECEPTIONIST", "ACCOUNTANT");
  const canIssue = hasRole(user, "ADMIN", "RECEPTIONIST", "ACCOUNTANT");
  const canCancel = hasRole(user, "ADMIN", "ACCOUNTANT");
  const payable = !!inv && ["ISSUED", "PARTIALLY_PAID"].includes(inv.status) && Number(inv.dueAmount) > 0;
  const cancellable = !!inv && ["DRAFT", "ISSUED"].includes(inv.status) && Number(inv.paidAmount) === 0;

  return (
    <Screen edges={["top", "bottom"]} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <TopBar title="Invoice" onBack={() => goBack("/billing")} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : inv ? (
        <>
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <Text weight="bold" style={{ fontSize: 16 }}>{inv.invoiceNo}</Text>
              <Badge status={inv.status} />
            </Row>
            <Pressable onPress={() => router.push({ pathname: "/patient/[id]", params: { id: inv.patient.id } })} accessibilityRole="link">
              <Text weight="semibold" style={{ color: colors.navy700, textDecorationLine: "underline" }}>{fullName(inv.patient)} · {inv.patient.patientCode}</Text>
            </Pressable>
            <Muted>{inv.issuedAt ? `Issued ${date(inv.issuedAt)}` : "Draft (not issued yet)"} · {inv.patient.phone}</Muted>
          </Card>

          <Card>
            <H2>Items</H2>
            {inv.items.map((i) => (
              <Row key={i.id} style={{ justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 4 }}>
                <View style={{ flex: 1, paddingRight: space.sm }}>
                  <Text>{i.description}</Text>
                  {i.quantity > 1 ? <Muted style={{ fontSize: 12 }}>{i.quantity} × {inr(i.unitPrice)}</Muted> : null}
                </View>
                <Text weight="semibold">{inr(i.amount)}</Text>
              </Row>
            ))}
            <Divider />
            <KeyValue k="Subtotal" v={inr(inv.subtotal)} />
            {Number(inv.discountAmount) > 0 ? <KeyValue k={`Discount${inv.discountReason ? ` (${inv.discountReason})` : ""}`} v={`-${inr(inv.discountAmount)}`} /> : null}
            {Number(inv.igstAmount) > 0 ? (
              <KeyValue k={`IGST ${inv.gstPercent}%`} v={inr(inv.igstAmount)} />
            ) : (
              <>
                <KeyValue k={`CGST ${half}%`} v={inr(inv.cgstAmount)} />
                <KeyValue k={`SGST ${half}%`} v={inr(inv.sgstAmount)} />
              </>
            )}
            <Divider />
            <KeyValue k="Total" v={inr(inv.totalAmount)} vStyle={{ fontSize: 18, color: colors.navy700 }} />
            <KeyValue k="Paid" v={inr(inv.paidAmount)} />
            <KeyValue k="Balance due" v={inr(inv.dueAmount)} vStyle={{ color: Number(inv.dueAmount) > 0 ? colors.danger : colors.success }} />
          </Card>

          {/* Actions */}
          <View style={{ gap: space.sm }}>
            <ErrorBox error={pdfError ?? issue.error} />
            {inv.status === "DRAFT" && canIssue ? <Button title="Issue invoice" icon="checkmark-circle-outline" onPress={() => issue.mutate()} loading={issue.isPending} /> : null}
            <Button title="Print / share PDF" variant="ghost" icon="share-outline" onPress={() => sharePdf("invoice", `/invoices/${id}/pdf`)} loading={pdfBusy === "invoice"} disabled={!!pdfBusy} />
            {cancellable && canCancel ? <Button title="Cancel invoice" variant="danger" icon="close-circle-outline" onPress={() => setCancelOpen(true)} /> : null}
            {["ISSUED", "PARTIALLY_PAID"].includes(inv.status) && Number(inv.paidAmount) > 0 && canCancel ? (
              <Muted style={{ fontSize: 12 }}>This invoice has payments, so it can&apos;t be cancelled. Refunds are handled on the web portal.</Muted>
            ) : null}
          </View>

          {payable && canCollect ? (
            <Card gold style={{ gap: space.md }}>
              <H2>Record payment</H2>
              <Chips<Method>
                value={method}
                onChange={setMethod}
                options={[{ value: "UPI", label: "UPI" }, { value: "CASH", label: "Cash" }, { value: "CARD", label: "Card" }, { value: "NET_BANKING", label: "Net banking" }]}
              />
              <Field label={`Amount (due ${inr(inv.dueAmount)})`}>
                <Input value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ""))} keyboardType="decimal-pad" placeholder={String(Number(inv.dueAmount))} />
              </Field>
              {method !== "CASH" ? (
                <Field label="Reference (UTR / last 4 digits)">
                  <Input value={ref} onChangeText={setRef} autoCapitalize="characters" />
                </Field>
              ) : null}
              <ErrorBox error={pay.error} />
              <Button title={`Record ${inr(amount ? Number(amount) : Number(inv.dueAmount))}`} icon="cash-outline" onPress={() => pay.mutate()} loading={pay.isPending} />
            </Card>
          ) : null}
          {inv.status === "DRAFT" ? <Muted style={{ fontSize: 12 }}>Issue the invoice before recording payments.</Muted> : null}

          {inv.payments.length ? (
            <Card>
              <H2>Payments</H2>
              {inv.payments.map((p) => {
                const receiptOk = p.status === "SUCCESS" || p.status === "PARTIALLY_REFUNDED";
                return (
                  <View key={p.id} style={{ paddingVertical: 6, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.navy50 }}>
                    <Row style={{ justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}>
                        <Text weight="semibold">{inr(p.amount)}</Text>
                        <Muted style={{ fontSize: 12 }}>{label(p.method)} · {dateTime(p.paidAt)}</Muted>
                        <Muted style={{ fontSize: 11 }}>{p.receiptNo}</Muted>
                      </View>
                      <Badge status={p.status} />
                    </Row>
                    {receiptOk ? (
                      <Button
                        title="Share receipt"
                        variant="ghost"
                        small
                        icon="receipt-outline"
                        onPress={() => sharePdf(p.id, `/payments/${p.id}/receipt`)}
                        loading={pdfBusy === p.id}
                        disabled={!!pdfBusy}
                        style={{ alignSelf: "flex-start" }}
                      />
                    ) : null}
                  </View>
                );
              })}
            </Card>
          ) : null}

          <Sheet
            open={cancelOpen}
            onClose={() => setCancelOpen(false)}
            title={`Cancel ${inv.invoiceNo}?`}
            footer={<Button title="Cancel invoice" variant="danger" onPress={() => cancel.mutate()} loading={cancel.isPending} disabled={reason.trim().length < 3} />}
          >
            <Muted>The invoice stays on record as cancelled and can&apos;t be paid. This can&apos;t be undone.</Muted>
            <Field label="Reason (min 3 characters)">
              <Input value={reason} onChangeText={setReason} multiline maxLength={300} placeholder="e.g. created by mistake" />
            </Field>
            <ErrorBox error={cancel.error} />
          </Sheet>
        </>
      ) : null}
    </Screen>
  );
}
