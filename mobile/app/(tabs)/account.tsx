import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { logout, setUser, useAuth } from "@/lib/auth";
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
    icon: "gift" as const,
    label: "Promotions",
    sub: "2 active offers",
    to: "/promotions",
    wide: false,
  },
  {
    icon: "shield" as const,
    label: "Safety",
    sub: "Trusted contacts, RideCheck",
    to: "/safety",
    wide: false,
  },
  {
    icon: "settings" as const,
    label: "Settings",
    sub: "Notifications, privacy",
    to: "/settings",
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
  const { user, refresh } = useAuth();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (ready && !user) {
      router.replace("/welcome");
    }
  }, [ready, user, router]);

  if (!ready || !user) return null;

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

  const isDriver = user.role === "driver";

  const driverStatsQuery = useQuery<DriverStats>({
    queryKey: ["driver-stats"],
    queryFn: getDriverStats,
    enabled: isDriver,
  });

  const historyQuery = useQuery({
    queryKey: ["ride-history"],
    queryFn: () => getRideHistory(1, 1),
    enabled: !isDriver,
  });

  const cardsQuery = useQuery<SavedCard[]>({
    queryKey: ["saved-cards"],
    queryFn: getSavedCards,
  });

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
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="bg-primary px-5 pt-4 pb-12 rounded-b-[2rem] relative overflow-hidden">
          <View className="absolute -right-12 -bottom-10 h-44 w-44 rounded-full bg-white/10" />
          <Text className="text-xl font-bold text-white">Account</Text>
          <View className="mt-4 flex-row items-center gap-3">
            <View className="h-16 w-16 rounded-full bg-surface items-center justify-center border border-border">
              <Text className="text-xl font-extrabold text-primary">
                {initials || "U"}
              </Text>
            </View>
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
            <TouchableOpacity
              onPress={switchRole}
              className="flex-row items-center gap-3 rounded-xl bg-surface border border-border p-4"
            >
              <View className="w-10 h-10 rounded-full bg-accent items-center justify-center">
                <Ionicons name="refresh" size={16} color="#e04e2f" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-foreground">
                  Switch to {user.role === "driver" ? "rider" : "driver"}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Try the other side of Vura
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#80716b" />
            </TouchableOpacity>

            <View className="flex-row flex-wrap gap-3">
              {items.map((it) => (
                <Link key={it.label} href={it.to as any} asChild>
                  <TouchableOpacity
                    className={`rounded-xl bg-surface border border-border p-4 ${it.wide ? "w-full flex-row items-center justify-between" : "w-[47%]"}`}
                  >
                    <View
                      className={`flex-row items-center gap-3 ${it.wide ? "flex-1" : ""}`}
                    >
                      <View className="w-10 h-10 rounded-full bg-accent items-center justify-center">
                        <Ionicons name={it.icon} size={16} color="#e04e2f" />
                      </View>
                      <View className={it.wide ? "flex-1" : ""}>
                        <Text className="text-sm font-bold text-foreground">
                          {it.label}
                        </Text>
                        <Text
                          className="text-muted-foreground text-xs mt-0.5"
                          numberOfLines={it.wide ? 1 : 2}
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
                </Link>
              ))}
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
