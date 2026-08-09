import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as LocalAuthentication from "expo-local-authentication";
import {
  logout,
  setUser,
  useAuth,
  sendVerificationEmail,
  saveBiometricCredentials,
  clearBiometricCredentials,
  hasBiometricCredentials,
} from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { getDriverStats } from "@/services/DriverService";
import { getRideHistory } from "@/services/RideService";
import { getSavedCards } from "@/services/PaymentService";
import type { DriverStats, SavedCard } from "@/lib/types";

const items = [
  {
    icon: "wallet" as const,
    label: "Wallet",
    sub: "Payment methods & cash",
    to: "/wallet",
    wide: true,
  },
  {
    icon: "calendar" as const,
    label: "Scheduled Rides",
    sub: "Upcoming bookings",
    to: "/scheduled-rides",
    wide: true,
  },
  {
    icon: "gift" as const,
    label: "Promotions",
    sub: "2 active offers",
    to: "/promotions",
    wide: false,
  },
  {
    icon: "shield" as const,
    label: "Safety",
    sub: "Contacts & RideCheck",
    to: "/safety",
    wide: false,
  },
  {
    icon: "settings" as const,
    label: "Personal Details",
    sub: "Notifications, privacy",
    to: "/settings",
    wide: true,
  },
  {
    icon: "pin" as const,
    label: "Saved Places",
    sub: "Home, Work, favorites",
    to: "/saved-places",
    wide: false,
  },
  {
    icon: "help-circle" as const,
    label: "Help",
    sub: "Past trips, support",
    to: "/help",
    wide: false,
  },
];

