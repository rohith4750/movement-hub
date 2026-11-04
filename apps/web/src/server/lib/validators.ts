import { z } from "zod";

/**
 * Normalise a phone number to E.164 (+91XXXXXXXXXX). Any 10 digits are accepted — the first digit
 * is not restricted — and get the +91 prefix.
 * Accepts: "9876543210", "1234567890", "09876543210", "919876543210", "+91 98765 43210",
 * "+91-98765-43210", "(+91) 98765 43210", "0091 9876543210", international "+44 20 7946 0958".
 */
export function normalizePhone(input: string): string {
  let p = input.trim().replace(/[\s\-().]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (/^\d{10}$/.test(p)) return `+91${p}`; // any 10 digits
  if (/^0\d{10}$/.test(p)) return `+91${p.slice(1)}`; // leading 0
  if (/^91\d{10}$/.test(p)) return `+${p}`; // 91 without +
  return p;
}

export const PHONE_MESSAGE = "Enter a 10-digit mobile number, e.g. 9876543210 or +91 98765 43210";

export const phoneSchema = z
  .string({ required_error: "Phone number is required" })
  .trim()
  .min(1, "Phone number is required")
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\+[1-9]\d{9,14}$/, PHONE_MESSAGE));

/** True when a login identifier looks like a phone number rather than an email. */
export const looksLikePhone = (s: string) => !s.includes("@") && /^[+\d\s\-().]{10,}$/.test(s.trim());
