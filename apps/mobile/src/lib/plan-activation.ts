import { ApiError } from "./api";
import { confirm } from "./confirm";
import type { ActivePlanConflict } from "./types";

/** Thrown when the user declines to replace the current plan, so callers can stop quietly. */
export class PlanReplaceCancelled extends Error {
  constructor() {
    super("Kept the current treatment plan.");
  }
}

/**
 * A patient can have only one active treatment plan. Run an action that activates a plan; if the
 * server says another plan is already active, ask whether to replace it and, on yes, run the
 * action again with `replaceActive: true` (the old plan is completed and its upcoming visits move
 * to the new plan). Declining throws PlanReplaceCancelled.
 */
export async function withActivePlanCheck<T>(run: (replaceActive: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(false);
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== "ACTIVE_PLAN_EXISTS") throw e;
    const d = e.details as ActivePlanConflict | undefined;
    const moving = d?.upcomingVisits ? ` Its ${d.upcomingVisits} upcoming visit${d.upcomingVisits > 1 ? "s" : ""} will move to the new plan.` : "";
    const ok = await confirm(
      "Replace the current plan?",
      `This patient already has an active plan${d ? ` (${d.planNo} – ${d.title})` : ""}. A patient can only have one. The current plan will be marked completed.${moving}`,
      "Replace plan",
    );
    if (!ok) throw new PlanReplaceCancelled();
    return run(true);
  }
}
