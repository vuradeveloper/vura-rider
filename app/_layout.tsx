import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useAuth } from "@/lib/auth";

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

export default function RootLayout() {
  return (
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
          name="help"
          options={{ presentation: "card" }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>
    </QueryClientProvider>
  );
}
