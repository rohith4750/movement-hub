"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Bell,
  Clock,
  Maximize2,
  Minimize2,
  QrCode,
  Sparkles,
  Volume2,
  VolumeX,
  ShieldCheck,
  Stethoscope,
  UserCheck,
  CalendarDays,
  LayoutGrid,
  Users2,
  Layers,
  CheckCircle2,
} from "lucide-react";
import { enableAudioOnFirstInteraction, playClinicChime } from "@/lib/tv-chime";

interface SessionItem {
  id: string;
  appointmentNo: string;
  patientName: string;
  therapistId?: string;
  therapistName: string;
  colorTag: string;
  time: string;
  type: string;
  roomOrBay: string;
  sessionNumber: number | null;
}

interface NextUpItem {
  id: string;
  appointmentNo: string;
  patientName: string;
  therapistName: string;
  colorTag: string;
  time: string;
  status: string;
  type: string;
  queueNo: number;
}

interface TherapistItem {
  id: string;
  name: string;
  qualification: string;
  experienceYears: number;
  specializations: string[];
  colorTag: string;
  isOnLeave: boolean;
  isFreeNow: boolean;
  statusText: string;
  currentSession: {
    roomOrBay: string;
    endsAt: string;
  } | null;
  nextAppointmentTime: string | null;
  freeSlotsCount: number;
  freeSlots: string[];
}

interface SummaryData {
  totalPhysios: number;
  freeNowCount: number;
  inSessionCount: number;
  onLeaveCount: number;
  totalFreeSlots: number;
}

interface SlideItem {
  id: string;
  tag: string;
  title: string;
  body: string;
  subtitle?: string;
  qrUrl?: string;
  qrLabel?: string;
}

interface BoardData {
  clinic: {
    id: string;
    name: string;
    code: string;
    phone: string | null;
    openingTime: string;
    closingTime: string;
  };
  summary?: SummaryData;
  therapists?: TherapistItem[];
  nowInSession: SessionItem[];
  nextUp: NextUpItem[];
  slides: SlideItem[];
  serverTime: string;
}

type TvViewMode = "doctors" | "queue" | "split";

