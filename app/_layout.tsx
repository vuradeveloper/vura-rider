import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { View, Text, ActivityIndicator, AppState } from "react-native";
import { useAuth } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getActiveRide, getRide, getRideHistory, submitRating } from "@/services/RideService";
import { getSocket } from "@/lib/socket";

const queryClient = new QueryClient();

// Floating "Go Back To Ride" pill shown on every screen while a ride is active
// AND the rider left the ride screen with the X (rideMinimized). Once minimized,
// the rider can return to the live trip from anywhere until the ride ends.
function ActiveRideBanner() {
  const router = useRouter();
  const activeRide = useAppStore((s) => s.activeRide);
  const rideMinimized = useAppStore((s) => s.rideMinimized);

  // Global ride terminal-event guard. When the rider minimizes a ride (X) and
  // leaves the ride screen, the track screen's socket listeners are detached,
  // so a cancel/complete/expiry that arrives while they're elsewhere would
  // leave the store's activeRide/rideMinimized set — and the "Go Back To Ride"
  // banner would float forever. Listening here (app root) catches every
  // terminal event on ANY screen and clears the ride state.
  useEffect(() => {
    if (!rideMinimized && !activeRide) return;
    let socket: any = null;
    let disposed = false;
    (async () => {
      try {
        socket = await getSocket();
        if (disposed) return;
        const clear = () => useAppStore.getState().resetRideState();
        socket.on("ride:cancelled", clear);
        socket.on("ride:completed", clear);
        socket.on("ride:expired", clear);
        socket.on("ride:no:drivers", clear);
      } catch {
        // offline — nothing to listen for
      }
    })();
    return () => {
      disposed = true;
      if (socket) {
        socket.off("ride:cancelled");
        socket.off("ride:completed");
        socket.off("ride:expired");
        socket.off("ride:no:drivers");
      }
    };
  }, [rideMinimized, activeRide]);

  // Background demo auto-complete. When a DEMO (simulated) ride is minimized
  // with the X button, its simulation is paused in the track screen, so the
  // ride can never reach "completed" and the banner would float forever. This
  // advances the demo ride through its phases in the background (searching →
  // accepted → driver_arrived → in_progress → completed) and finally clears
  // the ride state, so the "Go Back To Ride" button disappears exactly when
  // the ride is finished.
  useEffect(() => {
    if (!rideMinimized || !activeRide) return;
    const saved = useAppStore.getState().savedDemoRide;
    // Real (non-demo) rides are handled by the socket guard above.
    if (!saved) return;
    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const scheduled: { atMs: number; status: string }[] = [
      { atMs: 12000, status: "accepted" },
      { atMs: 30000, status: "driver_arrived" },
      { atMs: 60000, status: "in_progress" },
      { atMs: 150000, status: "completed" },
    ];
    const startPhase = saved.phase || "to_pickup";
    // If the demo car was already driving to the destination when minimized,
    // we're close to the end — complete sooner.
    let base = 0;
    if (startPhase === "to_dest") base = 120000;
    else if (startPhase === "arrived") base = 60000;
    else if (startPhase === "searching") base = 0;
    else base = 0;
    for (const p of scheduled) {
      if (p.status === "completed" || p.atMs >= base) {
        timers.push(
          setTimeout(() => {
            if (disposed) return;
            if (p.status === "completed") {
              useAppStore.getState().resetRideState();
            } else {
              const cur = useAppStore.getState().activeRide;
              if (cur && cur.status !== "completed" && cur.status !== "cancelled") {
                useAppStore.getState().setActiveRide({ ...cur, status: p.status } as any);
              }
            }
          }, Math.max(0, p.atMs - base))
        );
      }
    }
    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
    };
  }, [rideMinimized, activeRide]);

    // Status-driven auto-return: no floating button. When the rider leaves the
  // ride screen (X -> minimized) and later brings the app back to foreground
  // while the ride is STILL ACTIVE, return them to the ride screen. When the
  // ride completes/cancels, the socket/demo effect above has already cleared
  // state, so nothing appears and the app correctly stays on the home page.
  useEffect(() => {
    if (!rideMinimized || !activeRide) return;
    const active = ["searching", "accepted", "driver_arrived", "in_progress"].includes(activeRide.status);
    if (!active) return;
    const sub = AppState.addEventListener("change", (st) => {
      if (st !== "active") return;
      const cur = useAppStore.getState();
      const activeNow = ["searching", "accepted", "driver_arrived", "in_progress"].includes(cur.activeRide?.status || "");
      if (cur.rideMinimized && cur.activeRide && activeNow) {
        const saved = cur.savedDemoRide;
        if (saved) router.replace("/ride/track");
        else if (cur.activeRide.id) router.replace(`/ride/track?rideId=${cur.activeRide.id}`);
        else router.replace("/ride/track");
      }
    });
    return () => sub.remove();
  }, [rideMinimized, activeRide]);

  return null;
}

