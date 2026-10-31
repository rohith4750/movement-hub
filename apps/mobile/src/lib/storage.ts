import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Secure key/value storage for login tokens.
 * Native: Keychain / Keystore via expo-secure-store. Web (dev preview only): localStorage.
 * All failures are swallowed so a storage problem logs the user out instead of crashing the app.
 */
const isWeb = Platform.OS === "web";

export async function getItem(key: string): Promise<string | null> {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    /* ignore */
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}
