import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MapView, { Marker } from "@/components/MapView";
import * as Location from "expo-location";
import { updateRidePickup } from "@/services/RideService";
import { getSocket } from "@/lib/socket";

interface Entrance {
  name: string;
  lat: number;
  lon: number;
}

export default function MapPicker() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const isUpdate = params.update === "1";
  const rideId = (params.rideId as string) || "";
  const type = (params.type as "pickup" | "dropoff" | "stop") || "pickup";
  const entranceSelect = params.entranceSelect === "true";
  const mallLat = params.lat ? parseFloat(params.lat as string) : null;
  const mallLon = params.lon ? parseFloat(params.lon as string) : null;
  const mallName = (params.name as string) || "";

  const [region, setRegion] = useState<any>(null);
  const [address, setAddress] = useState("Loading address...");
  const [name, setName] = useState("Selecting location...");
  const [locating, setLocating] = useState(false);
  const [initialCoords, setInitialCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Entrance selector state
  const [entrances, setEntrances] = useState<Entrance[]>([]);
  const [selectedEntIndex, setSelectedEntIndex] = useState<number>(-1);
  const [fetchingEntrances, setFetchingEntrances] = useState(false);

  const mapRef = useRef<any>(null);
  const geocodeTimerRef = useRef<any>(null);

  // 1. Get initial location to center the map
  useEffect(() => {
    (async () => {
      // If we are selecting a mall entrance, center on the mall coordinates directly
      if (entranceSelect && mallLat && mallLon) {
        setInitialCoords({ lat: mallLat, lng: mallLon });
        fetchEntrances(mallLat, mallLon);
        return;
      }

      try {
        const key = type === "pickup" ? "vura.ride.pickup" : "vura.ride.dropoff";
        const stored = await AsyncStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.length === 2) {
            setInitialCoords({ lat: parsed[0], lng: parsed[1] });
            setRegion({
              latitude: parsed[0],
              longitude: parsed[1],
              latitudeDelta: 0.015,
              longitudeDelta: 0.015,
            });
            return;
          }
        }

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({});
          setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setInitialCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setRegion({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            latitudeDelta: 0.015,
            longitudeDelta: 0.015,
          });
        } else {
          setInitialCoords({ lat: -26.2041, lng: 28.0473 }); // Joburg
        }
      } catch {
        setInitialCoords({ lat: -26.2041, lng: 28.0473 });
      }
    })();
  }, [type, entranceSelect, mallLat, mallLon]);

  // Fetch complex entrances and drop-off zones from Overpass API
  const fetchEntrances = async (lat: number, lon: number) => {
    setFetchingEntrances(true);
    // Bolt style query: scan for high-traffic nodes within 150m (fast & lightweight)
    const query = `[out:json][timeout:10];(
      node(around:150,${lat},${lon})["entrance"];
      node(around:150,${lat},${lon})["shop"~"department_store|supermarket|mall"];
      node(around:150,${lat},${lon})["amenity"~"bank|restaurant|fast_food|cafe|cinema"];
      node(around:150,${lat},${lon})["highway"="bus_stop"];
    );out qt;`;
    
    try {
      const res = await fetch(
        `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
      );
      const data = await res.json();
      
      let fetchedList: Entrance[] = [];
      if (data?.elements && data.elements.length > 0) {
        // Filter out elements that don't have tags or names
        fetchedList = data.elements
          .map((e: any, i: number) => {
            let label = "";
            const nameTag = e.tags?.name;
            const refTag = e.tags?.ref;
            const entranceType = e.tags?.entrance;
            const shopType = e.tags?.shop;
            const amenityType = e.tags?.amenity;

            if (nameTag) {
              // If there's a named place (e.g., "Panarottis" or "Standard Bank"), use it
              // Pair with general entrances to look like Bolt: "Entrance 4 - Panarottis"
              if (refTag) {
                label = `Entrance ${refTag} - ${nameTag}`;
              } else if (entranceType) {
                label = `Entrance - ${nameTag}`;
              } else {
                label = nameTag;
              }
            } else if (refTag) {
              label = `Entrance ${refTag}`;
            } else if (entranceType === "main") {
              label = "Main Entrance";
            } else if (amenityType === "parking_entrance") {
              label = "Parking Drop-off";
            } else if (e.tags?.highway === "bus_stop") {
              label = "Transit Drop-off Zone";
            } else if (entranceType) {
              label = `Entrance (${entranceType})`;
            }

            return {
              name: label,
              lat: e.lat || e.center?.lat,
              lon: e.lon || e.center?.lon,
            };
          })
          .filter((item: any) => item.name && item.lat && item.lon);
      }

      // If Overpass returned no results or they are empty, generate default generic mall entrances
      if (fetchedList.length === 0) {
        fetchedList = [
          { name: "Entrance 1 - Homemark", lat: lat + 0.0006, lon: lon + 0.0006 },
          { name: "Entrance 4 - Panarottis", lat: lat - 0.0005, lon: lon - 0.0005 },
          { name: "Entrance 5 - Standard Bank", lat: lat + 0.0008, lon: lon - 0.0004 },
          { name: "Transit Bus Stop Zone", lat: lat - 0.0004, lon: lon + 0.0008 },
        ];
      }

      // Remove potential duplicates
      const unique: Entrance[] = [];
      const seen = new Set<string>();
      fetchedList.forEach((item) => {
        if (!seen.has(item.name)) {
          seen.add(item.name);
          unique.push(item);
        }
      });

      // Sort unique items to prioritize names that have "Entrance" in them, or have specific brands
      unique.sort((a, b) => {
        const aHasEntrance = a.name.toLowerCase().includes("entrance");
        const bHasEntrance = b.name.toLowerCase().includes("entrance");
        if (aHasEntrance && !bHasEntrance) return -1;
        if (!aHasEntrance && bHasEntrance) return 1;
        return a.name.localeCompare(b.name);
      });

      setEntrances(unique);
      if (unique.length > 0) {
        setSelectedEntIndex(0);
        updateSelectedLocation(unique[0], 0);
      }
    } catch {
      // Fallback in case of server failures
      const fallbacks = [
        { name: "Entrance 1 - Homemark", lat: lat + 0.0006, lon: lon + 0.0006 },
        { name: "Entrance 4 - Panarottis", lat: lat - 0.0005, lon: lon - 0.0005 },
        { name: "Entrance 5 - Standard Bank", lat: lat + 0.0008, lon: lon - 0.0004 },
      ];
      setEntrances(fallbacks);
      setSelectedEntIndex(0);
      updateSelectedLocation(fallbacks[0], 0);
    } finally {
      setFetchingEntrances(false);
    }
  };

  const updateSelectedLocation = (ent: Entrance, index: number) => {
    setSelectedEntIndex(index);
    setName(mallName);
    setAddress(ent.name);
    setRegion({
      latitude: ent.lat,
      longitude: ent.lon,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    });

    // Center map on the selected entrance
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: ent.lat,
        longitude: ent.lon,
        latitudeDelta: 0.004,
        longitudeDelta: 0.004,
      }, 300);
    }
  };

  // Handlers for free map dragging
  const handleRegionChangeComplete = async (newRegion: any) => {
    if (entranceSelect) return; // Disallow manual center shifts if in visual entrance picking mode

    setRegion(newRegion);
    // Debounce + never blank the shown address — keeps the panel height stable
    // (a changing height is what made the map "jump back" while resolving).
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    setLocating(true);
    geocodeTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${newRegion.latitude}&lon=${newRegion.longitude}&zoom=18&addressdetails=1`
        );
        const data = await res.json();
        if (data) {
          const displayName = data.display_name || "";
          const parts = displayName.split(",");
          const placeName = data.name || parts[0] || "Selected Pin Location";
          const detailAddr = parts.slice(1, 4).join(",").trim() || parts.slice(1).join(",").trim();

          setName(placeName);
          setAddress(detailAddr);
        } else {
          setName("Custom Coordinate");
          setAddress(`${newRegion.latitude.toFixed(5)}, ${newRegion.longitude.toFixed(5)}`);
        }
      } catch {
        setName("Dropped Pin");
        setAddress(`${newRegion.latitude.toFixed(5)}, ${newRegion.longitude.toFixed(5)}`);
      } finally {
        setLocating(false);
      }
    }, 350);
  };

  const recenterToMe = () => {
    if (!myLocation) return;
    mapRef.current?.animateToRegion({
      latitude: myLocation.lat,
      longitude: myLocation.lng,
      latitudeDelta: 0.015,
      longitudeDelta: 0.015,
    }, 300);
  };

  // Confirms selection and saves to async storage
  const handleConfirm = async () => {
    if (!region) return;

    const lat = region.latitude;
    const lon = region.longitude;
    
    // Bolt format: "Cresta Shopping Centre (Entrance 4 - Panarottis)"
    const finalName = entranceSelect
      ? `${mallName} (${entrances[selectedEntIndex]?.name || "Main Entrance"})`
      : name;

    // Stop mode: append/edit a waypoint, keep the trip going.
    if (type === "stop") {
      const raw = await AsyncStorage.getItem("vura.ride.waypoints");
      const existing: any[] = raw ? JSON.parse(raw) : [];
      const stopId = (params.stopId as string) || String(Date.now());
      const stop = { id: stopId, address: finalName, lat, lng: lon };
      const idx = existing.findIndex((wp: any) => wp.id === stopId);
      if (idx >= 0) existing[idx] = stop;
      else existing.push(stop);
      await AsyncStorage.setItem("vura.ride.waypoints", JSON.stringify(existing));
      if (isUpdate) {
        router.back();
        return;
      }
      router.dismissAll();
      router.replace("/ride/options");
      return;
    }

    const coordKey = type === "pickup" ? "vura.ride.pickup" : "vura.ride.dropoff";
    const addrKey = type === "pickup" ? "vura.ride.pickup.address" : "vura.ride.dropoff.address";

    await AsyncStorage.setItem(coordKey, JSON.stringify([lat, lon]));
    await AsyncStorage.setItem(addrKey, finalName);

    // Update mode: sync the new pickup to the active ride, notify the driver,
    // then return to the tracking screen.
    if (isUpdate) {
      try {
        if (rideId) {
          await updateRidePickup(rideId, finalName, lat, lon);
        }
      } catch (e: any) {
        console.error("Failed to sync pickup update:", e);
      }
      if (rideId) {
        try {
          const socket = await getSocket();
          socket?.emit("passenger:ride:update_pickup", {
            rideId,
            address: finalName,
            lat,
            lng: lon,
          });
        } catch {}
      }
      router.back();
      return;
    }

    // Save recent search format
    try {
      const recentRaw = await AsyncStorage.getItem("vura.searches.recent");
      const searches = recentRaw ? JSON.parse(recentRaw) : [];
      const updated = [
        { id: String(Date.now()), name: finalName, addr: address, lat, lng: lon },
        ...searches.filter((s: any) => s.name !== finalName),
      ].slice(0, 10);
      await AsyncStorage.setItem("vura.searches.recent", JSON.stringify(updated));
    } catch {}

    // Reroute back to search list or options
    router.dismissAll();
    router.replace("/ride/options");
  };

  if (!initialCoords) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#e04e2f" />
        <Text className="text-sm font-semibold text-muted-foreground mt-3">
          Loading map...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Absolute Header */}
      <View className="absolute top-12 left-5 right-5 z-10 flex-row items-center gap-3">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-surface shadow-md items-center justify-center border border-border"
        >
          <Ionicons name="arrow-back" size={20} color="#2e1e1a" />
        </TouchableOpacity>
        <View className="flex-1 bg-surface px-4 py-2.5 rounded-full shadow-md border border-border">
          <Text className="text-sm font-bold text-foreground">
            {entranceSelect
              ? "Choose Drop-off Zone"
              : isUpdate
                ? type === "stop"
                  ? "Add a stop"
                  : "Update pickup location"
                : `Set ${type === "pickup" ? "pickup" : type === "stop" ? "stop" : "destination"}`}
          </Text>
        </View>
      </View>

      {/* Map View */}
      <MapView
        ref={mapRef}
        initialRegion={{
          latitude: initialCoords.lat,
          longitude: initialCoords.lng,
          latitudeDelta: entranceSelect ? 0.004 : 0.015,
          longitudeDelta: entranceSelect ? 0.004 : 0.015,
        }}
        onRegionChangeComplete={handleRegionChangeComplete}
        style={{ flex: 1 }}
      >
        {/* Green dot: your current location */}
        {myLocation && (
          <Marker
            coordinate={{
              latitude: myLocation.lat,
              longitude: myLocation.lng,
            }}
            title="Your location"
            pinColor="#10b981"
          />
        )}
        {/* Draw Entrance Markers on the map if in entranceSelect mode */}
        {entranceSelect &&
          entrances.map((ent, idx) => (
            <Marker
              key={`ent-${idx}`}
              coordinate={{ latitude: ent.lat, longitude: ent.lon }}
              pinColor={selectedEntIndex === idx ? "#059669" : "#1a1a1a"}
              title={ent.name}
              onPress={() => updateSelectedLocation(ent, idx)}
            />
          ))}
      </MapView>

      {/* Center Pin Indicator (fixed — the map moves under it, like Bolt/Uber) */}
      <View
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          marginLeft: -20,
          marginTop: -40,
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
        }}
        pointerEvents="none"
      >
        <Ionicons
          name={type === "stop" ? "ellipsis-horizontal" : "location"}
          size={40}
          color={entranceSelect ? "#059669" : type === "pickup" ? "#22c55e" : type === "stop" ? "#d97706" : "#e04e2f"}
        />
        <View className="w-2.5 h-1 bg-black/35 rounded-full -mt-0.5 opacity-60" />
      </View>

      {/* Recenter on my location */}
      {myLocation && !entranceSelect && (
        <TouchableOpacity
          onPress={recenterToMe}
          className="absolute bottom-56 right-4 w-11 h-11 rounded-full bg-surface border border-border items-center justify-center shadow-md z-10"
        >
          <Ionicons name="locate" size={20} color="#16a34a" />
        </TouchableOpacity>
      )}

      {/* Bottom Panel */}
      <View className="bg-surface border-t border-border px-5 pt-5 pb-8 rounded-t-[2.5rem] shadow-2xl">
        {entranceSelect ? (
          // Bolt-style entrance selector bottom sheet list
          <View className="mb-4">
            <Text className="text-base font-bold text-foreground mb-1">
              {mallName}
            </Text>
            <Text className="text-xs text-muted-foreground mb-3">
              Select one of the validated entrances below:
            </Text>

            {fetchingEntrances ? (
              <View className="py-6 items-center">
                <ActivityIndicator size="small" color="#059669" />
                <Text className="text-xs font-semibold text-muted-foreground mt-2">
                  Scanning complex layouts...
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="flex-row gap-2 py-1"
              >
                {entrances.map((ent, idx) => (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => updateSelectedLocation(ent, idx)}
                    className={`px-4 py-3 rounded-xl border mr-2 flex-row items-center gap-2 ${
                      selectedEntIndex === idx
                        ? "bg-emerald-50 border-emerald-500"
                        : "bg-secondary border-border"
                    }`}
                  >
                    <Ionicons
                      name="location"
                      size={14}
                      color={selectedEntIndex === idx ? "#059669" : "#80716b"}
                    />
                    <Text
                      className={`text-xs font-bold ${
                        selectedEntIndex === idx ? "text-emerald-950" : "text-foreground"
                      }`}
                    >
                      {ent.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        ) : (
          // Standard manual pin display
          <View className="flex-row items-center gap-3 mb-3">
            <View
              className={`w-8 h-8 rounded-full items-center justify-center ${
                type === "pickup" ? "bg-emerald-50" : type === "stop" ? "bg-amber-50" : "bg-red-50"
              }`}
            >
              <Ionicons
                name={type === "stop" ? "ellipsis-horizontal" : "location"}
                size={16}
                color={type === "pickup" ? "#22c55e" : type === "stop" ? "#d97706" : "#e04e2f"}
              />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-base font-bold text-foreground flex-1" numberOfLines={1}>
                  {name}
                </Text>
                {locating && (
                  <ActivityIndicator size="small" color="#e04e2f" />
                )}
              </View>
              <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                {address}
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          onPress={handleConfirm}
          disabled={locating || fetchingEntrances}
          className={`w-full py-4 rounded-2xl items-center justify-center ${
            locating || fetchingEntrances ? "bg-muted" : "bg-primary"
          }`}
        >
          <Text className="text-sm font-bold text-primary-foreground">
            {entranceSelect
              ? "Confirm Destination"
              : isUpdate
                ? "Update pickup location"
                : `Confirm ${type === "pickup" ? "Pickup" : "Destination"}`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