export default function Account() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const [emailVerified, setEmailVerified] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  useEffect(() => {
    if (user) {
      setEmailVerified(auth.currentUser?.emailVerified ?? false);
      hasBiometricCredentials().then(setBiometricEnabled);
    }
  }, [user]);

  const isDriver = user?.role === "driver";

  const driverStatsQuery = useQuery<DriverStats>({
    queryKey: ["driver-stats"],
    queryFn: getDriverStats,
    enabled: isDriver && !!user,
  });

  const historyQuery = useQuery({
    queryKey: ["ride-history"],
    queryFn: () => getRideHistory(1, 1),
    enabled: !isDriver && !!user,
  });

  const cardsQuery = useQuery<SavedCard[]>({
    queryKey: ["saved-cards"],
    queryFn: getSavedCards,
    enabled: !!user,
  });

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/welcome");
    }
  }, [loading, user, router]);

  if (loading || !user) return null;

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isVerified = Boolean(
    user.idNumber &&
      (user.role === "driver" ? user.licenseDocumentName : user.idDocumentName)
  );

  async function signOut() {
    await logout();
    refresh();
    router.replace("/welcome");
  }

  async function switchRole() {
    const newRole = user!.role === "driver" ? "rider" : "driver";
    await setUser({ ...user!, role: newRole });
    refresh();
    router.replace("/");
  }

  const tripCount = isDriver
    ? driverStatsQuery.data?.allTime.rides
    : historyQuery.data?.pagination.total;
  const ratingValue = isDriver ? driverStatsQuery.data?.rating.average : null;
  const cardCount = cardsQuery.data?.length ?? 0;

  const statCards = isDriver
    ? [
        { v: tripCount != null ? String(tripCount) : "—", l: "Trips" },
        {
          v:
            driverStatsQuery.data != null
              ? `R${Math.round(driverStatsQuery.data.allTime.earned)}`
              : "—",
          l: "Earned",
        },
        {
          v:
            ratingValue != null && ratingValue > 0
              ? ratingValue.toFixed(2)
              : "New",
          l: "Rating",
        },
      ]
    : [
        { v: tripCount != null ? String(tripCount) : "—", l: "Trips" },
        { v: String(cardCount), l: "Cards" },
        { v: "Gold", l: "Tier" },
      ];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView 
        className="flex-1" 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 110 }}
      >
        <View className="bg-primary px-5 pt-4 pb-12 rounded-b-[2rem] relative overflow-hidden">
          <View className="absolute -right-12 -bottom-10 h-44 w-44 rounded-full bg-white/10" />
          <Text className="text-xl font-bold text-white">Account</Text>
          <View className="mt-4 flex-row items-center gap-3">
            {user.photoURL ? (
              <Image
                source={{ uri: user.photoURL }}
                className="h-16 w-16 rounded-full border border-border"
              />
            ) : (
              <View className="h-16 w-16 rounded-full bg-surface items-center justify-center border border-border">
                <Text className="text-xl font-extrabold text-primary">
                  {initials || "U"}
                </Text>
              </View>
            )}
            <View>
              <View className="flex-row items-center gap-2">
                <Text className="text-lg font-bold text-white">
                  {user.name}
                </Text>
                {isVerified && (
                  <View className="flex-row items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5">
                    <Ionicons name="checkmark-circle" size={12} color="#10b981" />
                    <Text className="text-[10px] font-bold text-emerald-500 uppercase">
                      Verified
                    </Text>
                  </View>
                )}
              </View>
              <Text className="text-xs text-white/80 mt-0.5">{user.email}</Text>
              {!emailVerified ? (
                <TouchableOpacity
                  onPress={() => {
                    sendVerificationEmail();
                    Alert.alert("Verification sent", "Check your email to verify your account.");
                  }}
                  className="mt-1 flex-row items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 self-start"
                >
                  <Ionicons name="warning" size={12} color="#f59e0b" />
                  <Text className="text-[10px] font-bold text-amber-500 uppercase">
                    Verify email
                  </Text>
                </TouchableOpacity>
              ) : (
                <View className="mt-1 flex-row items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 self-start">
                  <Ionicons name="checkmark-circle" size={12} color="#10b981" />
                  <Text className="text-[10px] font-bold text-emerald-500 uppercase">
                    Email verified
                  </Text>
                </View>
              )}
              <View className="mt-1 flex-row items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 self-start">
                <Ionicons name="star" size={12} color="#fff" />
                <Text className="text-xs font-semibold text-white capitalize">
                  {ratingValue != null && ratingValue > 0
                    ? ratingValue.toFixed(2)
                    : isDriver
                      ? "New"
                      : ""}
                  {ratingValue != null && ratingValue > 0 ? " · " : ""}
                  {user.role}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View className="px-5 -mt-6">
          <View className="flex-row rounded-2xl bg-surface border border-border p-4">
            {statCards.map((s) => (
              <View key={s.l} className="flex-1 items-center">
                <Text className="text-lg font-extrabold text-foreground">
                  {s.v}
                </Text>
                <Text className="text-[11px] text-muted-foreground uppercase font-semibold">
                  {s.l}
                </Text>
              </View>
            ))}
          </View>

          <View className="mt-5 gap-y-3">
            <View className="flex-row flex-wrap gap-3">
              {items.map((it) => (
                <TouchableOpacity
                  key={it.label}
                  onPress={() => router.push(it.to as any)}
                  className={`rounded-xl bg-surface border border-border p-4 ${it.wide ? "w-full flex-row items-center justify-between" : "w-[47.5%] min-h-[115px]"}`}
                >
                  <View
                    className={it.wide ? "flex-row items-center gap-3 flex-1" : "flex-1 justify-between"}
                  >
                    <View className="w-10 h-10 rounded-full bg-accent items-center justify-center self-start">
                      <Ionicons name={it.icon} size={16} color="#e04e2f" />
                    </View>
                    <View className={it.wide ? "flex-1" : "mt-2"}>
                      <Text className="text-sm font-bold text-foreground">
                        {it.label}
                      </Text>
                      <Text
                        className="text-muted-foreground text-[10px] leading-tight mt-0.5"
                        numberOfLines={2}
                      >
                        {it.sub}
                      </Text>
                    </View>
                  </View>
                  {it.wide && (
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color="#80716b"
                    />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {biometricEnabled ? (
              <TouchableOpacity
                onPress={() => {
                  clearBiometricCredentials();
                  setBiometricEnabled(false);
                  Alert.alert("Disabled", "Biometric login has been turned off.");
                }}
                className="flex-row items-center justify-between rounded-xl border border-border bg-surface p-4"
              >
                <View className="flex-row items-center gap-3">
                  <View className="w-10 h-10 rounded-full bg-accent items-center justify-center">
                    <Ionicons name="finger-print" size={16} color="#e04e2f" />
                  </View>
                  <View>
                    <Text className="text-sm font-bold text-foreground">
                      Biometric login
                    </Text>
                    <Text className="text-muted-foreground text-xs mt-0.5">
                      Fingerprint / Face ID
                    </Text>
                  </View>
                </View>
                <Text className="text-xs font-semibold text-primary">Disable</Text>
              </TouchableOpacity>
            ) : null}

            <View className="mt-4 flex-row gap-3">
              <TouchableOpacity
                onPress={() => router.push("/terms")}
                className="flex-1 items-center rounded-xl border border-border bg-surface py-3"
              >
                <Ionicons name="document-text" size={16} color="#80716b" />
                <Text className="text-xs font-semibold text-muted-foreground mt-1">
                  Terms
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push("/privacy")}
                className="flex-1 items-center rounded-xl border border-border bg-surface py-3"
              >
                <Ionicons name="shield" size={16} color="#80716b" />
                <Text className="text-xs font-semibold text-muted-foreground mt-1">
                  Privacy
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={signOut}
              className="flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface py-4 mt-2"
            >
              <Ionicons name="log-out" size={16} color="#e04e2f" />
              <Text className="text-sm font-bold text-primary">Sign out</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}
