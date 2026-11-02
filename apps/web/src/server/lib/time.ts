import { env } from "../config/env";

const DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/** Build a UTC Date from a local hospital date (YYYY-MM-DD) and time (HH:mm). */
export function localDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${env.TIMEZONE_OFFSET}`);
}

/** Local hospital date string (YYYY-MM-DD) for a Date. */
export function localDateString(d: Date): string {
  return new Date(d.getTime() + parseOffset(env.TIMEZONE_OFFSET) * 60_000).toISOString().slice(0, 10);
}

export function localDayCode(date: string) {
  return DAY_CODES[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function dayRange(date: string) {
  return { gte: localDateTime(date, "00:00"), lt: localDateTime(addDays(date, 1), "00:00") };
}

export const todayLocal = () => localDateString(new Date());

export const dateOnly = (date: string) => new Date(`${date}T00:00:00Z`);

function parseOffset(o: string) {
  const sign = o.startsWith("-") ? -1 : 1;
  const [h, m] = o.replace(/[+-]/, "").split(":").map(Number);
  return sign * (h * 60 + m);
}
