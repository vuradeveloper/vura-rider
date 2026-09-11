import MapView, { Marker } from "@/components/MapView";
import { useAuth } from "@/lib/auth";
import { fetchRoute } from "@/lib/route";
import { estimateEtaMins, haversineKm } from "@/lib/utils";
import { getNearbyDrivers } from "@/services/DriverService";
import { getRecentSearches } from "@/services/SearchService";
import { getScheduledRides } from "@/services/SchedulingService";
import type { RecentSearch, ScheduledRide } from "@/lib/types";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import * as Linking from "expo-linking";
import { Link, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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

function scheduleCountdown(scheduledAt: string): string {
  const diff = new Date(scheduledAt).getTime() - Date.now();
  if (diff <= 0) return "Now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "in <1m";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  return `in ${h}h ${String(mins % 60).padStart(2, "0")}m`;
}

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
  const [scheduledRides, setScheduledRides] = useState<ScheduledRide[]>([]);
  const [, setTick] = useState(0); // re-render each second for live countdown

  useEffect(() => {
    getRecentSearches().then(setRecentSearches);
  }, []);

  // Scheduled rides: load on mount + refresh every 30s so a ride that is about
  // to be auto-booked (flips to "searching" 15 min before pickup) shows up and
  // gains a "View ride" button automatically.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { rides } = await getScheduledRides();
        // Never render cancelled rides — the server drops them too, but filter
        // here so a just-cancelled ride leaves the home screen instantly.
        if (active) setScheduledRides((rides || []).filter((r) => r.status !== "cancelled" && r.status !== "completed"));
      } catch {
        // offline / not signed in — keep whatever we have
      }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // 1-second ticker so the scheduled pickup countdowns are real-time.
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
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
        {/* Where to? search — at the very top */}
        <View className="px-5 pt-4">
          <Link href="/search" asChild>
            <TouchableOpacity className="flex-row items-center gap-3 rounded-2xl bg-white border border-gray-100 px-4 py-4 shadow-sm">
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

        {/* Upcoming trips — only shown when there are none; scheduled rides get
            their own section below the map so this never duplicates them. */}
        {scheduledRides.length === 0 && (
          <View className="px-5 mt-4">
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
        )}

        {/* Recent searches */}
        {recentSearches.length > 0 && (
          <View className="px-5 mt-4">
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

        {/* Upcoming scheduled rides — live countdown to pickup */}
        {scheduledRides.length > 0 && (
          <View className="px-5 mt-6">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-sm font-bold text-foreground">
                Scheduled rides
              </Text>
              <Link href="/scheduled-rides" asChild>
                <TouchableOpacity>
                  <Text className="text-xs font-semibold text-primary">
                    See all
                  </Text>
                </TouchableOpacity>
              </Link>
            </View>
            <View className="gap-y-3">
              {scheduledRides.slice(0, 4).map((r) => {
                const live = ["accepted", "driver_arrived", "in_progress"].includes(r.status);
                const searching = r.status === "searching";
                return (
                  <TouchableOpacity
                    key={r.id}
                    onPress={() => {
                      if (r.status !== "scheduled") {
                        router.push({
                          pathname: "/ride/track",
                          params: { rideId: r.id, live: "1" },
                        });
                      } else {
                        router.push("/scheduled-rides");
                      }
                    }}
                    className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm active:opacity-80"
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center gap-1.5">
                        <View
                          className={`w-2 h-2 rounded-full ${
                            live
                              ? "bg-emerald-500"
                              : searching
                                ? "bg-blue-500"
                                : r.status === "scheduled"
                                  ? "bg-amber-500"
                                  : "bg-amber-500"
                          }`}
                        />
                        <Text className="text-xs font-bold text-foreground capitalize">
                          {live
                            ? r.status === "driver_arrived"
                              ? "Your driver has arrived"
                              : r.status === "in_progress"
                                ? "Trip in progress"
                                : "Your driver is on the way"
                            : searching
                              ? "Finding your driver"
                              : `Picks you up ${scheduleCountdown(r.scheduled_at)}`}
                        </Text>
                      </View>
                      {r.status !== "scheduled" && (
                        <View className="rounded-full bg-primary px-3 py-1">
                          <Text className="text-[10px] font-bold text-primary-foreground">
                            View ride
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-xs text-muted-foreground mb-2">
                      {new Date(r.scheduled_at).toLocaleString("en-ZA", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                    <View className="flex-row items-start gap-2 mb-1.5">
                      <View className="w-4 items-center pt-1">
                        <View className="w-2 h-2 rounded-full bg-foreground" />
                      </View>
                      <Text className="text-sm text-foreground flex-1" numberOfLines={1}>
                        {r.pickup_address}
                      </Text>
                    </View>
                    <View className="flex-row items-start gap-2">
                      <View className="w-4 items-center pt-0.5">
                        <View className="w-2 h-2 rounded-md bg-primary" />
                      </View>
                      <Text className="text-sm text-foreground flex-1" numberOfLines={1}>
                        {r.destination_address}
                      </Text>
                    </View>

                    {r.driver_name && (
                      <View className="mt-3 rounded-xl bg-secondary px-3 py-2.5 flex-row items-center gap-2">
                        <View className="w-7 h-7 rounded-full bg-primary items-center justify-center">
                          <Ionicons name="person" size={14} color="#fff" />
                        </View>
                        <View className="flex-1">
                          <Text className="text-xs font-bold text-foreground">
                            {r.driver_name}
                          </Text>
                          <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
                            {[
                              r.vehicle_color,
                              r.vehicle_make,
                              r.vehicle_model,
                            ]
                              .filter(Boolean)
                              .join(" ") || (r.license_plate ? "Private car" : "Vehicle")}
                            {r.license_plate ? ` · ${r.license_plate}` : ""}
                          </Text>
                        </View>
                        {r.driver_phone && (
                          <TouchableOpacity
                            onPress={() => Linking.openURL(`tel:${r.driver_phone}`)}
                            className="rounded-full bg-primary px-3 py-1.5"
                          >
                            <Text className="text-[10px] font-bold text-primary-foreground">
                              Call
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}