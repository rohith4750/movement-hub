"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Smartphone } from "lucide-react";
import { Logo } from "@/components/shell";
import { ErrorText, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, type SessionUser } from "@/lib/auth-store";

type Session = { accessToken: string; refreshToken: string; user: SessionUser };

/** Staff sign-in for the web portal (accounts are created by an admin). */
export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api.post<Session>("/auth/login", { identifier: identifier.trim(), password });
      setSession(s);
      router.replace("/dashboard");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-700 to-navy-900 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="card">
          <div className="mb-6 flex flex-col items-center text-center">
            <Logo size={110} />
            <h1 className="mt-3 text-xl font-bold tracking-wide text-navy-700">MOVEMENT HUB</h1>
            <p className="text-xs uppercase tracking-widest text-gold-700">Physiotherapy &amp; Rehab</p>
            <p className="mt-3 text-sm text-navy-500">Staff portal</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Email or mobile number">
              <input className="input" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
            </Field>
            <Field label="Password">
              <div className="relative">
                <input className="input pr-10" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" className="absolute inset-y-0 right-0 px-3 text-navy-500 hover:text-navy-900" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <ErrorText error={error} />
            <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
          <p className="mt-4 text-center text-xs text-navy-500">Forgot your password? Ask your admin to reset it.</p>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 text-sm text-white/90">
          <Smartphone size={18} className="shrink-0 text-gold-300" />
          <span>On the Movement Hub mobile app, sign in with the 6-digit PIN from your admin.</span>
        </div>
      </div>
    </div>
  );
}
