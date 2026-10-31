"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Empty, ErrorText, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { addDays, date, fullName, label, time, today } from "@/lib/format";

interface CalSlot {
  id: string;
  startAt: string;
  endAt: string;
  status: "AVAILABLE" | "BOOKED" | "BLOCKED";
  appointment: { id: string; appointmentNo: string; type: string; status: string; patient: { firstName: string; lastName: string | null } } | null;
}
interface CalTherapist { id: string; name: string; colorTag: string | null; leaves: { id: string }[]; slots: CalSlot[] }
interface Calendar { from: string; days: number; therapists: CalTherapist[] }

export default function SchedulePage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [day, setDay] = useState(today());
  const cal = useQuery({ queryKey: ["calendar", day], queryFn: () => api.get<Calendar>("/calendar", { view: "day", date: day }) });

  const toggle = useMutation({
    mutationFn: (s: CalSlot) => api.patch(`/slots/${s.id}`, { status: s.status === "BLOCKED" ? "AVAILABLE" : "BLOCKED" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar"] }),
  });

  const times = useMemo(() => {
    const set = new Set<string>();
    cal.data?.therapists.forEach((t) => t.slots.forEach((s) => set.add(time(s.startAt))));
    return [...set].sort();
  }, [cal.data]);

  const canBlock = hasRole(user, "ADMIN", "RECEPTIONIST");

  return (
    <>
      <PageHeader
        title="Therapist schedule"
        subtitle={date(`${day}T06:00:00Z`)}
        actions={
          <>
            <button className="btn-ghost" onClick={() => setDay(addDays(day, -1))}><ChevronLeft size={16} /></button>
            <button className="btn-ghost" onClick={() => setDay(today())}>Today</button>
            <input type="date" className="input w-44" value={day} onChange={(e) => setDay(e.target.value)} />
            <button className="btn-ghost" onClick={() => setDay(addDays(day, 1))}><ChevronRight size={16} /></button>
          </>
        }
      />
      <ErrorText error={toggle.error} />
      <div className="card table-wrap p-0">
        {cal.isLoading ? <Spinner /> : !cal.data || times.length === 0 ? (
          <Empty>No slots for this day. Admins can generate slots from the Therapists page.</Empty>
        ) : (
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-white shadow-sm">
              <tr>
                <th className="sticky left-0 w-20 bg-white p-2 text-left text-navy-500">Time</th>
                {cal.data.therapists.map((t) => (
                  <th key={t.id} className="border-l border-navy-50 p-2 text-left">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: t.colorTag ?? "#c9a14a" }} />
                    {t.name} {t.leaves.length > 0 && <span className="text-rose-600">(leave)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((tm) => (
                <tr key={tm} className="border-t border-navy-50">
                  <td className="sticky left-0 bg-white p-2 font-semibold text-navy-500">{tm}</td>
                  {cal.data!.therapists.map((t) => {
                    const s = t.slots.find((x) => time(x.startAt) === tm);
                    if (!s) return <td key={t.id} className="border-l border-navy-50 bg-slate-50" />;
                    return (
                      <td key={t.id} className="border-l border-navy-50 p-1">
                        {s.appointment ? (
                          <div className="rounded-md px-2 py-1 text-white" style={{ background: t.colorTag ?? "#1b2160" }}>
                            <div className="font-semibold">{fullName(s.appointment.patient)}</div>
                            <div className="opacity-80">{label(s.appointment.type)} · {label(s.appointment.status)}</div>
                          </div>
                        ) : (
                          <button
                            disabled={!canBlock || toggle.isPending}
                            onClick={() => toggle.mutate(s)}
                            className={clsx("w-full rounded-md px-2 py-2 text-left", s.status === "BLOCKED" ? "bg-slate-200 text-slate-500 line-through" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100")}
                            title={canBlock ? (s.status === "BLOCKED" ? "Unblock slot" : "Block slot") : undefined}
                          >
                            {s.status === "BLOCKED" ? "Blocked" : "Free"}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
