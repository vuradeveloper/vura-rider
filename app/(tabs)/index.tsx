import MapView, { Marker } from "@/components/MapView";
import { useAuth } from "@/lib/auth";
import { fetchRoute } from "@/lib/route";
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

// CarLocator is baked into the bundle as a data URL at build time so the map
// always shows it in release builds (runtime asset → base64 resolution can
// silently fail in production APKs).
import { CAR_LOCATOR_DATA_URL } from "@/lib/carIcon";
const CAR_ICON = CAR_LOCATOR_DATA_URL;

type RoamingCar = {
  id: number;
  lat: number;
  lng: number;
  route: { latitude: number; longitude: number }[];
  step: number;
};

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
      const routes = await Promise.all(
        [0, 1, 2, 3, 4].map(async (i) => {
          const startLat = coords.lat + (Math.random() - 0.5) * 0.02;
          const startLng = coords.lng + (Math.random() - 0.5) * 0.02;
          const endLat = startLat + (Math.random() - 0.5) * 0.025;
          const endLng = startLng + (Math.random() - 0.5) * 0.025;
          const route = await fetchRoute([startLat, startLng], [endLat, endLng]);
          // Always render the car even if OSRM failed — fall back to a short
          // straight "drive" so the map never looks empty.
          const finalRoute =
            route.length > 0
              ? route
              : [
                  { latitude: startLat, longitude: startLng },
                  { latitude: endLat, longitude: endLng },
                ];
          return { id: i, lat: startLat, lng: startLng, route: finalRoute, step: 0 };
        })
      );
      if (mounted) {
        setRoamingCars(routes);
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

  // Fit the map nicely around the rider + all roaming cars, like the
  // Activities page which zooms to fit the whole trip route.
  const mapRegion = (() => {
    if (!coords) return null;
    const pts = [
      { lat: coords.lat, lng: coords.lng },
      ...roamingCars.map((c) => ({ lat: c.lat, lng: c.lng })),
    ];
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of pts) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.03),
      longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.03),
    };
  })();

  const driverCount = nearbyQuery.data?.drivers?.length ?? 0;

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

        {/* Upcoming trips card */}
        <View className="px-5 -mt-4">
          <View className="bg-white border border-gray-100/80 rounded-2xl p-4.5 flex-row items-center justify-between shadow-sm">
            <View className="flex-1">
              <Text className="text-base font-extrabold text-foreground">
                You have no upcoming trips
              </Text>
              <Link href="/search" asChild>
                <TouchableOpacity className="flex-row items-center mt-1">
                  <Text className="text-xs font-bold text-muted-foreground">
                    Reserve your trip
                  </Text>
                  <Ionicons name="arrow-forward" size={13} color="#80716b" className="ml-1" />
                </TouchableOpacity>
              </Link>
            </View>
            <View className="w-12 h-12 bg-gray-50 rounded-xl items-center justify-center border border-gray-100">
              <Ionicons name="calendar-outline" size={24} color="#dc2626" />
            </View>
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

        {/* Map preview — styled like the Activities page's featured card */}
        <View className="mx-5 mt-6 bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          {/* This inner View has NO overflow-hidden of its own — clipping a
              WebView's direct ancestor with overflow+borderRadius is a known
              cause of a blank/white WebView on Android. The outer card above
              still clips the corners of the whole card (map + footer). */}
          <View style={{ height: 460 }}>
            {coords && mapRegion ? (
              <MapView
                style={{ flex: 1 }}
                initialRegion={mapRegion}
              >
                <Marker
                  coordinate={{ latitude: coords.lat, longitude: coords.lng }}
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
          <View className="p-4">
            <Text className="text-lg font-bold text-foreground">
              Nearby drivers
            </Text>
            <Text className="text-xs text-muted-foreground mt-0.5">
              {driverCount > 0
                ? `${driverCount} drivers around you • ${nearestLabel}`
                : nearestLabel}
            </Text>
            <View className="flex-row gap-2 mt-4">
              <Link href="/search" asChild>
                <TouchableOpacity className="flex-row items-center gap-1.5 rounded-full bg-secondary px-4 py-2">
                  <Ionicons name="search" size={15} color="#2e1e1a" />
                  <Text className="text-xs font-bold text-foreground">Book now</Text>
                </TouchableOpacity>
              </Link>
              <Link href="/scheduled-rides" asChild>
                <TouchableOpacity className="flex-row items-center gap-1.5 rounded-full bg-secondary px-4 py-2">
                  <Ionicons name="calendar-outline" size={15} color="#2e1e1a" />
                  <Text className="text-xs font-bold text-foreground">Scheduled</Text>
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