import { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Picker } from "@react-native-picker/picker";
import { formatCurrency, estimateFare } from "@/lib/utils";
import { scheduleRide } from "@/services/SchedulingService";
import { useAppStore } from "@/lib/store";

const tiers = [
  { id: "go", name: "VuraGo", multiplier: 1 },
  { id: "x", name: "VuraX", multiplier: 1.3 },
  { id: "lux", name: "VuraLux", multiplier: 2 },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Now + 1h, rounded up to the nearest 15-minute slot.
function defaultTime() {
  const t = new Date(Date.now() + 3600000);
  let m = Math.ceil(t.getMinutes() / 15) * 15;
  let h = t.getHours();
  if (m >= 60) {
    m = 0;
    h += 1;
  }
  return `${pad(h % 24)}:${pad(m)}`;
}

export default function ScheduleRideScreen() {
  const router = useRouter();
  const [selectedTier, setSelectedTier] = useState("x");
  const [scheduling, setScheduling] = useState(false);
  const [timeStr, setTimeStr] = useState(defaultTime);

  const pickupAddress = useAppStore((s) => s.pickupAddress);
  const destinationAddress = useAppStore((s) => s.destinationAddress);

  const dateOptions = useMemo(() => {
    const out: Date[] = [];
    const now = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, []);
  const [dateIndex, setDateIndex] = useState(0);

  const timeOptions = useMemo(() => {
    const out: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) out.push(`${pad(h)}:${pad(m)}`);
    }
    return out;
  }, []);

  const selectedDate = dateOptions[dateIndex];

  async function handleSchedule() {
    const pickup = JSON.parse((await AsyncStorage.getItem("vura.ride.pickup")) || "null");
    const dropoff = JSON.parse((await AsyncStorage.getItem("vura.ride.dropoff")) || "null");

    if (!pickup || !dropoff) {
      Alert.alert("Error", "Missing pickup or destination. Please search again.");
      return;
    }

    const chosen = new Date(`${dateKey(selectedDate)}T${timeStr}:00`);
    if (chosen.getTime() <= Date.now()) {
      Alert.alert("Error", "Please choose a future date and time.");
      return;
    }
    const scheduledAt = chosen.toISOString();

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
      Alert.alert("Ride scheduled!", "We'll book your driver closer to pickup time.", [
        { text: "View schedule", onPress: () => router.replace("/scheduled-rides") },
      ]);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not schedule ride");
    } finally {
      setScheduling(false);
    }
  }

  const distance = 5;
  const chosen = (() => {
    const d = new Date(`${dateKey(selectedDate)}T${timeStr}:00`);
    return d.getTime() > Date.now() ? d : null;
  })();

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
            Pickup date
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {dateOptions.map((d, i) => {
              const active = i === dateIndex;
              const label =
                i === 0 ? "Today" : i === 1 ? "Tomorrow" : WEEKDAYS[d.getDay()];
              return (
                <TouchableOpacity
                  key={dateKey(d)}
                  onPress={() => setDateIndex(i)}
                  className={`w-20 rounded-xl px-2 py-3 items-center border ${
                    active ? "bg-primary border-primary" : "bg-secondary border-border"
                  }`}
                >
                  <Text
                    className={`text-[11px] font-bold uppercase ${
                      active ? "text-white" : "text-muted-foreground"
                    }`}
                  >
                    {label}
                  </Text>
                  <Text
                    className={`text-lg font-extrabold mt-1 ${
                      active ? "text-white" : "text-foreground"
                    }`}
                  >
                    {d.getDate()}
                  </Text>
                  <Text
                    className={`text-[10px] font-semibold ${
                      active ? "text-white/80" : "text-muted-foreground"
                    }`}
                  >
                    {MONTHS[d.getMonth()]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <View className="rounded-xl bg-surface border border-border p-4 mb-4">
          <Text className="text-xs font-bold text-muted-foreground uppercase mb-3">
            Pickup time
          </Text>
          <View className="rounded-xl bg-secondary overflow-hidden">
            <Picker
              selectedValue={timeStr}
              onValueChange={(v) => setTimeStr(String(v))}
              style={{ height: 120 }}
              itemStyle={{ fontSize: 16, fontWeight: "600" }}
            >
              {timeOptions.map((t) => (
                <Picker.Item key={t} label={t} value={t} />
              ))}
            </Picker>
          </View>
          {chosen && (
            <Text className="text-xs text-muted-foreground mt-2">
              {chosen.toLocaleDateString("en-ZA", {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          )}
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
