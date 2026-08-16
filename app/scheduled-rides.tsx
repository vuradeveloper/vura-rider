import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getScheduledRides, cancelScheduledRide } from "@/services/SchedulingService";
import { useAppStore } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";
import type { ScheduledRide } from "@/lib/types";

export default function ScheduledRidesScreen() {
  const router = useRouter();
  const [rides, setRides] = useState<ScheduledRide[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRides();
  }, []);

  async function loadRides() {
    setLoading(true);
    try {
      const { rides: data } = await getScheduledRides();
      setRides(data);
      useAppStore.getState().setScheduledRides(data);
    } catch {
      setRides([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(id: string) {
    Alert.alert("Cancel scheduled ride?", "This cannot be undone.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel",
        style: "destructive",
        onPress: async () => {
          try {
            await cancelScheduledRide(id);
            setRides((prev) => prev.filter((r) => r.id !== id));
            Alert.alert("Cancelled", "Scheduled ride has been cancelled.");
          } catch (err: any) {
            Alert.alert("Error", err.message || "Could not cancel");
          }
        },
      },
    ]);
  }

  const activeRides = rides.filter((r) => r.status === "scheduled" || r.status === "searching" || r.status === "pending" || r.status === "accepted");

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <TouchableOpacity
          onPress={() => router.back()}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#fff" />
        </TouchableOpacity>
        <Text className="mt-12 text-2xl font-extrabold text-white">
          Scheduled Rides
        </Text>
        <Text className="text-sm text-white/80 mt-1">
          {activeRides.length} upcoming ride{activeRides.length !== 1 ? "s" : ""}
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        {loading && (
          <ActivityIndicator size="large" color="#e04e2f" style={{ marginTop: 40 }} />
        )}

        {!loading && rides.length === 0 && (
          <View className="items-center py-16">
            <Ionicons name="calendar-outline" size={48} color="#80716b" />
            <Text className="text-sm text-muted-foreground mt-3">
              No scheduled rides yet.
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/search")}
              className="mt-4 rounded-full bg-primary px-5 py-2.5"
            >
              <Text className="text-xs font-bold text-primary-foreground">
                Book a ride
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading &&
          rides.map((r) => (
            <View
              key={r.id}
              className="rounded-2xl bg-surface border border-border p-4 mb-3"
            >
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center gap-1.5">
                  <View
                    className={`w-2 h-2 rounded-full ${
                      r.status === "scheduled"
                        ? "bg-amber-500"
                        : r.status === "searching"
                          ? "bg-blue-500"
                          : r.status === "accepted"
                            ? "bg-emerald-500"
                            : "bg-amber-500"
                    }`}
                  />
                  <Text className="text-xs font-bold text-foreground capitalize">
                    {r.status}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleCancel(r.id)}
                  className="w-8 h-8 rounded-full bg-red-50 items-center justify-center"
                >
                  <Ionicons name="close" size={14} color="#dc2626" />
                </TouchableOpacity>
              </View>

              <Text className="text-sm font-bold text-foreground mb-3">
                {new Date(r.scheduled_at).toLocaleDateString("en-ZA", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>

              <View className="flex-row items-start gap-2 mb-2">
                <View className="w-5 items-center pt-1">
                  <View className="w-2 h-2 rounded-full bg-foreground" />
                </View>
                <Text className="text-sm text-foreground flex-1" numberOfLines={1}>
                  {r.pickup_address}
                </Text>
              </View>
              <View className="flex-row items-start gap-2">
                <View className="w-5 items-center pt-0.5">
                  <View className="w-2 h-2 rounded-md bg-primary" />
                </View>
                <Text className="text-sm text-foreground flex-1" numberOfLines={1}>
                  {r.destination_address}
                </Text>
              </View>

              {r.driver_name && (
                <View className="mt-3 flex-row items-center gap-2 border-t border-border pt-3">
                  <Ionicons name="person" size={14} color="#80716b" />
                  <Text className="text-xs text-muted-foreground">
                    Driver: {r.driver_name}
                  </Text>
                </View>
              )}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}
