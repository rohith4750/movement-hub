"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { ErrorText, Field, Modal } from "./ui";

export const PIN_LENGTH = 6;

/** Mirrors the API rule so admins get instant feedback. */
export function pinProblem(pin: string, confirm: string): string | null {
  if (!pin) return "Enter a 6-digit PIN";
  if (!/^\d{6}$/.test(pin)) return "PIN must be exactly 6 digits";
  if (/^(\d)\1+$/.test(pin)) return "Too easy to guess (repeated digits)";
  const d = pin.split("").map(Number);
  if (d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10) || d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10)) return "Too easy to guess (sequential digits)";
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d\d\d)\1$/.test(pin)) return "Too easy to guess (repeating pattern)";
  if (pin !== confirm) return "PINs don't match";
  return null;
}

/** Two masked PIN boxes (PIN + confirm) with a show/hide toggle. */
export function PinFields({ pin, confirm, onPin, onConfirm }: { pin: string; confirm: string; onPin: (v: string) => void; onConfirm: (v: string) => void }) {
  const [show, setShow] = useState(false);
  const clean = (v: string) => v.replace(/\D/g, "").slice(0, PIN_LENGTH);
  const problem = pin || confirm ? pinProblem(pin, confirm) : null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mobile app PIN *">
          <input className="input tracking-[0.4em]" type={show ? "text" : "password"} inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder="••••••" value={pin} onChange={(e) => onPin(clean(e.target.value))} />
        </Field>
        <Field label="Confirm PIN *">
          <input className="input tracking-[0.4em]" type={show ? "text" : "password"} inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder="••••••" value={confirm} onChange={(e) => onConfirm(clean(e.target.value))} />
        </Field>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={problem ? "text-amber-700" : "text-navy-500"}>
          {problem ?? (pin ? "✓ PIN looks good" : "6 digits, different for every staff member. This PIN alone signs them in to the Movement Hub app.")}
        </span>
        <button type="button" className="flex items-center gap-1 text-navy-500 hover:text-navy-900" onClick={() => setShow((s) => !s)}>
          {show ? <EyeOff size={13} /> : <Eye size={13} />} {show ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

/** Admin dialog to set / reset someone's mobile-app PIN. */
export function SetPinModal({ user, onClose }: { user: { id: string; name: string; hasPin?: boolean } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/users/${user!.id}/pin`, { pin }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["therapists"] });
      setPin("");
      setConfirm("");
      onClose();
    },
  });
  return (
    <Modal open={!!user} onClose={onClose} title={`${user?.hasPin ? "Reset" : "Set"} app PIN · ${user?.name ?? ""}`}>
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-700">
          <KeyRound size={14} className="mt-0.5 shrink-0" />
          {user?.name} signs in to the mobile app with this PIN only, so it must be different from everyone else&apos;s. Setting a new PIN signs them out of the app on all devices and unlocks the account if it was locked.
        </p>
        <PinFields pin={pin} confirm={confirm} onPin={setPin} onConfirm={setConfirm} />
        <ErrorText error={m.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!!pinProblem(pin, confirm) || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Saving…" : "Save PIN"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Small "App PIN set / not set" badge. */
export function PinBadge({ hasPin }: { hasPin?: boolean }) {
  return hasPin ? (
    <span className="badge bg-emerald-50 text-emerald-700">App PIN ✓</span>
  ) : (
    <span className="badge bg-amber-50 text-amber-700">No app PIN</span>
  );
}
