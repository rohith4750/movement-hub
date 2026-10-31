import { TIMEZONE_OFFSET_MINUTES } from "./config";

/**
 * Date formatting in clinic time (IST) without relying on Intl time-zone support,
 * so it behaves identically on every Android/iOS version and on the phone's own time zone.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A Date whose UTC fields equal clinic local time. */
function clinic(v: string | Date) {
  const d = typeof v === "string" ? new Date(v) : v;
  return new Date(d.getTime() + TIMEZONE_OFFSET_MINUTES * 60_000);
}

export const date = (v?: string | Date | null) => {
  if (!v) return "—";
  const c = clinic(v);
  return `${String(c.getUTCDate()).padStart(2, "0")} ${MONTHS[c.getUTCMonth()]} ${c.getUTCFullYear()}`;
};

export const time = (v?: string | Date | null) => {
  if (!v) return "—";
  const c = clinic(v);
  const h = c.getUTCHours();
  const m = String(c.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
};

export const dateTime = (v?: string | Date | null) => (v ? `${date(v)}, ${time(v)}` : "—");

export const weekday = (v: string | Date) => DAYS[clinic(v).getUTCDay()];

/** Today's clinic date as YYYY-MM-DD. */
export const today = () => clinic(new Date()).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Parts of a YYYY-MM-DD for date chips. */
export const dayParts = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  return { weekday: DAYS[x.getUTCDay()], day: x.getUTCDate(), month: MONTHS[x.getUTCMonth()] };
};

export const inr = (v: unknown) => {
  const n = Number(v ?? 0);
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  // Indian digit grouping: 12,34,567
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${n < 0 ? "-" : ""}₹${grouped}${dec === "00" ? "" : `.${dec}`}`;
};

export const fullName = (p?: { firstName?: string; lastName?: string | null } | null) => (p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "—");

export const label = (s?: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—");

export const greeting = () => {
  const h = clinic(new Date()).getUTCHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

/** Age in whole years from a date of birth (null if unknown). */
export const ageYears = (dob?: string | null) => (dob ? Math.floor((Date.now() - new Date(dob).getTime()) / 31_557_600_000) : null);
