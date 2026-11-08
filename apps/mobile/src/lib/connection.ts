import { create } from "zustand";

/**
 * How the connection feels right now, for the thin notice under the header (see ConnectionStrip in components/ui.tsx):
 * - "slow": a request has been waiting longer than SLOW_MS (a weak signal, not an error: the app keeps waiting);
 * - "offline": the last request could not reach the server at all;
 * - "ok": everything normal, nothing is shown.
 * This is UI state only (no server data), so it lives in a tiny store next to the request code that feeds it.
 */
export type ConnectionState = "ok" | "slow" | "offline";

export const useConnection = create<{ state: ConnectionState }>(() => ({ state: "ok" }));

const SLOW_MS = 5_000;
let slowRequests = 0;
let offline = false;

const publish = () => useConnection.setState({ state: offline ? "offline" : slowRequests > 0 ? "slow" : "ok" });

type Outcome = "answered" | "dropped" | "timeout";

/** Called by api.ts around every request: marks the connection slow if no answer comes within SLOW_MS. */
export function trackRequest() {
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    slowRequests += 1;
    publish();
  }, SLOW_MS);
  return {
    done(outcome: Outcome) {
      clearTimeout(timer);
      if (slow) slowRequests -= 1;
      if (outcome === "answered") offline = false; // any answer from the server, even an error one, means we are connected
      else if (outcome === "dropped") offline = true;
      publish();
    },
  };
}
