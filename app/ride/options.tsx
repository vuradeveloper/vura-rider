import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  Platform,
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
import type { SavedCard, Waypoint } from "@/lib/types";

// ⚠️ Adjust these two imports to match where they actually live in your project.
import MapView, { Marker } from "@/components/MapView";
const CAR_LOCATOR_IMG = require("@/assets/images/CarLocator.png");

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

type NearbyCar = { id: string; lat: number; lng: number; angle: number };

export default function RideOptions() {
  const router = useRouter();
  const [selected, setSelected] = useState("x");
  const [showPayment, setShowPayment] = useState(false);
  const [payChoice, setPayChoice] = useState<PayChoice>({ type: "cash" });
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [pickupCoord, setPickupCoord] = useState<[number, number] | null>(null);
  const [dropoffCoord, setDropoffCoord] = useState<[number, number] | null>(null);
  const [nearbyCars, setNearbyCars] = useState<NearbyCar[]>([]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);

  const [scheduleMode, setScheduleMode] = useState(false);

  const cardsQuery = useQuery<SavedCard[]>({
    queryKey: ["saved-cards"],
    queryFn: getSavedCards,
  });

  // Extract event handlers to prevent potential closure issues
  const handleShowPayment = () => {
    setShowPayment(true);
  };

  const handleHidePayment = () => {
    setShowPayment(false);
  };

  useEffect(() => {
    (async () => {
      try {
        const p = JSON.parse(
          (await AsyncStorage.getItem("vura.ride.pickup")) || "null"
        );
        const d = JSON.parse(
          (await AsyncStorage.getItem("vura.ride.dropoff")) || "null"
        );
        const wp = JSON.parse(
          (await AsyncStorage.getItem("vura.ride.waypoints")) || "[]"
        );
        setWaypoints(wp);
        if (p?.length === 2 && d?.length === 2) {
          setDistanceKm(haversineKm(p[0], p[1], d[0], d[1]));
          setPickupCoord(p);
          setDropoffCoord(d);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // Simulate a few nearby drivers gently drifting around the pickup point,
  // rendered with CarLocator.png, so the map doesn't feel static while the
  // rider is choosing a ride tier. Swap this for a real "nearby drivers"
  // feed if/when your backend exposes one.
  useEffect(() => {
    if (!pickupCoord) return;
    const [baseLat, baseLng] = pickupCoord;

    setNearbyCars(
      [0, 1, 2].map((i) => ({
        id: `car-${i}`,
        lat: baseLat + (Math.random() - 0.5) * 0.01,
        lng: baseLng + (Math.random() - 0.5) * 0.01,
        angle: Math.random() * 360,
      }))
    );

    const interval = setInterval(() => {
      setNearbyCars((prev) =>
        prev.map((c) => {
          const angle = c.angle + (Math.random() - 0.5) * 40;
          const rad = (angle * Math.PI) / 180;
          const step = 0.0006;
          return {
            ...c,
            lat: c.lat + Math.cos(rad) * step,
            lng: c.lng + Math.sin(rad) * step,
            angle,
          };
        })
      );
    }, 1500);

    return () => clearInterval(interval);
  }, [pickupCoord]);

  const totalKm = useMemo(() => {
    if (!pickupCoord || !dropoffCoord) return distanceKm;
    const pts = [pickupCoord, ...waypoints.map((w) => [w.lat, w.lng] as [number, number]), dropoffCoord];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      total += haversineKm(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    }
    return total || distanceKm;
  }, [pickupCoord, dropoffCoord, waypoints, distanceKm]);

  const priced = useMemo(
    () =>
      tiers.map((t) => {
        const fare = totalKm != null ? estimateFare(totalKm, t.multiplier) : null;
        const eta =
          totalKm != null ? estimateEtaMins(totalKm) + t.etaOffset : null;
        return { ...t, fare, eta };
      }),
    [totalKm]
  );

  const cards = cardsQuery.data ?? [];

  const confirm = async () => {
    await AsyncStorage.setItem("vura.ride.tier", selected);
    await AsyncStorage.setItem(
      "vura.ride.payment",
      payChoice.type === "cash" ? "cash" : "card"
    );
    await AsyncStorage.setItem("vura.ride.waypoints", JSON.stringify(waypoints));
    if (scheduleMode) {
      router.push("/ride/schedule");
    } else {
      router.push("/ride/track");
    }
  };

  const selectedTierName = tiers.find((t) => t.id === selected)?.name;

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Map */}
      <View className="relative h-[260px] bg-secondary">
        <MapView
          style={{ flex: 1 }}
          initialRegion={
            pickupCoord
              ? {
                latitude: pickupCoord[0],
                longitude: pickupCoord[1],
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }
              : undefined
          }
        >
          {pickupCoord && (
            <Marker
              coordinate={{ latitude: pickupCoord[0], longitude: pickupCoord[1] }}
              pinColor="#22c55e"
              title="Pickup"
            />
          )}
          {waypoints.map((wp, i) => (
            <Marker
              key={`stop-${i}`}
              coordinate={{ latitude: wp.lat, longitude: wp.lng }}
              image={CAR_LOCATOR_IMG}
              pinColor="#e04e2f"
              title={`Stop ${i + 1}`}
            />
          ))}
          {dropoffCoord && (
            <Marker
              coordinate={{ latitude: dropoffCoord[0], longitude: dropoffCoord[1] }}
              pinColor="#ef4444"
              title="Dropoff"
            />
          )}
          {nearbyCars.map((c) => (
            <Marker
              key={c.id}
              coordinate={{ latitude: c.lat, longitude: c.lng }}
              image={CAR_LOCATOR_IMG}
              rotation={(c.angle + 90) % 360}
              title="Nearby driver"
            />
          ))}
        </MapView>

        <TouchableOpacity
          onPress={() => router.push("/search")}
          className="absolute top-3 left-4 w-9 h-9 rounded-full bg-surface border border-border items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
        </TouchableOpacity>

        {totalKm != null && (
          <View className="absolute bottom-3 right-4 rounded-full bg-surface/90 border border-border px-3 py-1.5">
            <Text className="text-xs font-semibold text-foreground">
              {totalKm.toFixed(1)} km{waypoints.length > 0 ? ` · ${waypoints.length} stop${waypoints.length > 1 ? "s" : ""}` : ""}
            </Text>
          </View>
        )}
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

        <View className="mt-3 flex-row gap-2">
          <TouchableOpacity
            onPress={handleShowPayment}
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
          onPress={() => setScheduleMode(!scheduleMode)}
          className={`mt-2 flex-row items-center justify-center gap-2 rounded-xl py-3 px-3 ${scheduleMode ? "bg-primary/10 border border-primary" : "bg-secondary border border-border"}`}
        >
          <Ionicons
            name="calendar"
            size={16}
            color={scheduleMode ? "#e04e2f" : "#80716b"}
          />
          <Text
            className={`text-xs font-bold ${scheduleMode ? "text-primary" : "text-foreground"}`}
          >
            {scheduleMode ? "Schedule Later" : "Ride Now"}
          </Text>
        </TouchableOpacity>

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
        onRequestClose={handleHidePayment}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={handleHidePayment}
        >
          <TouchableOpacity activeOpacity={1} className="bg-surface rounded-t-[2rem] p-5">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-foreground">
                Select Payment
              </Text>
              <TouchableOpacity
                onPress={handleHidePayment}
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
                      handleHidePayment();
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
                    handleHidePayment();
                    router.push("/add-payment-method");
                  }}
                  className="w-full flex-row items-center gap-3 p-3 rounded-xl border border-border bg-surface"
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center bg-primary/10">
                    <Ionicons name="add-circle" size={20} color="#e04e2f" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-foreground">Add new card</Text>
                  </View>
                </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setPayChoice({ type: "cash" });
                  handleHidePayment();
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