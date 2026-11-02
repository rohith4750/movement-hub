"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Spinner, Stat, StatusBadge, ErrorText, Empty } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { fullName, inr, time } from "@/lib/format";

interface Dashboard {
  totalPatients: number;
  newPatientsMonth: number;
  todayAppointments: number;
  pendingAppointments: number;
  completedSessionsToday: number;
  availableTherapists: number;
  revenueToday: number | null;
  revenueMonth: number | null;
  therapistUtilization: { therapistId: string; name: string; colorTag: string | null; onLeave: boolean; booked: number; total: number; percent: number }[];
  upcomingAppointments: { id: string; appointmentNo: string; startAt: string; type: string; status: string; patient: { firstName: string; lastName: string | null }; therapist: { user: { name: string } } }[];
}

export default function DashboardPage() {
  const user = useAuth((s) => s.user);
  const { data, isLoading, error } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/reports/dashboard"), refetchInterval: 5 * 60_000 });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorText error={error} />;

  return (
    <>
      <PageHeader title={`Welcome, ${user?.name.split(" ")[0]}`} subtitle="Here is what is happening at Movement Hub today." />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total patients" value={data.totalPatients} hint={`+${data.newPatientsMonth} this month`} />
        <Stat label="Today's appointments" value={data.todayAppointments} />
        <Stat label="Pending" value={data.pendingAppointments} hint="Awaiting confirmation" />
        <Stat label="Sessions completed" value={data.completedSessionsToday} hint="Today" />
        <Stat label="Therapists free" value={data.availableTherapists} />
        {data.revenueToday !== null && <Stat label="Revenue today" value={inr(data.revenueToday)} hint={`Month: ${inr(data.revenueMonth)}`} />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">Upcoming appointments</h2>
            <Link href="/appointments" className="text-sm font-semibold text-gold-700">View all</Link>
          </div>
          {data.upcomingAppointments.length === 0 ? (
            <Empty>No more appointments today.</Empty>
          ) : (
            <div className="table-wrap-sm"><table className="table">
              <thead><tr><th>Time</th><th>Patient</th><th>Therapist</th><th>Type</th><th>Status</th></tr></thead>
              <tbody>
                {data.upcomingAppointments.map((a) => (
                  <tr key={a.id}>
                    <td className="font-semibold">{time(a.startAt)}</td>
                    <td>{fullName(a.patient)}</td>
                    <td>{a.therapist.user.name}</td>
                    <td><StatusBadge status={a.type} /></td>
                    <td><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 font-bold">Therapist utilization (today)</h2>
          <div className="space-y-4">
            {data.therapistUtilization.map((t) => (
              <div key={t.therapistId}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-navy-500">{t.onLeave ? "On leave" : `${t.booked}/${t.total} · ${t.percent}%`}</span>
                </div>
                <div className="h-2 rounded-full bg-navy-50">
                  <div className="h-2 rounded-full" style={{ width: `${t.percent}%`, background: t.colorTag ?? "var(--color-gold-500)" }} />
                </div>
              </div>
            ))}
            {data.therapistUtilization.length === 0 && <Empty>No active therapists.</Empty>}
          </div>
        </div>
      </div>
    </>
  );
}
