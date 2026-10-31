"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorText, Field, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { label } from "@/lib/format";

type Settings = Record<string, string | number> & { branch: { name: string; gstin: string | null } };

const FIELDS: { key: string; type: "number" | "time" | "text" }[] = [
  { key: "consultationFee", type: "number" },
  { key: "therapySessionFee", type: "number" },
  { key: "homeVisitFee", type: "number" },
  { key: "travelChargePerKm", type: "number" },
  { key: "gstPercent", type: "number" },
  { key: "defaultSlotMinutes", type: "number" },
  { key: "openingTime", type: "time" },
  { key: "closingTime", type: "time" },
  { key: "cancellationHours", type: "number" },
  { key: "reminderHoursBefore", type: "number" },
  { key: "invoicePrefix", type: "text" },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setF(Object.fromEntries(FIELDS.map(({ key }) => [key, String(q.data[key] ?? "")])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.patch("/settings", Object.fromEntries(FIELDS.map(({ key, type }) => [key, type === "number" ? Number(f[key]) : f[key]]))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  if (q.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="Hospital settings" subtitle={q.data?.branch.name} />
      <div className="card grid gap-4 md:grid-cols-3">
        {FIELDS.map(({ key, type }) => (
          <Field key={key} label={label(key.replace(/([A-Z])/g, "_$1"))}>
            <input className="input" type={type} value={f[key] ?? ""} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
          </Field>
        ))}
        <div className="md:col-span-3"><ErrorText error={save.error ?? q.error} /></div>
        <div className="md:col-span-3 flex justify-end"><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? "Saved ✓" : "Save settings"}</button></div>
      </div>
    </>
  );
}
