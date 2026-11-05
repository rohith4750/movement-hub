"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Bell, CheckCircle2, Clock, Key, ShieldCheck, UserCheck, Users } from "lucide-react";
import { api } from "@/lib/api";

interface StaffAppointment {
  id: string;
  appointmentNo: string;
  patientName: string;
  patientCode: string;
  status: string;
  source: string;
  type: string;
  time: string;
  planTitle: string | null;
}

interface StaffColumn {
  id: string;
  name: string;
  colorTag: string;
  appointmentCount: number;
  appointments: StaffAppointment[];
}

interface StaffData {
  clinic: { name: string; code: string };
  stats: {
    total: number;
    checkedIn: number;
    inProgress: number;
    completed: number;
    walkIns: number;
  };
  columns: StaffColumn[];
  serverTime: string;
}

export default function TvStaffWallPage() {
  const qc = useQueryClient();
  const [clock, setClock] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);

  // Digital clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }));
      setDateStr(now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load key from localStorage or query string
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlKey = new URLSearchParams(window.location.search).get("key");
      const local = localStorage.getItem("mh_tv_staff_key");
      if (urlKey) {
        setSavedKey(urlKey);
        localStorage.setItem("mh_tv_staff_key", urlKey);
      } else if (local) {
        setSavedKey(local);
      }
    }
  }, []);

  // Fetch staff wall feed
  const { data, error, isLoading } = useQuery<StaffData>({
    queryKey: ["tv-staff", savedKey],
    queryFn: async () => {
      const url = savedKey ? `/api/v1/tv/staff?key=${encodeURIComponent(savedKey)}` : `/api/v1/tv/staff`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 401) throw new Error("INVALID_KEY");
        throw new Error("Failed to load staff wall");
      }
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 20_000,
    retry: false,
  });

  // Call patient to waiting room screen
  const callPatient = useMutation({
    mutationFn: async ({ appointmentId }: { appointmentId: string }) => {
      const res = await fetch("/api/v1/tv/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });
      if (!res.ok) throw new Error("Call failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tv-staff"] });
      qc.invalidateQueries({ queryKey: ["tv-board"] });
    },
  });

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    localStorage.setItem("mh_tv_staff_key", keyInput.trim());
    setSavedKey(keyInput.trim());
  };

  // If Key is required
  if (error && (error as Error).message === "INVALID_KEY") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#070D1E] p-6 text-white font-sans">
        <form onSubmit={handleSaveKey} className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0E1A38] p-8 shadow-2xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 mb-4 border border-amber-500/30">
            <Key size={24} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Staff Wall Access Key</h2>
          <p className="text-xs text-slate-400 mb-6">
            This screen displays confidential clinic metrics and staff workloads. Enter the TV staff key configured in Admin Settings.
          </p>

          <input
            type="password"
            placeholder="Enter Staff Key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none mb-4"
            autoFocus
          />

          <button type="submit" className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 transition">
            Unlock Staff Wall
          </button>

          <div className="mt-4 text-center">
            <Link href="/tv" className="text-xs text-slate-400 hover:text-white underline">
              Back to Patient Waiting Board
            </Link>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#070D1E] text-slate-100 select-none font-sans">
      {/* ── TOP HEADER ── */}
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-slate-800/80 bg-[#0B142B] px-8 shadow-lg">
        <div className="flex items-center gap-4">
          <Link
            href="/tv"
            className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
          >
            <ArrowLeft size={16} />
            <span>Waiting Board</span>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-white">Staff Operations Wall</h1>
              <span className="rounded bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-300 border border-rose-500/30">
                INTERNAL
              </span>
            </div>
            <p className="text-xs font-medium text-slate-400">
              {data?.clinic.name} · Real-time Physio Load &amp; Schedule
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* KPI Summary Tiles */}
          {data?.stats && (
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-slate-800 bg-[#122045] px-3.5 py-1.5 text-center">
                <div className="text-xs text-slate-400">Total Visits</div>
                <div className="text-lg font-bold text-white">{data.stats.total}</div>
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/40 px-3.5 py-1.5 text-center">
                <div className="text-xs text-amber-300">In Lounge</div>
                <div className="text-lg font-bold text-amber-300">{data.stats.checkedIn}</div>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3.5 py-1.5 text-center">
                <div className="text-xs text-emerald-300">In Session</div>
                <div className="text-lg font-bold text-emerald-300">{data.stats.inProgress}</div>
              </div>
              <div className="rounded-xl border border-blue-500/30 bg-blue-950/40 px-3.5 py-1.5 text-center">
                <div className="text-xs text-blue-300">Completed</div>
                <div className="text-lg font-bold text-blue-300">{data.stats.completed}</div>
              </div>
              <div className="rounded-xl border border-purple-500/30 bg-purple-950/40 px-3.5 py-1.5 text-center">
                <div className="text-xs text-purple-300">Walk-Ins</div>
                <div className="text-lg font-bold text-purple-300">{data.stats.walkIns}</div>
              </div>
            </div>
          )}

          {/* Clock */}
          <div className="text-right border-l border-slate-800 pl-6">
            <div className="font-mono text-2xl font-extrabold text-white">{clock}</div>
            <div className="text-xs text-slate-400">{dateStr}</div>
          </div>
        </div>
      </header>

      {/* ── MAIN WORKLOAD BOARD (Columns per Physiotherapist) ── */}
      <main className="flex-1 overflow-x-auto p-6 min-h-0">
        <div className="flex h-full gap-5 min-w-max">
          {data?.columns && data.columns.length > 0 ? (
            data.columns.map((col) => (
              <div
                key={col.id}
                className="flex w-80 flex-col rounded-2xl border border-slate-800/90 bg-[#0E1A38] p-4 shadow-xl min-h-0"
              >
                {/* Column Header */}
                <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="h-4 w-4 rounded-full" style={{ backgroundColor: col.colorTag || "#3b82f6" }} />
                    <h3 className="font-bold text-white text-base truncate max-w-[170px]" title={col.name}>
                      {col.name}
                    </h3>
                  </div>
                  <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-bold text-slate-300">
                    {col.appointmentCount} visits
                  </span>
                </div>

                {/* Appointment Cards */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {col.appointments.length > 0 ? (
                    col.appointments.map((appt) => (
                      <div
                        key={appt.id}
                        className={clsx(
                          "rounded-xl border p-3.5 shadow-sm transition",
                          appt.status === "IN_PROGRESS"
                            ? "border-emerald-500/60 bg-emerald-950/30"
                            : appt.status === "CHECKED_IN"
                            ? "border-amber-500/50 bg-amber-950/20"
                            : appt.status === "COMPLETED"
                            ? "border-slate-800/80 bg-slate-900/60 opacity-60"
                            : "border-slate-800 bg-[#122045]"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-mono text-xs font-bold text-white">{appt.time}</span>
                          <span
                            className={clsx(
                              "rounded px-2 py-0.5 text-[10px] font-bold uppercase",
                              appt.status === "IN_PROGRESS"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : appt.status === "CHECKED_IN"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : appt.status === "COMPLETED"
                                ? "bg-slate-700 text-slate-300"
                                : "bg-slate-800 text-slate-400"
                            )}
                          >
                            {appt.status.replace("_", " ")}
                          </span>
                        </div>

                        <div className="font-semibold text-white text-sm">{appt.patientName}</div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">{appt.patientCode}</div>

                        {appt.planTitle && (
                          <div className="text-[11px] text-amber-400/90 truncate mt-1">{appt.planTitle}</div>
                        )}

                        {/* Quick Call to Screen Action */}
                        {appt.status === "CHECKED_IN" && (
                          <button
                            onClick={() => callPatient.mutate({ appointmentId: appt.id })}
                            disabled={callPatient.isPending}
                            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500/20 py-1.5 text-xs font-bold text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition"
                          >
                            <Bell size={13} />
                            <span>Call to Screen</span>
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="flex h-32 items-center justify-center text-xs text-slate-500">
                      No visits scheduled today
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="flex h-64 items-center justify-center text-slate-400">
              {isLoading ? "Loading staff schedule..." : "No active physiotherapists found for this branch."}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