export default function TvWaitingBoardPage() {
  const [clock, setClock] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);

  // View mode: "doctors" (physiotherapists & free slots), "queue" (now in session & next up), or "split"
  const [viewMode, setViewMode] = useState<TvViewMode>("doctors");

  // Call-out flash banner state
  const [callout, setCallout] = useState<{ patientName: string; therapistName: string; roomOrBay: string } | null>(null);
  const knownActiveIds = useRef<Set<string>>(new Set());
  const initialFetchDone = useRef(false);

  // Read view mode from URL params or localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlView = params.get("view") as TvViewMode | null;
      if (urlView && ["doctors", "queue", "split"].includes(urlView)) {
        setViewMode(urlView);
      } else {
        const saved = localStorage.getItem("movement_hub_tv_view") as TvViewMode | null;
        if (saved && ["doctors", "queue", "split"].includes(saved)) {
          setViewMode(saved);
        }
      }
    }
  }, []);

  const changeViewMode = (mode: TvViewMode) => {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("movement_hub_tv_view", mode);
    }
  };

  // 1. Digital Clock (IST / Local time)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }));
      setDateStr(now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Fetch Board data every 20 seconds
  const { data, isError, isLoading } = useQuery<BoardData>({
    queryKey: ["tv-board"],
    queryFn: async () => {
      const res = await fetch("/api/v1/tv/board");
      if (!res.ok) throw new Error("Failed to load TV board data");
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  // 3. Screen Wake Lock (keeps TV display awake)
  useEffect(() => {
    if (typeof window !== "undefined" && "wakeLock" in navigator) {
      let lock: unknown = null;
      const requestLock = async () => {
        try {
          lock = await (navigator as unknown as { wakeLock: { request: (type: string) => Promise<unknown> } }).wakeLock.request("screen");
        } catch {
          // wake lock optional
        }
      };
      requestLock();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") requestLock();
      });
    }
  }, []);

  // 4. Call-out & Chime Trigger Detection
  useEffect(() => {
    if (!data?.nowInSession) return;

    const currentIds = new Set(data.nowInSession.map((s) => s.id));

    if (!initialFetchDone.current) {
      knownActiveIds.current = currentIds;
      initialFetchDone.current = true;
      return;
    }

    const newlyStarted = data.nowInSession.find((s) => !knownActiveIds.current.has(s.id));
    if (newlyStarted) {
      if (audioEnabled) {
        playClinicChime();
      }

      setCallout({
        patientName: newlyStarted.patientName,
        therapistName: newlyStarted.therapistName,
        roomOrBay: newlyStarted.roomOrBay,
      });

      const timeout = setTimeout(() => {
        setCallout(null);
      }, 9000);

      knownActiveIds.current = currentIds;
      return () => clearTimeout(timeout);
    }

    knownActiveIds.current = currentIds;
  }, [data?.nowInSession, audioEnabled]);

  // 5. Rotate Right-Panel Slides every 9 seconds
  useEffect(() => {
    if (!data?.slides || data.slides.length <= 1) return;
    const timer = setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % data.slides.length);
    }, 9000);
    return () => clearInterval(timer);
  }, [data?.slides]);

  // Audio Toggle
  const toggleAudio = () => {
    enableAudioOnFirstInteraction();
    if (!audioEnabled) {
      playClinicChime();
    }
    setAudioEnabled(!audioEnabled);
  };

  // Fullscreen Toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const currentSlide = data?.slides ? data.slides[slideIndex % data.slides.length] : null;
  const summary = data?.summary;
  const therapists = data?.therapists ?? [];

  return (
    <div
      onClick={enableAudioOnFirstInteraction}
      className="flex h-screen w-screen flex-col overflow-hidden bg-[#070D1E] text-slate-100 select-none font-sans"
    >
      {/* ── TOP HEADER (Clinic Identity + Live Clock + Mode Switcher + Controls) ── */}
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-slate-800/80 bg-[#0B142B] px-8 shadow-lg">
        {/* Brand */}
        <div className="flex items-center gap-4">
          <div className="relative h-12 w-12 overflow-hidden rounded-lg border border-amber-500/40 bg-white shadow-md">
            <Image src="/brand/movement-hub-logo.jpg" alt="Movement Hub" fill className="object-contain" priority />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-white">Movement Hub</h1>
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300 border border-amber-500/30">
                CLINIC DISPLAY
              </span>
            </div>
            <p className="text-xs font-medium text-slate-400">
              {data?.clinic.name ?? "Physiotherapy & Rehabilitation Clinic"}
            </p>
          </div>
        </div>

        {/* View Mode Switcher Pills */}
        <div className="flex items-center rounded-xl bg-slate-900/90 p-1 border border-slate-800">
          <button
            onClick={() => changeViewMode("doctors")}
            className={clsx(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition",
              viewMode === "doctors"
                ? "bg-emerald-600 text-white shadow-md"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            <Stethoscope size={15} />
            <span>Doctors & Free Slots</span>
            {summary?.freeNowCount !== undefined ? (
              <span className={clsx("rounded-full px-1.5 py-0.2 text-[10px] font-extrabold", viewMode === "doctors" ? "bg-emerald-950 text-emerald-200" : "bg-slate-800 text-slate-300")}>
                {summary.freeNowCount} Free
              </span>
            ) : null}
          </button>

          <button
            onClick={() => changeViewMode("split")}
            className={clsx(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition",
              viewMode === "split"
                ? "bg-indigo-600 text-white shadow-md"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            <Layers size={15} />
            <span>Split View</span>
          </button>

          <button
            onClick={() => changeViewMode("queue")}
            className={clsx(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition",
              viewMode === "queue"
                ? "bg-amber-600 text-white shadow-md"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            <Clock size={15} />
            <span>Queue Board</span>
            {data?.nowInSession?.length ? (
              <span className={clsx("rounded-full px-1.5 py-0.2 text-[10px] font-extrabold", viewMode === "queue" ? "bg-amber-950 text-amber-200" : "bg-slate-800 text-slate-300")}>
                {data.nowInSession.length} Active
              </span>
            ) : null}
          </button>
        </div>

        {/* Live Clock & Date */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="font-mono text-3xl font-extrabold tracking-wide text-white drop-shadow-sm">
              {clock || "--:--:--"}
            </div>
            <div className="text-xs font-medium text-slate-400">{dateStr}</div>
          </div>

          {/* Quick TV Control Badges */}
          <div className="flex items-center gap-2 pl-4 border-l border-slate-800">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleAudio();
              }}
              title={audioEnabled ? "Sound enabled (Chimes active)" : "Click to enable call chime"}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition border",
                audioEnabled
                  ? "bg-emerald-950/80 border-emerald-500/50 text-emerald-300"
                  : "bg-amber-950/60 border-amber-500/40 text-amber-200 animate-pulse"
              )}
            >
              {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              <span>{audioEnabled ? "Chime On" : "Tap for Sound"}</span>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFullscreen();
              }}
              className="rounded-lg border border-slate-700 bg-slate-800/80 p-2 text-slate-300 hover:text-white"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>
      </header>

      {/* ── CALL-OUT FLASH OVERLAY (When a Physio calls a patient) ── */}
      {callout && (
        <div className="absolute inset-x-8 top-24 z-50 animate-bounce rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 p-6 text-slate-950 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-amber-400 shadow-inner">
                <Bell size={32} className="animate-spin" />
              </div>
              <div>
                <span className="text-xs font-black tracking-widest uppercase text-slate-950">
                  🔔 NOW CALLING TO {callout.roomOrBay.toUpperCase()}
                </span>
                <div className="text-3xl font-black text-slate-950">
                  {callout.patientName} <span className="font-medium text-slate-900">➔</span> {callout.therapistName}
                </div>
              </div>
            </div>
            <div className="rounded-xl bg-slate-950 px-6 py-3 text-center text-amber-300 font-bold text-lg shadow">
              Please Proceed Inside
            </div>
          </div>
        </div>
      )}

      {/* ── METRIC BANNER (How many physiotherapists & free slots) ── */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#0C1630] px-8 py-2.5 text-xs shadow-inner">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Stethoscope className="text-emerald-400" size={17} />
            <span className="text-slate-400">Total Physiotherapists:</span>
            <span className="font-bold text-white text-sm">{summary?.totalPhysios ?? therapists.length} On Duty</span>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-slate-400">Currently Free:</span>
            <span className="font-bold text-emerald-300 text-sm">{summary?.freeNowCount ?? 0} Ready Now</span>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
            <span className="text-slate-400">In Session:</span>
            <span className="font-bold text-blue-300 text-sm">{summary?.inSessionCount ?? 0}</span>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          <div className="flex items-center gap-2">
            <CalendarDays className="text-amber-400" size={16} />
            <span className="text-slate-400">Available Free Slots Today:</span>
            <span className="font-bold text-amber-300 text-sm">{summary?.totalFreeSlots ?? 0} Open Slots</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-slate-400 font-medium">
          <span>Walk-ins Welcome</span>
          <span>·</span>
          <span>Helpline: {data?.clinic.phone ?? "+91 98765 43210"}</span>
        </div>
      </div>

      {/* ── MAIN CONTENT AREA ── */}
      <main className="grid flex-1 grid-cols-12 gap-6 p-6 min-h-0 overflow-hidden">
        {/* VIEW 1: DOCTORS & FREE SLOTS (Primary Request) */}
        {viewMode === "doctors" && (
          <section className="col-span-12 flex flex-col gap-4 min-h-0 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {therapists.map((physio) => (
                <div
                  key={physio.id}
                  className={clsx(
                    "flex flex-col rounded-2xl border p-5 shadow-xl transition-all",
                    physio.isFreeNow
                      ? "border-emerald-500/50 bg-[#0E2338]/90 ring-1 ring-emerald-500/20"
                      : physio.isOnLeave
                      ? "border-slate-800 bg-[#0E1528]/80 opacity-70"
                      : "border-slate-800 bg-[#0E1A38]"
                  )}
                >
                  {/* Doctor Card Header */}
                  <div className="flex items-start justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl font-black text-xl text-white shadow-md"
                        style={{ backgroundColor: physio.colorTag || "#059669" }}
                      >
                        {physio.name.replace(/^(Dr\.?|Dr\s+)/i, "").trim().charAt(0) || "D"}
                      </div>
                      <div>
                        <h2 className="text-xl font-bold tracking-tight text-white">{physio.name}</h2>
                        <p className="text-xs font-medium text-slate-400">{physio.qualification}</p>
                        {physio.experienceYears > 0 ? (
                          <span className="text-[11px] font-semibold text-slate-400">
                            {physio.experienceYears}+ years experience
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Live Status Pill */}
                    {physio.isOnLeave ? (
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold text-slate-400 border border-slate-700">
                        ON LEAVE
                      </span>
                    ) : physio.isFreeNow ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-emerald-950 px-3 py-1 text-xs font-extrabold text-emerald-300 border border-emerald-500/60 shadow-lg shadow-emerald-950/50 animate-pulse">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        FREE NOW
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 rounded-full bg-blue-950 px-3 py-1 text-xs font-bold text-blue-300 border border-blue-500/40">
                        <span className="h-2 w-2 rounded-full bg-blue-400" />
                        IN SESSION
                      </span>
                    )}
                  </div>

                  {/* Specializations */}
                  {physio.specializations && physio.specializations.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {physio.specializations.map((spec) => (
                        <span
                          key={spec}
                          className="rounded-md bg-slate-800/90 px-2 py-0.5 text-[11px] font-semibold text-slate-300 border border-slate-700/60"
                        >
                          {spec}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {/* Current Activity / Session Info */}
                  <div className="mt-4 rounded-xl bg-slate-900/80 p-3 border border-slate-800/80 text-xs">
                    {physio.isFreeNow ? (
                      <div className="flex items-center justify-between text-emerald-300 font-semibold">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 size={15} />
                          Ready for immediate walk-in consultation
                        </span>
                        {physio.nextAppointmentTime ? (
                          <span className="text-slate-400 font-normal">Next: {physio.nextAppointmentTime}</span>
                        ) : null}
                      </div>
                    ) : physio.currentSession ? (
                      <div className="flex items-center justify-between text-slate-300">
                        <span>
                          Occupied in <strong className="text-amber-300 font-semibold">{physio.currentSession.roomOrBay}</strong>
                        </span>
                        <span className="font-mono text-slate-400">Available ~{physio.currentSession.endsAt}</span>
                      </div>
                    ) : physio.isOnLeave ? (
                      <span className="text-slate-400">Not taking appointments today</span>
                    ) : (
                      <span className="text-slate-400">Scheduled for today</span>
                    )}
                  </div>

                  {/* Free Slots Grid */}
                  <div className="mt-4 flex-1 flex flex-col justify-end">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Clock size={14} className="text-amber-400" />
                        Available Slots Today:
                      </span>
                      <span className={clsx("text-xs font-bold font-mono", physio.freeSlotsCount > 0 ? "text-emerald-400" : "text-slate-500")}>
                        {physio.freeSlotsCount} Free
                      </span>
                    </div>

                    {physio.freeSlots && physio.freeSlots.length > 0 ? (
                      <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
                        {physio.freeSlots.slice(0, 8).map((slotTime) => (
                          <span
                            key={slotTime}
                            className="rounded-lg bg-emerald-950/70 border border-emerald-500/40 px-2.5 py-1 font-mono text-xs font-bold text-emerald-200 hover:border-emerald-400 transition"
                          >
                            {slotTime}
                          </span>
                        ))}
                        {physio.freeSlots.length > 8 ? (
                          <span className="rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300">
                            +{physio.freeSlots.length - 8} more
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/50 p-3 text-center text-xs text-slate-500">
                        {physio.isOnLeave ? "On leave today" : "No remaining free slots today · Inquire at desk"}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {therapists.length === 0 && (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-[#0E1A38] text-slate-400">
                <div className="text-center">
                  <Stethoscope className="mx-auto mb-2 text-slate-600" size={36} />
                  <p className="text-base font-semibold">No active physiotherapists configured</p>
                  <p className="text-xs text-slate-500">Add staff in Settings or Web Portal</p>
                </div>
              </div>
            )}
          </section>
        )}

        {/* VIEW 2: SPLIT VIEW (Doctors on Left, Queue & Slides on Right) */}
        {viewMode === "split" && (
          <>
            {/* Left Column: Doctor Availability & Free Slots */}
            <section className="col-span-7 flex flex-col gap-4 min-h-0 overflow-y-auto pr-1">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Stethoscope className="text-emerald-400" size={20} />
                  <h2 className="text-lg font-black tracking-wide text-white uppercase">PHYSIOTHERAPISTS ON DUTY</h2>
                </div>
                <span className="text-xs font-bold text-emerald-400 font-mono">
                  {summary?.freeNowCount ?? 0} Free Now
                </span>
              </div>

              <div className="space-y-3.5">
                {therapists.map((physio) => (
                  <div
                    key={physio.id}
                    className={clsx(
                      "flex flex-col rounded-xl border p-4 shadow-md transition",
                      physio.isFreeNow
                        ? "border-emerald-500/50 bg-[#0E2338]/90"
                        : "border-slate-800 bg-[#0E1A38]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-10 w-2.5 rounded-full"
                          style={{ backgroundColor: physio.colorTag || "#059669" }}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-white">{physio.name}</span>
                            <span className="text-xs text-slate-400">{physio.qualification}</span>
                          </div>
                          {physio.specializations?.length ? (
                            <span className="text-xs text-slate-400">
                              {physio.specializations.slice(0, 2).join(" · ")}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {physio.isFreeNow ? (
                        <span className="rounded-full bg-emerald-950 px-2.5 py-0.5 text-xs font-bold text-emerald-300 border border-emerald-500/50">
                          ● Free Now
                        </span>
                      ) : (
                        <span className="rounded-full bg-blue-950 px-2.5 py-0.5 text-xs font-bold text-blue-300 border border-blue-500/40">
                          ● In Session
                        </span>
                      )}
                    </div>

                    {/* Free Slots Pills */}
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold text-slate-400">Free slots:</span>
                      {physio.freeSlots && physio.freeSlots.length > 0 ? (
                        physio.freeSlots.slice(0, 5).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-emerald-950/80 border border-emerald-500/30 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-200"
                          >
                            {t}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-slate-500 italic">No free slots left today</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Right Column: Queue (Now in Session & Next Up) */}
            <section className="col-span-5 flex flex-col gap-4 min-h-0 overflow-y-auto">
              <div className="flex flex-col rounded-2xl border border-slate-800 bg-[#0E1A38] p-4 shadow-xl">
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
                    <h3 className="text-sm font-bold text-white uppercase">NOW IN SESSION</h3>
                  </div>
                  <span className="text-xs text-slate-400">{data?.nowInSession.length ?? 0}</span>
                </div>
                <div className="space-y-2">
                  {data?.nowInSession && data.nowInSession.length > 0 ? (
                    data.nowInSession.slice(0, 4).map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-lg bg-[#14234C] p-2.5 text-xs">
                        <div>
                          <strong className="text-white block font-semibold">{item.therapistName}</strong>
                          <span className="text-amber-300 font-medium">{item.patientName}</span>
                        </div>
                        <span className="rounded bg-emerald-950 px-2 py-0.5 text-emerald-300 font-mono text-[11px]">
                          {item.roomOrBay}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="py-4 text-center text-xs text-slate-500">No active sessions</div>
                  )}
                </div>
              </div>

              {/* Next Up */}
              <div className="flex-1 flex flex-col rounded-2xl border border-slate-800 bg-[#0E1A38] p-4 shadow-xl min-h-0">
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white uppercase flex items-center gap-1.5">
                    <Clock size={15} className="text-amber-400" />
                    NEXT UP
                  </h3>
                  <span className="text-xs text-slate-400">{data?.nextUp.length ?? 0} in queue</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {data?.nextUp && data.nextUp.length > 0 ? (
                    data.nextUp.slice(0, 6).map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-lg bg-[#122045] p-2.5 text-xs">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-bold text-amber-300">{item.queueNo}.</span>
                          <span className="font-semibold text-white">{item.patientName}</span>
                          <span className="text-slate-400">➔</span>
                          <span className="text-slate-300">{item.therapistName}</span>
                        </div>
                        <span className="font-mono text-white font-bold">{item.time}</span>
                      </div>
                    ))
                  ) : (
                    <div className="py-6 text-center text-xs text-slate-500">Queue is clear</div>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {/* VIEW 3: QUEUE BOARD ONLY */}
        {viewMode === "queue" && (
          <>
            {/* Left: Queue */}
            <section className="col-span-8 flex flex-col gap-5 min-h-0">
              {/* NOW IN SESSION */}
              <div className="flex flex-col rounded-2xl border border-slate-800 bg-[#0E1A38] p-5 shadow-xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="h-3 w-3 rounded-full bg-emerald-400 animate-ping" />
                    <h2 className="text-lg font-black tracking-wide text-white uppercase">NOW IN SESSION</h2>
                  </div>
                  <span className="text-xs font-semibold text-slate-400">{data?.nowInSession.length ?? 0} Active</span>
                </div>
                <div className="grid grid-cols-2 gap-3.5">
                  {data?.nowInSession?.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-700 bg-[#14234C] p-4">
                      <div>
                        <div className="text-lg font-bold text-white">{item.therapistName}</div>
                        <div className="text-sm font-semibold text-amber-300">{item.patientName}</div>
                      </div>
                      <div className="text-right">
                        <span className="rounded bg-emerald-950 px-2.5 py-1 text-xs font-bold text-emerald-300">
                          {item.roomOrBay}
                        </span>
                        <div className="mt-1 font-mono text-xs text-slate-400">{item.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* NEXT UP */}
              <div className="flex-1 flex flex-col rounded-2xl border border-slate-800 bg-[#0E1A38] p-5 shadow-xl min-h-0">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-black tracking-wide text-white uppercase flex items-center gap-2">
                    <Clock size={20} className="text-amber-400" />
                    NEXT UP
                  </h2>
                  <span className="text-xs text-slate-400">{data?.nextUp.length ?? 0} in queue</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {data?.nextUp?.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-xl bg-[#122045] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-base font-bold text-amber-300">{item.queueNo}.</span>
                        <span className="text-base font-bold text-white">{item.patientName}</span>
                        <span className="text-slate-400 text-xs">➔</span>
                        <span className="text-sm text-slate-300">{item.therapistName}</span>
                      </div>
                      <span className="font-mono text-sm font-bold text-white">{item.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Right: Rotating Slide */}
            <aside className="col-span-4 flex flex-col rounded-2xl border border-slate-800 bg-[#0B152F] p-6 shadow-xl">
              {currentSlide && (
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300 border border-amber-500/30">
                      {currentSlide.tag}
                    </span>
                    <h3 className="mt-3 text-2xl font-bold text-white">{currentSlide.title}</h3>
                    <p className="mt-4 text-sm text-slate-300 whitespace-pre-line leading-relaxed">{currentSlide.body}</p>
                  </div>
                  {currentSlide.qrUrl && (
                    <div className="mt-6 flex flex-col items-center justify-center p-4 rounded-xl bg-white text-slate-900 shadow">
                      <QrCode size={110} />
                      <span className="mt-2 text-xs font-bold uppercase">{currentSlide.qrLabel ?? "Scan with Phone"}</span>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </>
        )}
      </main>
    </div>
  );
}
