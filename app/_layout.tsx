import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { View, Text, ActivityIndicator, TouchableOpacity, Animated } from "react-native";
import { useAuth } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";

const queryClient = new QueryClient();

// Floating "Go Back To Ride" pill shown on every screen while a ride is active
// AND the rider left the ride screen with the X (rideMinimized). Once minimized,
// the rider can return to the live trip from anywhere until the ride ends.
function ActiveRideBanner() {
  const router = useRouter();
  const activeRide = useAppStore((s) => s.activeRide);
  const rideMinimized = useAppStore((s) => s.rideMinimized);
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!rideMinimized || !activeRide) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.2, duration: 600, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [rideMinimized, activeRide, blink]);

  if (!rideMinimized || !activeRide) return null;

  const active = ["searching", "accepted", "driver_arrived", "in_progress"].includes(activeRide.status);
  if (!active) return null;

  return (
    <TouchableOpacity
      onPress={() => {
        // Navigate back to the ride WITHOUT clearing the minimized flag — the
        // track screen restores the ride state and clears it once restored,
        // so the ride request is not re-fired and searching isn't restarted.
        if (activeRide.id) {
          router.push(`/ride/track?rideId=${activeRide.id}`);
        } else {
          router.push("/ride/track");
        }
      }}
      activeOpacity={0.85}
      style={{
        position: "absolute",
        bottom: 96,
        left: 24,
        right: 24,
        zIndex: 999,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: "#fff",
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: "#3b82f6",
        paddingVertical: 12,
        paddingHorizontal: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      }}
    >
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: "#3b82f6",
        }}
      />
      <Animated.View
        style={{
          position: "absolute",
          left: 18,
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: "#3b82f6",
          opacity: blink,
        }}
      />
      <Ionicons name="car" size={20} color="#3b82f6" />
      <Text style={{ flex: 1, color: "#2e1e1a", fontSize: 15, fontWeight: "700" }}>
        Go Back To Ride
      </Text>
      <Ionicons name="chevron-forward" size={18} color="#3b82f6" />
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
