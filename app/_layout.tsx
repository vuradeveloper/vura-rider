import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { View, Text, ActivityIndicator, TouchableOpacity, AppState } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getActiveRide, getRide, getRideHistory, submitRating } from "@/services/RideService";
import { getSocket } from "@/lib/socket";
import { persistActiveRide, loadActiveRideSnapshot } from "@/lib/store";
import { buzzArrival, buzzMilestone } from "@/lib/haptics";
import * as Updates from "expo-updates";

const queryClient = new QueryClient();

// Auto-check for OTA updates silently at launch. When a bundle is available it's
// downloaded and the app reloads to apply it — so fixes ship without anyone
// needing a new APK or pressing the manual button in Settings.
function UpdateChecker() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (cancelled || !update.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (!cancelled) Updates.reloadAsync();
      } catch {
        // Offline / no update server — never block the app.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

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
        // Phone vibration on ride milestones (works on ANY screen, not just
        // the track screen). The driver tapping "I've arrived" emits
        // 'ride:driver:arrived' — buzz the rider's phone strongly.
        socket.on("ride:driver:arrived", () => {
          buzzArrival();
        });
        socket.on("ride:accepted", () => {
          buzzMilestone();
        });
        socket.on("ride:started", () => {
          buzzMilestone();
        });
        socket.on("ride:completed", () => {
          buzzMilestone();
          clear();
        });
        socket.on("ride:cancelled", clear);
        socket.on("ride:expired", clear);
        socket.on("ride:no:drivers", clear);
      } catch {
        // offline — nothing to listen for
      }
    })();
    return () => {
      disposed = true;
      if (socket) {
        socket.off("ride:driver:arrived");
        socket.off("ride:accepted");
        socket.off("ride:started");
        socket.off("ride:completed");
        socket.off("ride:cancelled");
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

  if (!rideMinimized || !activeRide?.id) return null;
  const activeStatus = ["searching", "accepted", "driver_arrived", "in_progress"].includes(activeRide.status);
  if (!activeStatus) return null;
  const saved = useAppStore.getState().savedDemoRide;

  return (
    <TouchableOpacity
      onPress={() => {
        if (saved) router.replace("/ride/track");
        else router.replace(`/ride/track?rideId=${activeRide.id}&live=1`);
      }}
      style={{
        position: "absolute",
        bottom: 96,
        alignSelf: "center",
        zIndex: 1000,
        backgroundColor: "#e04e2f",
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 8,
      }}
    >
      <Ionicons name="car-sport" size={16} color="#fff" />
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>
        Back to ride
      </Text>
    </TouchableOpacity>
  );
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
  // "Back to ride" pill. But NEVER resurrect an ancient/stale ride — a stuck
  // "driver_arrived"/"in_progress" from an hour+ ago (crash, forgot to finish,
  // demo test) would otherwise show "Trip in progress" on EVERY login with no
  // way to clear it. Anything older than this is treated as dead.
  const restoreActiveRideRef = useRef<(() => Promise<void>) | null>(null);
  restoreActiveRideRef.current = async () => {
    try {
      const { ride } = await getActiveRide();
      if (ride && ride.id) {
        const created = ride.created_at ? new Date(ride.created_at).getTime() : Date.now();
        const ageMin = (Date.now() - created) / 60000;
        if (ageMin > 240) {
          // Stale ride from an old session — do NOT restore it. Clear any
          // lingering minimized/pill state so the home screen is clean.
          useAppStore.getState().resetRideState();
          return;
        }
        useAppStore.getState().setActiveRide(ride as any);
        useAppStore.getState().setSavedDemoRide(null);
        // Keep minimized state so the banner shows even right after launch.
        useAppStore.getState().setRideMinimized(true);
        await persistActiveRide(ride as any);

        // Auto-resume into the live trip (mirror the driver app). If we're
        // already on the track screen, don't re-navigate (would double-mount).
        const seg = segments as readonly string[];
        const onTrack = seg[0] === "ride" && seg[1] === "track";
        if (!onTrack) {
          router.replace(`/ride/track?rideId=${ride.id}&live=1`);
        }
      } else {
        // No server-active ride, but the OS may have remembered one locally
        // (e.g. app was killed right after booking). Restore from the saved
        // snapshot so the trip isn't silently lost on relaunch.
        const saved = await loadActiveRideSnapshot();
        if (saved?.id) {
          const created = saved.created_at ? new Date(saved.created_at).getTime() : Date.now();
          const ageMin = (Date.now() - created) / 60000;
          if (ageMin > 240) {
            useAppStore.getState().resetRideState();
            return;
          }
          useAppStore.getState().setActiveRide(saved as any);
          useAppStore.getState().setSavedDemoRide(null);
          useAppStore.getState().setRideMinimized(true);
          const seg2 = segments as readonly string[];
          const onTrack2 = seg2[0] === "ride" && seg2[1] === "track";
          if (!onTrack2) {
            router.replace(`/ride/track?rideId=${saved.id}&live=1`);
          }
        }
      }
    } catch {
      // ignore — no active ride or offline
    }
  };

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      await restoreActiveRideRef.current?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  // When the app returns to the foreground (rider was backgrounded to use the
  // driver's app), re-verify and auto-resume the live trip — same as a cold
  // start. The driver app does this on launch; the rider must too.
  useEffect(() => {
    if (loading || !user) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        restoreActiveRideRef.current?.();
      }
    });
    return () => sub.remove();
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
      const data = response?.notification?.request?.content?.data as
        | { ride_id?: string; rideId?: string }
        | undefined;
      const rideId = data?.ride_id || data?.rideId;
      if (rideId) {
        // Tapping a ride push deep-links the rider into the live trip.
        router.replace(`/ride/track?rideId=${rideId}&live=1`);
      }
    });

    return () => {
      notificationListener.remove();
      responseListener.remove();
    };
  }, [router]);

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
            // (Auto-redirect to the Receipt on app open removed — the rating/tip prompt
            //  still lives inside the receipt/history flow where it belongs.)
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
        <View style={{ flex: 1 }}>
        <StatusBar style="auto" />
        <UpdateChecker />
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
            name="notifications"
            options={{ presentation: "card" }}
          />
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
        </View>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default RootLayout;
