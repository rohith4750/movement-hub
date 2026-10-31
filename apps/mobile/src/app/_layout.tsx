// Import only the four weights the app uses (the package root would bundle all 18 font files).
import { Montserrat_400Regular } from "@expo-google-fonts/montserrat/400Regular";
import { Montserrat_500Medium } from "@expo-google-fonts/montserrat/500Medium";
import { Montserrat_600SemiBold } from "@expo-google-fonts/montserrat/600SemiBold";
import { Montserrat_700Bold } from "@expo-google-fonts/montserrat/700Bold";
import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { colors } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

// Refetch when the app comes back to the foreground (React Query's "window focus" for native).
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== "web") focusManager.setFocused(status === "active");
}
onlineManager.setOnline(true);

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Don't hammer the server on auth/validation errors; retry network blips once.
            retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
          },
        },
      }),
  );
  const [fontsLoaded, fontError] = useFonts({ Montserrat_400Regular, Montserrat_500Medium, Montserrat_600SemiBold, Montserrat_700Bold });
  const status = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);
  const router = useRouter();
  const segments = useSegments();
  const hasNavigated = useRef(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", onAppStateChange);
    return () => sub.remove();
  }, []);

  // Clear cached data when the user signs out so the next person never sees it.
  useEffect(() => {
    if (status === "signedOut") queryClient.clear();
  }, [status, queryClient]);

  // Redirect to /login when signed out, regardless of which screen the user is on.
  useEffect(() => {
    if (status === "loading") return;
    const inLogin = segments[0] === "login";
    if (status === "signedOut" && !inLogin) {
      // Use replace so the back button doesn't go to a protected screen.
      router.replace("/login");
      hasNavigated.current = true;
    } else if (status === "signedIn" && inLogin) {
      router.replace("/");
      hasNavigated.current = true;
    }
  }, [status, segments, router]);

  const ready = (fontsLoaded || !!fontError) && status !== "loading";
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        {/* Every file in src/app is a route; they are registered automatically. */}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" options={{ animation: "fade" }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
