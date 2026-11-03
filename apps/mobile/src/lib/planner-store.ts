import { create } from "zustand";
import type { PlannerCandidate } from "./types";

/**
 * Draft state for the day planner (UI state only — the server data lives in TanStack Query).
 * For each planned date: which patients are ticked and which physio / slot each one gets.
 * It survives leaving and coming back to the planner, so a half-planned day isn't lost.
 */
export interface PlanPick {
  selected: boolean;
  therapistId: string | null;
  slotId: string | null;
}

type DayDraft = Record<string, PlanPick>; // by patientId

interface PlannerState {
  days: Record<string, DayDraft>; // by date
  /** Seed picks from the server's suggestions; keeps anything the user already changed. */
  seed: (date: string, candidates: PlannerCandidate[]) => void;
  toggle: (date: string, patientId: string) => void;
  setAll: (date: string, patientIds: string[], selected: boolean) => void;
  pick: (date: string, patientId: string, therapistId: string, slotId: string | null) => void;
  /** Forget patients that were booked (or are no longer on the list). */
  drop: (date: string, patientIds: string[]) => void;
  reset: (date: string) => void;
}

export const usePlannerStore = create<PlannerState>((set) => ({
  days: {},
  seed: (date, candidates) =>
    set((s) => {
      const current = s.days[date] ?? {};
      let changed = false;
      const next: DayDraft = { ...current };
      for (const c of candidates) {
        if (next[c.patient.id]) continue;
        // Pre-tick patients we could place at a free slot.
        next[c.patient.id] = { selected: !!c.suggestedSlotId, therapistId: c.therapistId, slotId: c.suggestedSlotId };
        changed = true;
      }
      return changed ? { days: { ...s.days, [date]: next } } : s;
    }),
  toggle: (date, patientId) =>
    set((s) => {
      const d = s.days[date] ?? {};
      const p = d[patientId] ?? { selected: false, therapistId: null, slotId: null };
      return { days: { ...s.days, [date]: { ...d, [patientId]: { ...p, selected: !p.selected } } } };
    }),
  setAll: (date, patientIds, selected) =>
    set((s) => {
      const d = { ...(s.days[date] ?? {}) };
      for (const id of patientIds) d[id] = { ...(d[id] ?? { therapistId: null, slotId: null }), selected };
      return { days: { ...s.days, [date]: d } };
    }),
  pick: (date, patientId, therapistId, slotId) =>
    set((s) => {
      const d = { ...(s.days[date] ?? {}) };
      // A slot can only be planned for one patient: take it away from anyone else who had it.
      if (slotId) for (const [id, p] of Object.entries(d)) if (id !== patientId && p.slotId === slotId) d[id] = { ...p, slotId: null, selected: false };
      d[patientId] = { selected: !!slotId, therapistId, slotId };
      return { days: { ...s.days, [date]: d } };
    }),
  drop: (date, patientIds) =>
    set((s) => {
      const d = { ...(s.days[date] ?? {}) };
      for (const id of patientIds) delete d[id];
      return { days: { ...s.days, [date]: d } };
    }),
  reset: (date) =>
    set((s) => {
      const { [date]: _gone, ...rest } = s.days;
      return { days: rest };
    }),
}));
