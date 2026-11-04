"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, KeyRound } from "lucide-react";
import Link from "next/link";
import { ErrorText, Field, PageHeader, Spinner } from "@/components/ui";
import { PIN_LENGTH, PinFields, pinProblem } from "@/components/pin";
import { api } from "@/lib/api";
import { useAuth, type SessionUser } from "@/lib/auth-store";
import { label } from "@/lib/format";

interface Me {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  role: string;
  therapist: { id: string } | null;
}

/** Staff profile and their own app PIN (patients have no PIN). */
export default function AccountPage() {
  const setSession = useAuth((s) => s.setSession);
  const q = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/auth/me") });

  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: () => api.post<{ accessToken: string; refreshToken: string; user: SessionUser }>("/auth/pin/change", { currentPin: current, newPin: next }),
    onSuccess: (session) => {
      setSession(session); // other devices are signed out; this one keeps a fresh session
      setChanging(false);
      setCurrent("");
      setNext("");
      setAgain("");
      setDone(true);
    },
  });

  const ready = current.length === PIN_LENGTH && !pinProblem(next, again);

  return (
    <>
      <PageHeader title="My account" subtitle="Your profile and app PIN" />
      {q.isLoading ? <Spinner /> : q.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card space-y-2 p-5">
            <h2 className="font-semibold">Account</h2>
            <Row k="Name" v={q.data.name} />
            <Row k="Role" v={label(q.data.role)} />
            <Row k="Mobile" v={q.data.phone} />
            {q.data.email && <Row k="Email" v={q.data.email} />}
            <p className="pt-1 text-xs text-navy-500">To change your name, number or role, ask your admin.</p>
            {q.data.therapist && (
              <Link href="/therapists" className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-gold-700">
                <CalendarClock size={15} /> My schedule &amp; leave
              </Link>
            )}
          </div>

          {q.data.role !== "PATIENT" && (
            <div className="card space-y-3 p-5">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold"><KeyRound size={16} /> App PIN</h2>
                {!changing && <button className="btn-ghost px-3 py-1 text-xs" onClick={() => { change.reset(); setDone(false); setChanging(true); }}>Change PIN</button>}
              </div>
              {done && <p className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 size={14} /> PIN changed. Other devices have been signed out.</p>}
              {changing ? (
                <div className="space-y-3">
                  <Field label="Current PIN">
                    <input
                      className="input w-40 tracking-[0.4em]"
                      type="password"
                      inputMode="numeric"
                      autoComplete="current-password"
                      maxLength={PIN_LENGTH}
                      placeholder="••••••"
                      value={current}
                      onChange={(e) => setCurrent(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                    />
                  </Field>
                  <PinFields pin={next} confirm={again} onPin={setNext} onConfirm={setAgain} />
                  <ErrorText error={change.error} />
                  <div className="flex justify-end gap-2">
                    <button className="btn-ghost" onClick={() => setChanging(false)}>Cancel</button>
                    <button className="btn-primary" disabled={!ready || change.isPending} onClick={() => change.mutate()}>{change.isPending ? "Saving…" : "Save PIN"}</button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-navy-500">Forgot your PIN? An admin can reset it in Staff.</p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-navy-500">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
