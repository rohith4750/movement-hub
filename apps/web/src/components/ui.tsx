"use client";

import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { label } from "@/lib/format";

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-navy-50 text-navy-700",
  CONFIRMED: "bg-blue-50 text-blue-700",
  CHECKED_IN: "bg-amber-50 text-amber-700",
  IN_PROGRESS: "bg-gold-100 text-gold-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-rose-50 text-rose-700",
  NO_SHOW: "bg-rose-50 text-rose-700",
  RESCHEDULED: "bg-slate-100 text-slate-600",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  DRAFT: "bg-slate-100 text-slate-600",
  EXHAUSTED: "bg-slate-100 text-slate-600",
  EXPIRED: "bg-rose-50 text-rose-700",
  ISSUED: "bg-amber-50 text-amber-700",
  PARTIALLY_PAID: "bg-gold-100 text-gold-700",
  PAID: "bg-emerald-50 text-emerald-700",
  REFUNDED: "bg-slate-100 text-slate-600",
  AVAILABLE: "bg-emerald-50 text-emerald-700",
  BOOKED: "bg-navy-50 text-navy-700",
  BLOCKED: "bg-slate-100 text-slate-500",
  MISSED: "bg-rose-50 text-rose-700",
  SUCCESS: "bg-emerald-50 text-emerald-700",
  PENDING: "bg-amber-50 text-amber-700",
  FAILED: "bg-rose-50 text-rose-700",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={clsx("badge", STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600")}>{label(status)}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-navy-700">{title}</h1>
        {subtitle && <p className="text-sm text-navy-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label: l, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs font-semibold uppercase tracking-wide text-navy-500">{l}</div>
      <div className="mt-2 text-2xl font-bold text-navy-700">{value}</div>
      {hint && <div className="mt-1 text-xs text-navy-500">{hint}</div>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center p-8 text-navy-500">
      <Loader2 className="animate-spin" />
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-8 text-center text-sm text-navy-500">{children}</p>;
}

export function Field({ label: l, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{l}</span>
      {children}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-900/40 p-4" onClick={onClose}>
      <div className={clsx("card my-8 w-full", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-navy-700">{title}</h2>
          <button onClick={onClose} className="text-navy-500 hover:text-navy-900" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** "Are you sure?" dialog for destructive actions. */
export function ConfirmDelete({
  open, title, message, onCancel, onConfirm, busy, error,
}: { open: boolean; title: string; message: ReactNode; onCancel: () => void; onConfirm: () => void; busy?: boolean; error?: unknown }) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="space-y-4 text-sm">
        <div className="text-navy-700">{message}</div>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary bg-rose-600 hover:bg-rose-700" disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Delete"}</button>
        </div>
      </div>
    </Modal>
  );
}

export function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      <button className="btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span className="text-navy-500">Page {page} of {totalPages}</span>
      <button className="btn-ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}
