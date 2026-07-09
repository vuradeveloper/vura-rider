import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { getRideHistory } from "@/services/RideService";
import { useAuth } from "@/lib/auth";
import { formatCurrency, formatRideDate } from "@/lib/utils";
import type { RideWithDetails } from "@/lib/types";

export default function Activity() {
  const router = useRouter();
  const { user } = useAuth();
  const isDriver = user?.role === "driver";
  const [tab, setTab] = useState<"Past" | "Upcoming" | "Drafts">("Past");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["ride-history"],
    queryFn: () => getRideHistory(1, 30),
  });

  const rides = data?.rides ?? [];

  const title = (r: RideWithDetails) =>
    isDriver
      ? r.pickup_address?.split(",")[0] || "Trip"
      : r.destination_address?.split(",")[0] || "Trip";

  const statusLabel = (r: RideWithDetails) =>
    r.status === "cancelled" ? "Cancelled" : "Completed";

  const amount = (r: RideWithDetails) => {
    const fare = r.fare ?? 0;
    const total = isDriver ? fare : fare + (r.ride_request_fee ?? 0);
    return formatCurrency(total);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem]">
          <Text className="text-2xl font-bold text-white">Activity</Text>
          <Text className="text-sm text-white/80 mt-1">
            Your past trips and orders.
          </Text>
          <View className="mt-4 flex-row gap-2 rounded-2xl bg-white/15 p-1">
            {(["Past", "Upcoming", "Drafts"] as const).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setTab(t)}
                className={`flex-1 rounded-xl py-2 items-center ${tab === t ? "bg-surface" : ""}`}
              >
                <Text
                  className={`text-xs font-bold ${tab === t ? "text-primary" : "text-white/80"}`}
                >
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="px-5 mt-5 gap-y-2">
          {isLoading && (
            <ActivityIndicator
              size="small"
              color="#e04e2f"
              style={{ marginVertical: 32 }}
            />
          )}

          {isError && !isLoading && (
            <View className="items-center py-12">
              <Ionicons name="cloud-offline" size={40} color="#80716b" />
              <Text className="text-sm text-muted-foreground mt-3">
                Couldn't load your trips.
              </Text>
              <TouchableOpacity
                onPress={() => refetch()}
                className="mt-4 rounded-full bg-secondary px-5 py-2.5"
              >
                <Text className="text-sm font-bold text-foreground">Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {!isLoading && !isError && tab !== "Past" && (
            <View className="items-center py-12">
              <Ionicons name="calendar-outline" size={40} color="#80716b" />
              <Text className="text-sm text-muted-foreground mt-3">
                No {tab.toLowerCase()} trips.
              </Text>
            </View>
          )}

          {!isLoading && !isError && tab === "Past" && rides.length === 0 && (
            <View className="items-center py-12">
              <Ionicons name="car-outline" size={40} color="#80716b" />
              <Text className="text-sm text-muted-foreground mt-3">
                No trips yet. Your rides will show up here.
              </Text>
            </View>
          )}

          {!isError &&
            tab === "Past" &&
            rides.map((t) => (
              <TouchableOpacity
                key={t.id}
                onPress={() => router.push(`/ride/track?rideId=${t.id}`)}
                className="w-full flex-row items-center gap-3 rounded-2xl bg-surface border border-border p-3.5"
              >
                <View className="w-12 h-12 rounded-full bg-secondary items-center justify-center">
                  <Ionicons
                    name={t.status === "cancelled" ? "close-circle" : "car"}
                    size={20}
                    color={t.status === "cancelled" ? "#dc2626" : "#2e1e1a"}
                  />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-sm font-bold text-foreground"
                    numberOfLines={1}
                  >
                    {title(t)}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {formatRideDate(t.created_at)} · {statusLabel(t)}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm font-extrabold text-foreground">
                    {amount(t)}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#80716b" />
                </View>
              </TouchableOpacity>
            ))}
        </View>
        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}
