import { API_URL } from "./config";
import { useAuth, type Session } from "./auth";
import { trackRequest } from "./connection";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

// A weak signal can take a while but still get there, so the app waits longer before giving up
// (it shows a "slow connection" notice after 5 s, see lib/connection.ts). Saves wait longest: a request that
// is cut off early may already have been processed by the server, and that can't be retried safely.
const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 45_000;
let refreshing: Promise<boolean> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** When a response (any status) last came back: the connection was alive then. */
let lastResponseAt = 0;
const IDLE_MS = 20_000; // after this long without traffic, the pooled socket may be dead
let warming: Promise<void> | null = null;

/**
 * Wake the connection before a real request. After the app sits idle (or comes back from the background)
 * Android may reuse a dead socket, so the first request hangs for up to 20s and then fails, while the next
 * one works instantly on a fresh socket. A tiny /health call absorbs that, in well under a second, so the
 * user's submit never has to. Does nothing if the connection was used recently. Never throws.
 */
export function warmUp(force = false): Promise<void> {
  if (!force && Date.now() - lastResponseAt < IDLE_MS) return Promise.resolve();
  warming ??= (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await fetchOnce(`${API_URL}/health`, { method: "GET" }, 6_000);
        return;
      } catch (e) {
        if (!(e instanceof ApiError) || e.details !== "DROPPED") return; // a timeout or offline: let the real request report it
      }
    }
  })().finally(() => (warming = null));
  return warming;
}

async function fetchOnce(url: string, init: RequestInit, timeoutMs = READ_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const tracked = trackRequest();
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    lastResponseAt = Date.now();
    tracked.done("answered");
    return res;
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    tracked.done(aborted ? "timeout" : "dropped");
    throw new ApiError(0, "NETWORK", aborted ? "The connection is very slow and the server did not answer in time. Please try again." : "Can't reach Movement Hub. Check your internet connection.", aborted ? "TIMEOUT" : "DROPPED");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A request that fails instantly ("network request failed") is usually a dropped connection (a stale
 * socket after the app was backgrounded or the Wi-Fi/mobile-data handover), not a real outage.
 * Retry quietly before showing an error: reads twice, writes once. Timeouts are never retried, because a
 * slow server may already have processed the request.
 */
async function fetchWithTimeout(url: string, init: RequestInit) {
  // Writes get one quiet retry: a dropped connection (e.g. Android reusing a dead socket) fails before the
  // server sees the request, so this is what makes "Register & continue" work first time.
  const retries = (init.method ?? "GET") === "GET" ? 2 : 1;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchOnce(url, init, (init.method ?? "GET") === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
    } catch (e) {
      if (attempt >= retries || !(e instanceof ApiError) || e.details !== "DROPPED") throw e;
      await sleep(500 * (attempt + 1));
    }
  }
}

async function refresh(): Promise<boolean> {
  const { refreshToken, signIn, signOut } = useAuth.getState();
  if (!refreshToken) return false;
  try {
    const res = await fetchWithTimeout(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      await signOut();
      return false;
    }
    const body = (await res.json()) as { data: Session };
    await signIn(body.data);
    return true;
  } catch {
    return false; // network problem: keep the session, let the caller show the error
  }
}

function errorMessage(json: { error?: { code?: string; message?: string; details?: unknown } }, fallback: string) {
  const err = json.error;
  if (err?.code === "VALIDATION_ERROR" && Array.isArray(err.details) && err.details.length) {
    return (err.details as { path: string; message: string }[])
      .map((d) => {
        const field = (d.path.split(".").pop() ?? d.path).replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
        return d.message === "Invalid" || d.message === "Required" ? `${field}: ${d.message === "Invalid" ? "invalid value" : "required"}` : d.message;
      })
      .join("\n");
  }
  return err?.message ?? fallback;
}

async function request<T>(method: string, path: string, body?: unknown, withMeta = false, retry = true): Promise<T> {
  const token = useAuth.getState().accessToken;
  await warmUp();
  const res = await fetchWithTimeout(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // Other /auth/* calls are excluded: login/refresh are public, and pin/change or change-password answer 401
  // for a wrong current PIN/password, which must not be retried. /auth/me is a plain authenticated read.
  const canRefresh = !path.startsWith("/auth/") || path === "/auth/me";
  if (res.status === 401 && retry && useAuth.getState().refreshToken && canRefresh) {
    refreshing ??= refresh().finally(() => (refreshing = null));
    if (await refreshing) return request<T>(method, path, body, withMeta, false);
  }

  const json = await res.json().catch(() => ({}) as Record<string, never>);
  if (!res.ok || json.success === false) {
    throw new ApiError(res.status, json.error?.code ?? "ERROR", errorMessage(json, `Request failed (${res.status})`), json.error?.details);
  }
  return (withMeta ? { data: json.data, meta: json.meta } : json.data) as T;
}

const qs = (params?: Record<string, unknown>) => {
  if (!params) return "";
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) => request<T>("GET", path + qs(params)),
  page: <T>(path: string, params?: Record<string, unknown>) => request<Paged<T>>("GET", path + qs(params), undefined, true),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
};

const FIELD_NAMES: Record<string, string> = { phone: "mobile number", email: "email address", pinLookup: "PIN" };

/**
 * Field-level messages from an API error, keyed by form field, so a form can show them under the right
 * input: a duplicate ("This mobile number is already in use") or a rejected value from the server.
 * Empty when the error isn't about specific fields.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  const d = error.details;
  if (error.code === "ALREADY_EXISTS" && d && typeof d === "object" && Array.isArray((d as { fields?: unknown }).fields)) {
    for (const f of (d as { fields: unknown[] }).fields) out[String(f)] = `This ${FIELD_NAMES[String(f)] ?? String(f)} is already in use`;
  } else if (error.code === "VALIDATION_ERROR" && Array.isArray(d)) {
    for (const x of d as { path: string; message: string }[]) {
      const key = x.path.split(".").pop() ?? x.path;
      out[key] ??= x.message === "Invalid" ? "Invalid value" : x.message;
    }
  }
  return out;
}

export const messageOf =(e: unknown) => (e instanceof Error ? e.message : e ? String(e) : "");
