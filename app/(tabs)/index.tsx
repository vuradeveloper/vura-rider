import MapView, { Marker } from "@/components/MapView";
import { useAuth } from "@/lib/auth";
import { estimateEtaMins, haversineKm } from "@/lib/utils";
import { getNearbyDrivers } from "@/services/DriverService";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({});
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        // ignore
      }
    })();
  }, []);

  const nearbyQuery = useQuery({
    queryKey: ["nearby-drivers", coords?.lat, coords?.lng],
    queryFn: () => getNearbyDrivers(coords!.lat, coords!.lng),
    enabled: !!coords && user?.role !== "driver",
    refetchInterval: 20000,
  });

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

        {/* Saved places */}
        <View className="px-5 mt-6">
          <Text className="text-sm font-bold text-foreground mb-3">
            Saved places
          </Text>
          <View className="gap-y-2">
            {[
              { icon: "home" as const, label: "Home", sub: "221B Baker St, London" },
              { icon: "briefcase" as const, label: "Work", sub: "Canary Wharf, London" },
            ].map((p) => (
              <Link key={p.label} href="/search" asChild>
                <TouchableOpacity className="flex-row items-center gap-3 rounded-xl bg-surface border border-border px-3.5 py-3">
                  <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                    <Ionicons name={p.icon} size={16} color="#2e1e1a" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      {p.label}
                    </Text>
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {p.sub}
                    </Text>
                  </View>
                </TouchableOpacity>
              </Link>
            ))}
          </View>
        </View>

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
                  title="Your Location"
                />
                {nearbyQuery.data?.drivers?.map((d: any) =>
                  d.current_lat != null && d.current_lng != null ? (
                    <Marker
                      key={d.id}
                      coordinate={{
                        latitude: d.current_lat,
                        longitude: d.current_lng,
                      }}
                      title="Nearby Driver"
                    />
                  ) : null
                )}
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
            <Link href="/search" asChild>
              <TouchableOpacity className="rounded-full bg-primary px-4 py-2">
                <Text className="text-xs font-bold text-primary-foreground">
                  Book now
                </Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>

        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}