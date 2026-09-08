import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { getNotifications } from "@/services/NotificationService";
import type { AppNotification } from "@/services/NotificationService";

const TYPE_ICON: Record<string, { name: any; bg: string }> = {
  searching: { name: "search", bg: "#fef3c7" },
  accepted: { name: "car-sport", bg: "#dcfce7" },
  driver_arrived: { name: "location", bg: "#dbeafe" },
  in_progress: { name: "navigate", bg: "#dbeafe" },
  completed: { name: "checkmark-circle", bg: "#dcfce7" },
  cancelled: { name: "close-circle", bg: "#fee2e2" },
  expired: { name: "time", bg: "#f3f4f6" },
  scheduled: { name: "calendar", bg: "#ede9fe" },
};

function getTypeIcon(t: string) {
  return TYPE_ICON[t] || { name: "notifications", bg: "#f3f4f6" };
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["notifications", user?.uid ?? "anon"],
    queryFn: getNotifications,
    enabled: !!user,
  });

  const notifications: AppNotification[] = data?.notifications ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-5 pt-4 pb-3 border-b border-border bg-surface">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-9 h-9 rounded-full bg-secondary items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
        </TouchableOpacity>
        <Text className="text-sm font-bold text-foreground">Notifications</Text>
        <View className="w-9 h-9" />
      </View>

      <ScrollView
        className="flex-1 px-5 mt-4"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#e04e2f" />
        }
      >
        {isLoading ? (
          <View className="rounded-2xl bg-surface border border-border p-10 items-center">
            <ActivityIndicator color="#e04e2f" />
          </View>
        ) : isError ? (
          <View className="rounded-2xl bg-surface border border-border p-10 items-center">
            <Ionicons name="alert-circle" size={40} color="#80716b" />
            <Text className="text-sm text-muted-foreground mt-3 text-center">
              Could not load notifications. Pull down to retry.
            </Text>
          </View>
        ) : notifications.length === 0 ? (
          <View className="rounded-2xl bg-surface border border-border p-10 items-center">
            <Ionicons name="notifications-off" size={44} color="#80716b" />
            <Text className="text-sm font-bold text-foreground mt-3">
              No notifications yet
            </Text>
            <Text className="text-xs text-muted-foreground mt-1 text-center">
              Ride updates will show up here.
            </Text>
          </View>
        ) : (
          notifications.map((n) => {
            const meta = getTypeIcon(n.type);
            return (
              <TouchableOpacity
                key={n.id}
                onPress={() => {
                  if (n.rideId) {
                    router.push({
                      pathname: "/ride/receipt",
                      params: { rideId: n.rideId },
                    });
                  }
                }}
                className="flex-row items-center gap-3 rounded-2xl bg-surface border border-border px-4 py-3 mb-2.5 active:opacity-80"
              >
                <View
                  className="w-11 h-11 rounded-full items-center justify-center"
                  style={{ backgroundColor: meta.bg }}
                >
                  <Ionicons
                    name={meta.name}
                    size={19}
                    color="#e04e2f"
                  />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="text-sm font-bold text-foreground flex-1" numberOfLines={1}>
                      {n.title}
                    </Text>
                    <Text className="text-[10px] text-muted-foreground">
                      {timeAgo(n.createdAt)}
                    </Text>
                  </View>
                  <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={2}>
                    {n.body}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#b3a8a1" />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}