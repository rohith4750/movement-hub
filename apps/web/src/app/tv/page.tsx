"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, Clock, Maximize2, Minimize2, QrCode, Sparkles, Volume2, VolumeX, ShieldCheck, Stethoscope } from "lucide-react";
import { enableAudioOnFirstInteraction, playClinicChime } from "@/lib/tv-chime";

interface SessionItem {
  id: string;
  appointmentNo: string;
  patientName: string;
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
  nowInSession: SessionItem[];
  nextUp: NextUpItem[];
  slides: SlideItem[];
  serverTime: string;
}

export default function TvWaitingBoardPage() {
  const [clock, setClock] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);

  // Call-out flash banner state
  const [callout, setCallout] = useState<{ patientName: string; therapistName: string; roomOrBay: string } | null>(null);
  const knownActiveIds = useRef<Set<string>>(new Set());
  const initialFetchDone = useRef(false);

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
    refetchInterval: 20_000, // Checks every 20 seconds
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
      // First load: just record existing in-progress sessions without chiming
      knownActiveIds.current = currentIds;
      initialFetchDone.current = true;
      return;
    }

    // Find sessions that just transitioned into IN_PROGRESS
    const newlyStarted = data.nowInSession.find((s) => !knownActiveIds.current.has(s.id));
    if (newlyStarted) {
      // Trigger chime
      if (audioEnabled) {
        playClinicChime();
      }

      // Trigger high-contrast flash banner
      setCallout({
        patientName: newlyStarted.patientName,
        therapistName: newlyStarted.therapistName,
        roomOrBay: newlyStarted.roomOrBay,
      });

      // Clear callout banner after 9 seconds
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
      playClinicChime(); // play test chime on enable
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

  return (
    <div
      onClick={enableAudioOnFirstInteraction}
      className="flex h-screen w-screen flex-col overflow-hidden bg-[#070D1E] text-slate-100 select-none font-sans"
    >
      {/* ── TOP HEADER (Clinic Identity + Live Clock + Controls) ── */}
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
                WAITING BOARD
              </span>
            </div>
            <p className="text-xs font-medium text-slate-400">
              {data?.clinic.name ?? "Physiotherapy & Rehabilitation Clinic"}
            </p>
          </div>
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

      {/* ── MAIN TWO-COLUMN TV DISPLAY ── */}
      <main className="grid flex-1 grid-cols-12 gap-6 p-6 min-h-0">
        {/* ── LEFT COLUMN: CLINICAL QUEUE (NOW IN SESSION & NEXT UP) ── */}
        <section className="col-span-8 flex flex-col gap-5 min-h-0">
          {/* 1. NOW IN SESSION */}
          <div className="flex flex-col rounded-2xl border border-slate-800/90 bg-[#0E1A38] p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-3.5 w-3.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-500" />
                </span>
                <h2 className="text-lg font-black tracking-wide text-white uppercase">NOW IN SESSION</h2>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                {data?.nowInSession.length ? `${data.nowInSession.length} Active` : "No Active Sessions"}
              </span>
            </div>

            {data?.nowInSession && data.nowInSession.length > 0 ? (
              <div className="grid grid-cols-2 gap-3.5">
                {data.nowInSession.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-xl border border-slate-700/60 bg-[#14234C] p-4 shadow-md transition"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="h-10 w-2.5 rounded-full"
                        style={{ backgroundColor: item.colorTag || "#3b82f6" }}
                      />
                      <div>
                        <div className="text-lg font-bold text-white tracking-tight">
                          {item.therapistName}
                        </div>
                        <div className="text-sm font-semibold text-amber-300">
                          {item.patientName}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="inline-block rounded-md bg-emerald-950/80 px-2.5 py-1 text-xs font-bold text-emerald-300 border border-emerald-500/30">
                        {item.roomOrBay}
                      </span>
                      <div className="mt-1 font-mono text-xs text-slate-400">{item.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-slate-800 bg-[#111E40]/60 text-slate-400">
                <div className="text-center">
                  <Stethoscope className="mx-auto mb-1 text-slate-500" size={24} />
                  <p className="text-sm font-medium">No sessions currently in progress</p>
                  <p className="text-xs text-slate-500">Upcoming appointments will appear below</p>
                </div>
              </div>
            )}
          </div>

          {/* 2. NEXT UP */}
          <div className="flex flex-1 flex-col rounded-2xl border border-slate-800/90 bg-[#0E1A38] p-5 shadow-xl min-h-0">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Clock className="text-amber-400" size={20} />
                <h2 className="text-lg font-black tracking-wide text-white uppercase">NEXT UP</h2>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                {data?.nextUp.length ? `${data.nextUp.length} in queue` : "Queue Clear"}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {data?.nextUp && data.nextUp.length > 0 ? (
                data.nextUp.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#122045]/90 px-4 py-3 shadow-sm hover:border-slate-700 transition"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 font-mono text-sm font-bold text-amber-300 border border-slate-700">
                        {item.queueNo}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-white">{item.patientName}</span>
                          <span className="text-xs font-normal text-slate-400">➔</span>
                          <span className="text-sm font-semibold text-slate-200">{item.therapistName}</span>
                        </div>
                        <span className="text-xs text-slate-400 font-mono">{item.appointmentNo}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {item.status === "CHECKED_IN" ? (
                        <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-300 border border-amber-500/40">
                          Waiting in Lounge
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300 border border-slate-700">
                          Scheduled
                        </span>
                      )}
                      <div className="font-mono text-sm font-bold text-white">{item.time}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex h-36 items-center justify-center text-slate-400">
                  <p className="text-sm">No waiting patients at this time.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── RIGHT COLUMN: ROTATING SLIDES & ANNOUNCEMENTS ── */}
        <section className="col-span-4 flex flex-col gap-4">
          <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-800/90 bg-[#0E1A38] p-6 shadow-xl">
            {currentSlide ? (
              <div className="flex flex-col justify-between h-full">
                {/* Slide Tag & Title */}
                <div>
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-300 border border-amber-500/30 uppercase tracking-wider mb-4">
                    <Sparkles size={14} />
                    {currentSlide.tag}
                  </div>

                  <h3 className="text-2xl font-black text-white leading-tight mb-4">
                    {currentSlide.title}
                  </h3>

                  <p className="whitespace-pre-line text-base text-slate-300 leading-relaxed font-normal">
                    {currentSlide.body}
                  </p>
                </div>

                {/* QR Code or Subtitle */}
                <div className="mt-6 pt-6 border-t border-slate-800">
                  {currentSlide.qrUrl ? (
                    <div className="flex items-center gap-4 rounded-xl bg-[#122045] p-3.5 border border-slate-700">
                      <div className="relative h-24 w-24 shrink-0 rounded-lg bg-white p-1 shadow-md">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(currentSlide.qrUrl)}`}
                          alt="QR Code"
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-xs font-bold uppercase text-amber-400">
                          <QrCode size={14} />
                          {currentSlide.qrLabel ?? "Scan QR Code"}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          Use your phone camera to scan and connect directly.
                        </p>
                      </div>
                    </div>
                  ) : currentSlide.subtitle ? (
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                      <ShieldCheck size={16} className="text-amber-400" />
                      {currentSlide.subtitle}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-slate-400">
                Loading clinic announcements...
              </div>
            )}

            {/* Slide Pagination Dots */}
            {data?.slides && data.slides.length > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2 pt-2">
                {data.slides.map((s, idx) => (
                  <button
                    key={s.id}
                    onClick={() => setSlideIndex(idx)}
                    className={clsx(
                      "h-2 rounded-full transition-all",
                      slideIndex % data.slides.length === idx ? "w-8 bg-amber-400" : "w-2 bg-slate-700"
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* ── FOOTER: PRIVACY NOTICE & STAFF LINK ── */}
      <footer className="flex h-10 shrink-0 items-center justify-between border-t border-slate-800/80 bg-[#091024] px-8 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span>Updates automatically every 20s · Patient names privacy-masked</span>
        </div>
        <div>
          <Link href="/tv/staff" className="hover:text-slate-300 transition underline underline-offset-2">
            Switch to Staff Wall
          </Link>
        </div>
      </footer>
    </div>
  );
}

