import { z } from "zod";

/**
 * Normalise an Indian-style phone number to E.164 (+91XXXXXXXXXX).
 * Accepts: "9876543210", "09876543210", "919876543210", "+91 98765 43210",
 * "+91-98765-43210", "(+91) 98765 43210", "0091 9876543210", international "+44 20 7946 0958".
 */
export function normalizePhone(input: string): string {
  let p = input.trim().replace(/[\s\-().]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (/^[6-9]\d{9}$/.test(p)) return `+91${p}`; // 10-digit Indian mobile
  if (/^0[6-9]\d{9}$/.test(p)) return `+91${p.slice(1)}`; // leading 0
  if (/^91[6-9]\d{9}$/.test(p)) return `+${p}`; // 91 without +
  return p;
}

export const PHONE_MESSAGE = "Enter a valid mobile number, e.g. 9876543210 or +91 98765 43210";

export const phoneSchema = z
  .string({ required_error: "Phone number is required" })
  .trim()
  .min(1, "Phone number is required")
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\+[1-9]\d{9,14}$/, PHONE_MESSAGE));

/** True when a login identifier looks like a phone number rather than an email. */
export const looksLikePhone = (s: string) => !s.includes("@") && /^[+\d\s\-().]{10,}$/.test(s.trim());
