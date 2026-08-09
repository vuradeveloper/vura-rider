import MapView, { Marker } from "@/components/MapView";
import { useAuth } from "@/lib/auth";
import { estimateEtaMins, haversineKm } from "@/lib/utils";
import { getNearbyDrivers } from "@/services/DriverService";
import { getRecentSearches } from "@/services/SearchService";
import type { RecentSearch } from "@/lib/types";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Link, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// This file lives at app/(tabs)/index.tsx, and the asset lives at
// assets/images/CarLocator.png (project root) — two levels up.
const CAR_ICON = require("../../assets/images/CarLocator.png");

type RoamingCar = {
  id: number;
  lat: number;
  lng: number;
  route: { latitude: number; longitude: number }[];
  step: number;
};

// Same OSRM lookup used in DriverHome.tsx — makes each roaming car wander
// along an actual road path instead of teleporting or jittering randomly.
async function fetchRoute(start: [number, number], end: [number, number]) {
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?geometries=geojson&overview=full`
    );
    const data = await res.json();
    if (data.routes?.[0]) {
      return data.routes[0].geometry.coordinates.map((c: any) => ({
        latitude: c[1],
        longitude: c[0],
      }));
    }
  } catch (e) { }
  return [];
}

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [roamingCars, setRoamingCars] = useState<RoamingCar[]>([]);
  const roamingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  useEffect(() => {
    getRecentSearches().then(setRecentSearches);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") {
          // getForegroundPermissionsAsync only *checks* status — it never
          // prompts the user. If permission was never asked before, status
          // is "undetermined" here, and without this request call, coords
          // would silently stay null forever.
          ({ status } = await Location.requestForegroundPermissionsAsync());
        }
        if (status !== "granted") {
          console.log("[Home] Location permission not granted:", status);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({});
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (e) {
        console.log("[Home] Location error:", e);
      }
    })();
  }, []);

  const nearbyQuery = useQuery({
    queryKey: ["nearby-drivers", coords?.lat, coords?.lng],
    queryFn: () => getNearbyDrivers(coords!.lat, coords!.lng),
    enabled: !!coords && user?.role !== "driver",
    refetchInterval: 20000,
  });

  // Generate 5 roaming demo cars around the rider's real location — same
  // generation loop as DriverHome.tsx's roamingCars, just centered on
  // `coords` instead of the hardcoded JOBURG constant, and 5 instead of 4.
  useEffect(() => {
    if (!coords) return;
    let mounted = true;
    (async () => {
      const cars: RoamingCar[] = [];
      for (let i = 0; i < 5; i++) {
        const startLat = coords.lat + (Math.random() - 0.5) * 0.02;
        const startLng = coords.lng + (Math.random() - 0.5) * 0.02;
        const endLat = startLat + (Math.random() - 0.5) * 0.025;
        const endLng = startLng + (Math.random() - 0.5) * 0.025;
        const route = await fetchRoute([startLat, startLng], [endLat, endLng]);
        if (mounted && route.length > 0) {
          cars.push({ id: i, lat: startLat, lng: startLng, route, step: 0 });
        }
      }
      if (mounted && cars.length > 0) {
        setRoamingCars(cars);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [coords]);

  // Step every roaming car along its route every 2s — identical timing to
  // DriverHome.tsx's roaming cars.
  useEffect(() => {
    if (roamingCars.length === 0) return;
    roamingRef.current = setInterval(() => {
      setRoamingCars((prev) =>
        prev.map((car) => {
          if (car.route.length > 0 && car.step < car.route.length - 1) {
            const next = car.route[car.step + 1];
            return { ...car, step: car.step + 1, lat: next.latitude, lng: next.longitude };
          }
          return car;
        })
      );
    }, 2000);
    return () => {
      if (roamingRef.current) clearInterval(roamingRef.current);
    };
  }, [roamingCars.length]);

  const nearestEta = (() => {
    const drivers = nearbyQuery.data?.drivers ?? [];
    if (!coords || drivers.length === 0) return null;
    let best = Infinity;
    for (const d of drivers) {
      if (d.current_lat == null || d.current_lng == null) continue;
      const km = haversineKm(coords.lat, coords.lng, d.current_lat, d.current_lng);
      if (km < best) best = km;
    }
    if (best === Infinity) return null;
    return estimateEtaMins(best);
  })();

  const nearestLabel = nearbyQuery.isLoading
    ? "Checking…"
    : nearestEta != null
      ? `${nearestEta} min away`
      : "No drivers nearby";

  if (loading || !user) return null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Hero greeting */}
        <View className="bg-primary px-5 pt-4 pb-10 rounded-b-[2rem] relative overflow-hidden">
          <View className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <View className="absolute right-12 top-20 h-24 w-24 rounded-full bg-white/10" />
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs text-white/80">Good morning,</Text>
              <Text className="text-2xl font-bold text-white">
                {user.name}
              </Text>
            </View>
            <TouchableOpacity className="w-10 h-10 rounded-full bg-white/15 items-center justify-center">
              <Ionicons name="notifications" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          <Link href="/search" asChild>
            <TouchableOpacity className="mt-6 flex-row items-center gap-3 rounded-2xl bg-surface px-4 py-3.5">
              <Ionicons name="search" size={20} color="#e04e2f" />
              <Text className="text-sm font-medium text-muted-foreground flex-1">
                Where to?
              </Text>
              <View className="flex-row items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1">
                <Ionicons name="time" size={12} color="#80716b" />
                <Text className="text-xs font-semibold text-foreground">
                  Now
                </Text>
              </View>
            </TouchableOpacity>
          </Link>
        </View>

        {/* Quick services */}
        <View className="px-5 -mt-4">
          <View className="flex-row justify-between rounded-2xl bg-surface border border-border p-4">
            {[
              { icon: "car" as const, label: "Ride", to: "/search" },
              { icon: "restaurant" as const, label: "Eats", to: "/services" },
              { icon: "cube" as const, label: "Package", to: "/services" },
              { icon: "briefcase" as const, label: "Business", to: "/services" },
            ].map(({ icon, label, to }) => (
              <Link key={label} href={to as any} asChild>
                <TouchableOpacity className="items-center gap-2">
                  <View className="w-12 h-12 rounded-xl bg-accent items-center justify-center">
                    <Ionicons name={icon} size={20} color="#e04e2f" />
                  </View>
                  <Text className="text-[11px] font-semibold text-foreground">
                    {label}
                  </Text>
                </TouchableOpacity>
              </Link>
            ))}
          </View>
        </View>

        {/* Recent searches */}
        {recentSearches.length > 0 && (
          <View className="px-5 mt-6">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-sm font-bold text-foreground">
                Recent searches
              </Text>
              <Link href="/search" asChild>
                <TouchableOpacity>
                  <Text className="text-xs font-semibold text-primary">See all</Text>
                </TouchableOpacity>
              </Link>
            </View>
            <View className="gap-y-2">
              {recentSearches.slice(0, 2).map((s) => (
                <Link key={s.id} href="/search" asChild>
                  <TouchableOpacity className="flex-row items-center gap-3 rounded-xl bg-surface border border-border px-3.5 py-3">
                    <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                      <Ionicons name="time" size={16} color="#2e1e1a" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                        {s.addr}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </Link>
              ))}
            </View>
          </View>
        )}

        {/* Map preview */}
        <View className="mx-5 mt-6 rounded-2xl border border-border overflow-hidden">
          {/* This inner View has NO overflow-hidden of its own — clipping a
              WebView's direct ancestor with overflow+borderRadius is a known
              cause of a blank/white WebView on Android. The outer card above
              still clips the corners of the whole card (map + footer). */}
          <View style={{ height: 180 }}>
            {coords ? (
              <MapView
                style={{ flex: 1 }}
                initialRegion={{
                  latitude: coords.lat,
                  longitude: coords.lng,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }}
              >
                <Marker
                  coordinate={{ latitude: coords.lat, longitude: coords.lng }}
                  image={CAR_ICON}
                  title="Your Location"
                />
                {roamingCars.map((car) => (
                  <Marker
                    key={`car-${car.id}`}
                    coordinate={{ latitude: car.lat, longitude: car.lng }}
                    image={CAR_ICON}
                    title="Nearby driver"
                  />
                ))}
              </MapView>
            ) : (
              <View className="flex-1 bg-secondary items-center justify-center">
                <Ionicons name="map" size={48} color="#80716b" />
                <Text className="text-xs text-muted-foreground mt-2">
                  Waiting for location…
                </Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center justify-between px-4 py-3 bg-surface">
            <View>
              <Text className="text-xs text-muted-foreground">Nearest driver</Text>
              <Text className="text-sm font-bold text-foreground">
                {nearestLabel}
              </Text>
            </View>
            <View className="flex-row gap-2">
              <Link href="/search" asChild>
                <TouchableOpacity className="rounded-full bg-primary px-4 py-2">
                  <Text className="text-xs font-bold text-primary-foreground">
                    Book now
                  </Text>
                </TouchableOpacity>
              </Link>
              <Link href="/scheduled-rides" asChild>
                <TouchableOpacity className="rounded-full bg-secondary border border-border px-4 py-2">
                  <Text className="text-xs font-bold text-foreground">
                    Scheduled
                  </Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        </View>

        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}