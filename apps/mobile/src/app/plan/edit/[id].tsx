import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { goBack, RequireRole } from "@/components/form";
import { PlanEditor } from "@/components/plan-editor";
import { Card, ErrorBox, Loading, Muted, Screen, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import type { TreatmentPlan } from "@/lib/types";

type Detail = TreatmentPlan & { patient: { id: string; patientCode: string; firstName: string; lastName: string | null } };

export default function EditPlanScreen() {
  return (
    <RequireRole roles={["PHYSIOTHERAPIST", "ADMIN"]} title="Edit treatment plan">
      <EditPlan />
    </RequireRole>
  );
}

function EditPlan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["plan", id], queryFn: () => api.get<Detail>(`/treatment-plans/${id}`), enabled: !!id });
  const p = q.data;
  const closed = p && !["DRAFT", "ACTIVE"].includes(p.status);

  return (
    <Screen edges={["top", "bottom"]}>
      <TopBar title="Edit treatment plan" onBack={() => goBack({ pathname: "/plan/[id]", params: { id } })} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : p ? (
        closed ? (
          <Card><Muted>This plan is {p.status.toLowerCase()} and can no longer be edited.</Muted></Card>
        ) : (
          <>
            <Muted>{p.planNo} · {fullName(p.patient)}</Muted>
            {/* key forces a fresh form if the plan reloads with different data */}
            <PlanEditor key={p.id} plan={p} onSaved={(planId) => router.replace({ pathname: "/plan/[id]", params: { id: planId } })} />
          </>
        )
      ) : null}
    </Screen>
  );
}
