"use client";

import { useAuth } from "./auth-store";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const { refreshToken, setSession, clear } = useAuth.getState();
  if (!refreshToken) return false;
  const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
  if (!res.ok) {
    clear();
    return false;
  }
  const body = await res.json();
  setSession(body.data);
  return true;
}

async function request<T>(method: string, path: string, body?: unknown, withMeta = false, retry = true): Promise<T> {
  const token = useAuth.getState().accessToken;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && useAuth.getState().refreshToken) {
    refreshing ??= refresh().finally(() => (refreshing = null));
    if (await refreshing) return request<T>(method, path, body, withMeta, false);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    let message: string = json.error?.message ?? res.statusText;
    // Validation errors: show which field is wrong instead of a generic message
    if (json.error?.code === "VALIDATION_ERROR" && Array.isArray(json.error.details) && json.error.details.length) {
      message = (json.error.details as { path: string; message: string }[])
        .map((d) => {
          const field = d.path.split(".").pop() ?? d.path;
          const nice = field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
          return d.message === "Invalid" || d.message.startsWith("Required") ? `${nice}: ${d.message === "Invalid" ? "invalid value" : "required"}` : d.message.includes(nice.toLowerCase()) || d.message.length > 30 ? d.message : `${nice}: ${d.message}`;
        })
        .join(" · ");
    }
    throw new ApiError(res.status, json.error?.code ?? "ERROR", message, json.error?.details);
  }
  return (withMeta ? { data: json.data, meta: json.meta } : json.data) as T;
}

const qs = (params?: Record<string, unknown>) => {
  if (!params) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) => request<T>("GET", path + qs(params)),
  page: <T>(path: string, params?: Record<string, unknown>) => request<Paged<T>>("GET", path + qs(params), undefined, true),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** Open an authenticated HTML document (invoice / receipt) in a new tab. */
export async function openDocument(path: string) {
  const token = useAuth.getState().accessToken;
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const html = await res.text();
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank");
}

export async function downloadFile(path: string, filename: string) {
  const token = useAuth.getState().accessToken;
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
