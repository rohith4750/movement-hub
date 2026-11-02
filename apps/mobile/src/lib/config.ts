import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * API base URL.
 * 1. EXPO_PUBLIC_API_URL if set (use this for production builds).
 * 2. In development: the same computer that runs `expo start` (taken from the dev-server address),
 *    so a phone on the same Wi-Fi reaches the API without any config.
 * 3. Fallbacks for emulators / web.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.29.208:8081"
  const host = hostUri?.split(":")[0];
  if (host && host !== "localhost" && host !== "127.0.0.1") return `http://${host}:3000/api/v1`;

  if (Platform.OS === "android") return "http://10.0.2.2:3000/api/v1"; // Android emulator → host machine
  return "http://localhost:3000/api/v1";
}

export const API_URL = resolveApiUrl();
export const TIMEZONE_OFFSET_MINUTES = 330; // Asia/Kolkata (IST, no DST)
