import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useAuth } from "@/lib/auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";

const queryClient = new QueryClient();

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
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default RootLayout;
