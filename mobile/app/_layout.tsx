import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
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
