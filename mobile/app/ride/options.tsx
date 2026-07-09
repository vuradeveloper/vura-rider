import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { getSavedCards } from "@/services/PaymentService";
import {
  formatCurrency,
  haversineKm,
  estimateFare,
  estimateEtaMins,
} from "@/lib/utils";
import type { SavedCard } from "@/lib/types";

const tiers = [
  {
    id: "go",
    name: "VuraGo",
    desc: "Affordable, everyday rides",
    icon: "people" as const,
    multiplier: 1,
    etaOffset: 0,
  },
  {
    id: "x",
    name: "VuraX",
    desc: "Faster pickups, comfy cars",
    icon: "flash" as const,
    multiplier: 1.3,
    etaOffset: 1,
    badge: "Popular",
  },
  {
    id: "lux",
    name: "VuraLux",
    desc: "Premium cars, top-rated drivers",
    icon: "diamond" as const,
    multiplier: 2,
    etaOffset: 3,
  },
];

type PayChoice =
  | { type: "cash" }
  | { type: "card"; id: string; last4: string | null };

export default function RideOptions() {
  const router = useRouter();
  const [selected, setSelected] = useState("x");
  const [showPayment, setShowPayment] = useState(false);
  const [payChoice, setPayChoice] = useState<PayChoice>({ type: "cash" });
  const [distanceKm, setDistanceKm] = useState<number | null>(null);

  const cardsQuery = useQuery<SavedCard[]>({
    queryKey: ["saved-cards"],
    queryFn: getSavedCards,
  });

  useEffect(() => {
    (async () => {
      try {
        const p = JSON.parse(
          (await AsyncStorage.getItem("vura.ride.pickup")) || "null"
        );
        const d = JSON.parse(
          (await AsyncStorage.getItem("vura.ride.dropoff")) || "null"
        );
        if (p?.length === 2 && d?.length === 2) {
          setDistanceKm(haversineKm(p[0], p[1], d[0], d[1]));
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const priced = useMemo(
    () =>
      tiers.map((t) => {
        const fare = distanceKm != null ? estimateFare(distanceKm, t.multiplier) : null;
        const eta =
          distanceKm != null ? estimateEtaMins(distanceKm) + t.etaOffset : null;
        return { ...t, fare, eta };
      }),
    [distanceKm]
  );

  const cards = cardsQuery.data ?? [];

  const confirm = async () => {
    await AsyncStorage.setItem("vura.ride.tier", selected);
    await AsyncStorage.setItem(
      "vura.ride.payment",
      payChoice.type === "cash" ? "cash" : "card"
    );
    router.push("/ride/track");
  };

  const selectedTierName = tiers.find((t) => t.id === selected)?.name;

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Map placeholder */}
      <View className="relative h-[260px] bg-secondary items-center justify-center">
        <Ionicons name="map" size={48} color="#80716b" />
        <Text className="text-xs text-muted-foreground mt-2">
          {distanceKm != null ? `${distanceKm.toFixed(1)} km trip` : "Route map"}
        </Text>
        <TouchableOpacity
          onPress={() => router.push("/search")}
          className="absolute top-3 left-4 w-9 h-9 rounded-full bg-surface border border-border items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
        </TouchableOpacity>
      </View>

      <View className="-mt-5 rounded-t-3xl bg-surface px-5 pt-5 pb-4 flex-1">
        <View className="mx-auto h-1.5 w-12 rounded-full bg-border mb-4" />
        <Text className="text-lg font-bold text-foreground mb-1">
          Choose a ride
        </Text>
        <Text className="text-xs text-muted-foreground mb-3">
          Recommended for your trip
        </Text>

        <ScrollView className="flex-1 gap-y-2" showsVerticalScrollIndicator={false}>
          {priced.map((r) => {
            const active = selected === r.id;
            return (
              <TouchableOpacity
                key={r.id}
                onPress={() => setSelected(r.id)}
                className={`w-full flex-row items-center gap-3 rounded-2xl border px-3.5 py-3 mb-2 ${active ? "border-primary bg-accent" : "border-border bg-surface"}`}
              >
                <View
                  className={`w-12 h-12 rounded-xl items-center justify-center ${active ? "bg-primary" : "bg-secondary"}`}
                >
                  <Ionicons
                    name={r.icon}
                    size={20}
                    color={active ? "#fff" : "#2e1e1a"}
                  />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-sm font-bold text-foreground">
                      {r.name}
                    </Text>
                    {r.badge && (
                      <View className="rounded-md bg-primary/10 px-2 py-0.5">
                        <Text className="text-[10px] font-bold text-primary uppercase">
                          {r.badge}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    {r.desc}
                    {r.eta != null ? ` · ${r.eta} min` : ""}
                  </Text>
                </View>
                <Text className="text-sm font-extrabold text-foreground">
                  {r.fare != null ? formatCurrency(r.fare) : "—"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View className="mt-4 flex-row gap-2">
          <TouchableOpacity
            onPress={() => setShowPayment(true)}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-secondary px-3 py-2.5"
          >
            <Ionicons
              name={payChoice.type === "card" ? "card" : "cash"}
              size={16}
              color="#2e1e1a"
            />
            <Text className="text-xs font-semibold text-foreground">
              {payChoice.type === "card" ? `•••• ${payChoice.last4}` : "Cash"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-secondary px-3 py-2.5">
            <Ionicons name="pricetag" size={16} color="#2e1e1a" />
            <Text className="text-xs font-semibold text-foreground">
              Add promo
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={confirm}
          className="mt-3 rounded-xl bg-primary py-4 items-center"
        >
          <Text className="text-sm font-bold text-primary-foreground">
            Confirm {selectedTierName}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Payment Modal */}
      <Modal
        visible={showPayment}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPayment(false)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setShowPayment(false)}
        >
          <TouchableOpacity activeOpacity={1} className="bg-surface rounded-t-[2rem] p-5">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-foreground">
                Select Payment
              </Text>
              <TouchableOpacity
                onPress={() => setShowPayment(false)}
                className="w-8 h-8 rounded-full bg-secondary items-center justify-center"
              >
                <Ionicons name="close" size={16} color="#2e1e1a" />
              </TouchableOpacity>
            </View>
            <View className="gap-y-2">
              {cardsQuery.isLoading && (
                <ActivityIndicator size="small" color="#e04e2f" />
              )}
              {cards.map((c) => {
                const active =
                  payChoice.type === "card" && payChoice.id === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => {
                      setPayChoice({ type: "card", id: c.id, last4: c.last4 });
                      setShowPayment(false);
                    }}
                    className={`w-full flex-row items-center gap-3 p-3 rounded-xl border ${active ? "border-primary bg-primary/5" : "border-border bg-surface"}`}
                  >
                    <View className="w-10 h-10 rounded-full items-center justify-center bg-blue-100">
                      <Ionicons name="card" size={20} color="#2563eb" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-bold text-foreground">
                        •••• {c.last4}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        {c.bank || c.card_type || "Card"}
                      </Text>
                    </View>
                    {active && (
                      <View className="w-2.5 h-2.5 rounded-md bg-primary" />
                    )}
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                onPress={() => {
                  setPayChoice({ type: "cash" });
                  setShowPayment(false);
                }}
                className={`w-full flex-row items-center gap-3 p-3 rounded-xl border ${payChoice.type === "cash" ? "border-primary bg-primary/5" : "border-border bg-surface"}`}
              >
                <View className="w-10 h-10 rounded-full items-center justify-center bg-green-100">
                  <Ionicons name="cash" size={20} color="#16a34a" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-foreground">Cash</Text>
                </View>
                {payChoice.type === "cash" && (
                  <View className="w-2.5 h-2.5 rounded-md bg-primary" />
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
