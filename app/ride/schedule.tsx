import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatCurrency, estimateFare } from "@/lib/utils";
import { scheduleRide } from "@/services/SchedulingService";
import { useAppStore } from "@/lib/store";

const tiers = [
  { id: "go", name: "VuraGo", multiplier: 1 },
  { id: "x", name: "VuraX", multiplier: 1.3 },
  { id: "lux", name: "VuraLux", multiplier: 2 },
];

export default function ScheduleRideScreen() {
  const router = useRouter();
  const [selectedTier, setSelectedTier] = useState("x");
  const [dateStr, setDateStr] = useState(() => {
    const d = new Date(Date.now() + 3600000);
    return d.toISOString().split("T")[0];
  });
  const [timeStr, setTimeStr] = useState(() => {
    const d = new Date(Date.now() + 3600000);
    return d.toTimeString().slice(0, 5);
  });
  const [scheduling, setScheduling] = useState(false);

  const pickupAddress = useAppStore((s) => s.pickupAddress);
  const destinationAddress = useAppStore((s) => s.destinationAddress);

  async function handleSchedule() {
    const pickup = JSON.parse((await AsyncStorage.getItem("vura.ride.pickup")) || "null");
    const dropoff = JSON.parse((await AsyncStorage.getItem("vura.ride.dropoff")) || "null");

    if (!pickup || !dropoff) {
      Alert.alert("Error", "Missing pickup or destination. Please search again.");
      return;
    }

    const scheduledAt = new Date(`${dateStr}T${timeStr}:00`).toISOString();
    if (new Date(scheduledAt) <= new Date()) {
      Alert.alert("Error", "Please select a future date and time.");
      return;
    }

    setScheduling(true);
    try {
      await scheduleRide({
        pickupAddress: pickupAddress || "Pickup",
        pickupLat: pickup[0],
        pickupLng: pickup[1],
        destinationAddress: destinationAddress || "Destination",
        destinationLat: dropoff[0],
        destinationLng: dropoff[1],
        scheduledAt,
        tier: selectedTier,
      });
      Alert.alert("Scheduled!", "Your ride has been booked.", [
        { text: "OK", onPress: () => router.replace("/") },
      ]);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not schedule ride");
    } finally {
      setScheduling(false);
    }
  }

  const distance = 5;

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
          Schedule a Ride
        </Text>
        <Text className="text-sm text-white/80 mt-1">
          Book a ride in advance
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        <View className="rounded-xl bg-surface border border-border p-4 mb-4">
          <Text className="text-xs font-bold text-muted-foreground uppercase mb-3">
            Pickup
          </Text>
          <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
            {pickupAddress || "Current location"}
          </Text>
        </View>

        <View className="rounded-xl bg-surface border border-border p-4 mb-4">
          <Text className="text-xs font-bold text-muted-foreground uppercase mb-3">
            Destination
          </Text>
          <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
            {destinationAddress || "Set destination"}
          </Text>
        </View>

        <View className="rounded-xl bg-surface border border-border p-4 mb-4">
          <Text className="text-xs font-bold text-muted-foreground uppercase mb-3">
            Schedule for
          </Text>
          <View className="flex-row gap-3">
            <View className="flex-1 gap-y-1">
              <Text className="text-xs font-bold text-muted-foreground ml-1">
                Date (YYYY-MM-DD)
              </Text>
              <TextInput
                placeholder="2026-07-25"
                placeholderTextColor="#80716b"
                value={dateStr}
                onChangeText={setDateStr}
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground"
              />
            </View>
            <View className="flex-1 gap-y-1">
              <Text className="text-xs font-bold text-muted-foreground ml-1">
                Time (HH:MM)
              </Text>
              <TextInput
                placeholder="14:30"
                placeholderTextColor="#80716b"
                value={timeStr}
                onChangeText={setTimeStr}
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground"
              />
            </View>
          </View>
        </View>

        <View className="rounded-xl bg-surface border border-border p-4 mb-6">
          <Text className="text-xs font-bold text-muted-foreground uppercase mb-3">
            Ride tier
          </Text>
          <View className="gap-y-2">
            {tiers.map((t) => {
              const active = selectedTier === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setSelectedTier(t.id)}
                  className={`flex-row items-center justify-between rounded-xl px-4 py-3 ${active ? "bg-primary/10 border border-primary" : "bg-secondary"}`}
                >
                  <Text className={`text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>
                    {t.name}
                  </Text>
                  <Text className="text-sm font-semibold text-muted-foreground">
                    {formatCurrency(estimateFare(distance, t.multiplier))}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <TouchableOpacity
          onPress={handleSchedule}
          disabled={scheduling}
          className="w-full rounded-xl bg-primary py-4 items-center mb-6"
        >
          {scheduling ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-sm font-bold text-primary-foreground">
              Schedule {tiers.find((t) => t.id === selectedTier)?.name}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
