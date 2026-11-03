import { z } from "zod";

const defaultDbUrl =
  process.env.DATABASE_URL_POOLED ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.PRISMA_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/movement_hub";

/**
 * Signing / hashing secrets have no defaults: the app refuses to start without them, so a
 * missing Vercel variable can never silently fall back to a value that is public in this repo.
 * Placeholders from .env.example and the old built-in fallbacks are rejected too.
 * Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
 */
const KNOWN_PUBLIC_VALUES = new Set([
  "movement-hub-jwt-access-secret-32-chars-minimum-fallback",
  "movement-hub-jwt-refresh-secret-32-chars-minimum-fallback",
]);
const secret = (name: string) =>
  z
    .string({ required_error: `${name} is required (at least 32 random characters)` })
    .min(32, `${name} must be at least 32 characters`)
    .refine((v) => !KNOWN_PUBLIC_VALUES.has(v) && !v.startsWith("change-me"), `${name} is a public placeholder; generate a random value`);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  CRON_SECRET: z.string().optional().default(""),
  DATABASE_URL: z.string().default(defaultDbUrl),
  JWT_ACCESS_SECRET: secret("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: secret("JWT_REFRESH_SECRET"),
  /** Keys the PIN lookup fingerprint. Separate from the JWT secrets so they can be rotated independently. */
  PIN_LOOKUP_SECRET: secret("PIN_LOOKUP_SECRET"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().default(7),
  RAZORPAY_KEY_ID: z.string().optional().default(""),
  RAZORPAY_KEY_SECRET: z.string().optional().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  STORAGE_ENDPOINT: z.string().optional().default(""),
  STORAGE_REGION: z.string().default("ap-south-1"),
  STORAGE_BUCKET: z.string().optional().default(""),
  STORAGE_ACCESS_KEY: z.string().optional().default(""),
  STORAGE_SECRET_KEY: z.string().optional().default(""),
  CORS_ORIGINS: z.string().default("*"),
  TIMEZONE_OFFSET: z.string().default("+05:30"),
});

const parsed = schema
  .refine((e) => new Set([e.JWT_ACCESS_SECRET, e.JWT_REFRESH_SECRET, e.PIN_LOOKUP_SECRET]).size === 3, {
    message: "JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and PIN_LOOKUP_SECRET must all be different",
    path: ["PIN_LOOKUP_SECRET"],
  })
  .safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.flatten().fieldErrors;
  console.error("Invalid environment variables:", fields);
  throw new Error(`Invalid environment variables: ${Object.keys(fields).join(", ")}`);
}

export const env = parsed.data;
