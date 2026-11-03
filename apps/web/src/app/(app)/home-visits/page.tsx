"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { Empty, ErrorText, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { date, fullName, inr, time, today } from "@/lib/format";

interface Visit {
  id: string;
  status: string;
  distanceKm: string | null;
  travelCharge: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  patient: { firstName: string; lastName: string | null; phone: string };
  therapist: { id: string; user: { name: string } };
  address: { line1: string; line2: string | null; landmark: string | null; city: string; pincode: string; latitude: string | null; longitude: string | null };
  appointment: { appointmentNo: string; startAt: string };
}

export default function HomeVisitsPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [day, setDay] = useState(today());
  const q = useQuery({ queryKey: ["home-visits", day], queryFn: () => api.page<Visit>("/home-visits", { date: day || undefined, limit: 100 }) });

  const step = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      let coords: { latitude?: number; longitude?: number } = {};
      if ((action === "check-in" || action === "check-out") && "geolocation" in navigator) {
        coords = await new Promise((resolve) =>
          navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => resolve({}), { timeout: 8000 }),
        );
      }
      return api.post(`/home-visits/${id}/${action}`, coords);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["home-visits"] }),
  });

  return (
    <>
      <PageHeader
        title="Home physiotherapy"
        actions={
          <>
            <input type="date" className="input w-44" value={day} onChange={(e) => setDay(e.target.value)} />
            {hasRole(user, "RECEPTIONIST", "ADMIN") && <Link href="/appointments/book?type=HOME_VISIT" className="btn-primary">Book home visit</Link>}
          </>
        }
      />
      <ErrorText error={step.error} />
      {q.isLoading ? <Spinner /> : !q.data?.data.length ? <div className="card"><Empty>No home visits on this day.</Empty></div> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.data.map((v) => {
            const mine = user?.therapistId === v.therapist.id;
            const mapUrl = v.address.latitude ? `https://maps.google.com/?q=${v.address.latitude},${v.address.longitude}` : `https://maps.google.com/?q=${encodeURIComponent(`${v.address.line1}, ${v.address.city} ${v.address.pincode}`)}`;
            return (
              <div key={v.id} className="card space-y-2 text-sm">
                <div className="flex items-center justify-between"><b className="text-base">{time(v.appointment.startAt)}</b><StatusBadge status={v.status} /></div>
                <div className="font-semibold">{fullName(v.patient)} · {v.patient.phone}</div>
                <a href={mapUrl} target="_blank" rel="noreferrer" className="flex items-start gap-1 text-navy-500 hover:underline">
                  <MapPin size={14} className="mt-0.5 shrink-0" /> {v.address.line1}{v.address.landmark ? ` (near ${v.address.landmark})` : ""}, {v.address.city} {v.address.pincode}
                </a>
                <div className="text-navy-500">{v.therapist.user.name} · {v.distanceKm ? `${v.distanceKm} km · ` : ""}Travel {inr(v.travelCharge)}</div>
                {v.checkInAt && <div className="text-xs text-navy-500">In: {time(v.checkInAt)}{v.checkOutAt ? ` · Out: ${time(v.checkOutAt)}` : ""}</div>}
                {mine && (
                  <div className="flex gap-2 pt-2">
                    {v.status === "SCHEDULED" && <button className="btn-ghost px-3 py-1 text-xs" onClick={() => step.mutate({ id: v.id, action: "en-route" })}>On my way</button>}
                    {["SCHEDULED", "EN_ROUTE"].includes(v.status) && <button className="btn-gold px-3 py-1 text-xs" onClick={() => step.mutate({ id: v.id, action: "check-in" })}>Check in</button>}
                    {v.status === "CHECKED_IN" && <button className="btn-primary px-3 py-1 text-xs" onClick={() => step.mutate({ id: v.id, action: "check-out" })}>Check out &amp; complete</button>}
                  </div>
                )}
                <div className="text-xs text-navy-500">{v.appointment.appointmentNo} · {date(v.appointment.startAt)}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
