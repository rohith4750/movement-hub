const TZ = "Asia/Kolkata";

export const inr = (v: unknown) => `₹${Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const date = (v?: string | Date | null) => (v ? new Date(v).toLocaleDateString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }) : "—");
export const time = (v?: string | Date | null) => (v ? new Date(v).toLocaleTimeString("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "—");
export const dateTime = (v?: string | Date | null) => (v ? `${date(v)}, ${time(v)}` : "—");
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
export const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const fullName = (p?: { firstName?: string; lastName?: string | null } | null) => (p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "—");
export const label = (s?: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—");