function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const isAuthScreen =
      segments[0] === "welcome" ||
      segments[0] === "login" ||
      segments[0] === "signup" ||
      segments[0] === "forgot-password";

    if (!user && !isAuthScreen) {
      router.replace("/welcome");
    } else if (user && isAuthScreen) {
      router.replace("/");
    }
  }, [user, loading, segments]);

  // Register push notifications when user becomes authenticated — the module
  // is lazy-loaded so expo-notifications stays out of the initial JS bundle
  // and the first screen paints sooner.
  useEffect(() => {
    if (!loading && user) {
      const {
        registerForPushNotificationsAsync,
        registerDeviceToken,
      } = require("@/lib/notifications") as typeof import("@/lib/notifications");
      registerForPushNotificationsAsync().then((token: string | null) => {
        if (token) {
          registerDeviceToken(token);
        }
      });
    }
  }, [user, loading]);

  // Restore the rider's active ride on app launch (it's per-account on the
  // server), so closing/reopening the app still shows the live trip and the
  // "Go Back To Ride" banner. Clears the in-memory demo snapshot since we now
  // have the authoritative state from the DB.
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const { ride } = await getActiveRide();
        if (cancelled) return;
        if (ride) {
          useAppStore.getState().setActiveRide(ride as any);
          useAppStore.getState().setSavedDemoRide(null);
          // Keep minimized state so the banner shows even right after launch.
          useAppStore.getState().setRideMinimized(true);
        }
      } catch {
        // ignore — no active ride or offline
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#e04e2f" />
        <Text className="text-sm text-muted-foreground mt-4">Loading...</Text>
      </View>
    );
  }

  return null;
}

function RootLayout() {
  const url = Linking.useURL();
  const router = useRouter();

  // Capture referral/affiliate codes from deep links like vura-rider://r/VURA-CODE
  useEffect(() => {
    if (!url) return;
    const match = /[?:/#]r\/([A-Za-z0-9-]+)|\bref=([A-Za-z0-9-]+)/.exec(url);
    const code = match?.[1] || match?.[2];
    if (code) {
      AsyncStorage.setItem("vura.referral.code", code.toUpperCase()).catch(() => undefined);
    }
  }, [url]);

  useEffect(() => {
    // Notifications listeners are lazy-loaded to keep expo-notifications out
    // of the initial JS bundle.
    const Notifications = require("expo-notifications") as typeof import("expo-notifications");
    // Listen for notifications received while the app is in the foreground
    const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
      console.log("Foreground notification received:", notification);
    });

    // Listen for user interactions with notifications (e.g. tapping)
    const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log("Notification response received:", response);
    });

    return () => {
      notificationListener.remove();
      responseListener.remove();
    };
  }, []);

  // Uber-style forgotten-rating re-prompt: if the last completed ride was never
  // rated, bring the rider to its receipt (which shows the rating/tip UI) when
  // they open the app. Uses a short local dedupe so it doesn't nag repeatedly.
  const unframedRatingRef = useRef<string | null>(null);
  useEffect(() => {
    const check = async () => {
      try {
        const res = await getRideHistory(1, 5);
        const unrated = (res?.rides || []).find(
          (r: any) => r.status === "completed" && !r.my_rating
        );
        const cached = await AsyncStorage.getItem(
          "vura.ride.unrated-prompted"
        );
        if (unrated && unrated.id !== cached) {
          await AsyncStorage.setItem(
            "vura.ride.unrated-prompted",
            unrated.id
          );
          if (unframedRatingRef.current !== unrated.id) {
            unframedRatingRef.current = unrated.id;
            router.replace(`/ride/receipt?rideId=${unrated.id}`);
          }
        }
      } catch {
        // offline / not signed in — skip
      }
    };
    const launch = setTimeout(check, 2500);
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") check();
    });
    return () => {
      clearTimeout(launch);
      sub.remove();
    };
  }, [router]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <AuthGate />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="welcome" />
          <Stack.Screen name="login" />
          <Stack.Screen name="signup" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="search" />
          <Stack.Screen name="ride/options" />
          <Stack.Screen name="ride/track" />
          <Stack.Screen name="ride/chat" />
          <Stack.Screen name="ride/fare-split" />
          <Stack.Screen name="ride/schedule" />
          <Stack.Screen
            name="wallet"
            options={{ presentation: "card" }}
          />
          <Stack.Screen
            name="promotions"
            options={{ presentation: "card" }}
          />
          <Stack.Screen
            name="safety"
            options={{ presentation: "card" }}
          />
          <Stack.Screen
            name="settings"
            options={{ presentation: "card" }}
          />
          <Stack.Screen
            name="saved-places"
            options={{ presentation: "card" }}
          />
          <Stack.Screen
            name="help"
            options={{ presentation: "card" }}
          />
          <Stack.Screen
            name="scheduled-rides"
            options={{ presentation: "card" }}
          />
          <Stack.Screen
            name="dispute"
            options={{ presentation: "card" }}
          />
          <Stack.Screen
            name="lost-item"
            options={{ presentation: "card" }}
          />
          <Stack.Screen
            name="affiliate"
            options={{ presentation: "card" }}
          />
          <Stack.Screen name="+not-found" />
        </Stack>
        <ActiveRideBanner />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default RootLayout;
