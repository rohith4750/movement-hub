/**
 * Runs once when the Next.js server boots. On a long-running server (next dev / next start)
 * start the in-process job timers. On Vercel, jobs run through Vercel Cron instead (see vercel.json).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL || process.env.NODE_ENV === "test") return;
  if (process.env.DISABLE_JOBS === "true") return;
  const { startJobs } = await import("./server/jobs/scheduler");
  startJobs();
}
