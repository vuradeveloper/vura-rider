import { Link, useRouter } from "expo-router";
import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getRecentSearches, saveSearch, clearRecentSearches } from "@/services/SearchService";
import type { RecentSearch, Waypoint } from "@/lib/types";
import { haversineKm } from "@/lib/utils";

export default function Search() {
  const router = useRouter();
  const [activeInput, setActiveInput] = useState<"pickup" | "dropoff" | "stop">("dropoff");
  const [activeStopIndex, setActiveStopIndex] = useState<number | null>(null);
  const [pickup, setPickup] = useState("Locating...");
  const [dropoff, setDropoff] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [entranceModal, setEntranceModal] = useState<{
    s: any;
    type: "pickup" | "dropoff" | "stop";
  } | null>(null);
  const [realEntrances, setRealEntrances] = useState<string[]>([]);
  const [fetchingEntrances, setFetchingEntrances] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    getRecentSearches().then(setRecentSearches);
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setPickup("Current location");
        return;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({});
        setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        await AsyncStorage.setItem(
          "vura.ride.pickup",
          JSON.stringify([pos.coords.latitude, pos.coords.longitude])
        );
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`
        );
        const d = await res.json();
        if (d && d.display_name) {
          const label = d.display_name.split(",").slice(0, 2).join(", ");
          setPickup(label);
          await AsyncStorage.setItem("vura.ride.pickup.address", label);
        } else {
          setPickup("Current location");
        }
      } catch {
        setPickup("Current location");
      }
    })();
  }, []);

  const mergeResults = (nominatimData: any, photonData: any) => {
    const merged: any[] = [];
    const seenCoords = new Set<string>();

    if (Array.isArray(nominatimData)) {
      nominatimData.forEach((item: any) => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        const coordKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
        const parts = item.display_name.split(",");
        const name = parts[0] || "Selected Place";
        const addr = parts.slice(1, 4).join(",").trim();
        seenCoords.add(coordKey);
        merged.push({ name, addr, lat, lon });
      });
    }

    if (photonData?.features) {
      photonData.features.forEach((f: any) => {
        const lat = f.geometry.coordinates[1];
        const lon = f.geometry.coordinates[0];
        const coordKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
        if (!seenCoords.has(coordKey)) {
          seenCoords.add(coordKey);
          const name = f.properties.name || f.properties.street || f.properties.city || "Selected Location";
          const streetNum = f.properties.housenumber ? `${f.properties.housenumber} ` : "";
          const street = f.properties.street ? `${streetNum}${f.properties.street}` : "";
          const district = f.properties.district || "";
          const city = f.properties.city || "";
          const country = f.properties.country || "";
          const addr = [street, district, city, country].filter(Boolean).join(", ");
          merged.push({ name, addr, lat, lon });
        }
      });
    }
    return merged;
  };

  const fetchGeocoders = async (term: string, lat?: number, lon?: number, bounded = false) => {
    const box = 0.35; // ~40km box for the strict "near pickup" pass

    const photonUrl = bounded
      ? `https://photon.komoot.io/api/?q=${encodeURIComponent(term)}&limit=8&bbox=${lon! - box},${lat! - box},${lon! + box},${lat! + box}`
      : `https://photon.komoot.io/api/?q=${encodeURIComponent(term)}&limit=8${lat != null ? `&lat=${lat}&lon=${lon}` : ""}`;

    const nominatimUrl = bounded
      ? `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(term)}&format=json&limit=5&addressdetails=1&viewbox=${lon! - box},${lat! - box},${lon! + box},${lat! + box}&bounded=1`
      : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(term)}&format=json&limit=5&addressdetails=1${
          lat != null ? `&viewbox=${lon! - 0.15},${lat - 0.15},${lon! + 0.15},${lat + 0.15}&bounded=0` : ""
        }`;

    const photonPromise = fetch(photonUrl)
      .then((r) => r.json())
      .catch(() => ({ features: [] }));

    const nominatimPromise = fetch(nominatimUrl, {
      headers: { "User-Agent": "VuraRiderApp/1.0" },
    })
      .then((r) => r.json())
      .catch(() => []);

    const [photonData, nominatimData] = await Promise.all([photonPromise, nominatimPromise]);
    return mergeResults(nominatimData, photonData);
  };

  // Strictly-scoped second pass: re-query each candidate with results forced
  // inside a box around the pickup. Used ONLY when the first pass found nothing
  // close by, so far destinations (other cities/airports) still work.
  const boundedPass = async (terms: string[], lat: number, lon: number) => {
    for (const term of terms) {
      const res = await fetchGeocoders(term, lat, lon, true);
      if (res.length > 0) return res;
    }
    return [];
  };

  // Last-resort fallback: search the LIVE OpenStreetMap database (Overpass)
  // for named places near the pickup that the geocoders miss. Tries several
  // public mirrors so it also works on mobile.
  const overpassSearch = async (term: string, lat: number, lon: number) => {
    const mirrors = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ];
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pad = 0.06; // ~6km box
    const query = `[out:json][timeout:8];(nwr["name"~"${safe}",i](${lat - pad},${lon - pad},${lat + pad},${lon + pad}););out center 12;`;
    for (const base of mirrors) {
      try {
        const res = await fetch(`${base}?data=${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(9000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data?.elements?.length) {
          return data.elements
            .map((e: any) => {
              const t = e.tags || {};
              const eLat = e.lat ?? e.center?.lat;
              const eLon = e.lon ?? e.center?.lon;
              if (eLat == null || eLon == null) return null;
              return {
                name: t.name || term,
                addr: t["addr:city"] || "Nearby place on map",
                lat: eLat,
                lon: eLon,
              };
            })
            .filter(Boolean);
        }
      } catch {
        // try the next mirror
      }
    }
    return [];
  };

  useEffect(() => {
    let q = "";
    if (activeInput === "pickup") q = pickup;
    else if (activeInput === "dropoff") q = dropoff;
    else if (activeInput === "stop" && activeStopIndex !== null) q = waypoints[activeStopIndex]?.address || "";

    if (q === "Locating..." || q === "Current location" || q.length < 3) {
      setResults([]);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        let bias: { lat: number; lon: number } | null = null;
        const p = JSON.parse(
          (await AsyncStorage.getItem("vura.ride.pickup")) || "null"
        );
        if (p && p.length === 2) bias = { lat: p[0], lon: p[1] };

        const words = q.trim().split(/\s+/).filter((w) => w.length > 1);
        // Try the full phrase first, then progressively shorter names — so
        // "Horizon Heights Student Accommodation" also matches "Horizon Heights".
        const candidates = [
          q,
          words.slice(0, 2).join(" "),
          words.slice(0, 1).join(" "),
        ].filter((c) => c && c.length >= 3);

        let merged: any[] = [];
        const all: any[] = [];
        const seenAll = new Set<string>();
        for (const term of [...new Set(candidates)]) {
          const res = await fetchGeocoders(term, bias?.lat, bias?.lon);
          res.forEach((r: any) => {
            const k = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
            if (!seenAll.has(k)) {
              seenAll.add(k);
              all.push(r);
            }
          });
          // If this term found something close to the pickup, stop narrowing.
          // Otherwise keep trying shorter names so far-away lookalikes (e.g. a
          // UK "Student Accommodation") don't hide your local residence.
          if (
            bias
              ? res.some((r: any) => haversineKm(bias!.lat, bias!.lon, r.lat, r.lon) <= 50)
              : res.length > 0
          ) {
            break;
          }
        }
        merged = all;

        // Strictly-scoped second pass: if nothing close to the pickup was found,
        // re-query with results forced inside a box around it — this is what
        // stops "foreign lookalike" results hiding your local places. Far
        // destinations are unaffected because this only runs when there's no
        // nearby match.
        if (bias && !merged.some((r: any) => haversineKm(bias!.lat, bias!.lon, r.lat, r.lon) <= 50)) {
          const scoped = await boundedPass([...new Set(candidates)], bias.lat, bias.lon);
          if (scoped.length > 0) merged = scoped;
        }

        // Live-map fallback: search nearby OSM for named places the geocoders miss.
        if (merged.length === 0 && bias) {
          merged = await overpassSearch(words.slice(0, 2).join(" ") || q, bias.lat, bias.lon);
        }

        // Nearest first so local (e.g. South African) results surface on top.
        if (bias && merged.length > 0) {
          merged = [...merged].sort((a: any, b: any) => {
            const da = haversineKm(bias!.lat, bias!.lon, a.lat, a.lon);
            const db = haversineKm(bias!.lat, bias!.lon, b.lat, b.lon);
            return da - db;
          });
        }

        setResults(merged.slice(0, 9));
      } catch (err) {
        console.error("Autocomplete fetch error:", err);
      } finally {
        setLoading(false);
      }
    }, 450);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pickup, dropoff, activeInput, waypoints, activeStopIndex]);

  const handleSelect = (s: any) => {
    if (activeInput === "pickup" || activeInput === "stop") {
      proceedWithSelection(s, s.name);
      return;
    }
    const isMall =
      /mall|shopping|centre|center|square|plaza/i.test(s.name) ||
      /mall|shopping/i.test(s.addr);
    if (isMall && s.lat && s.lon) {
      router.push({
        pathname: "/ride/map-picker",
        params: {
          type: activeInput,
          entranceSelect: "true",
          lat: String(s.lat),
          lon: String(s.lon),
          name: s.name,
        },
      });
      return;
    }
    proceedWithSelection(s, s.name);
  };

  const proceedWithSelection = (s: any, displayName: string) => {
    if (
      activeInput === "pickup" ||
      (entranceModal && entranceModal.type === "pickup")
    ) {
      setPickup(displayName);
      AsyncStorage.setItem("vura.ride.pickup", JSON.stringify([s.lat, s.lon]));
      AsyncStorage.setItem("vura.ride.pickup.address", displayName);
      setActiveInput("dropoff");
      setEntranceModal(null);
      return;
    }
    if (activeInput === "stop") {
      if (activeStopIndex !== null) {
        setWaypoints((prev) => {
          const copy = [...prev];
          copy[activeStopIndex] = { address: displayName, lat: s.lat, lng: s.lon };
          return copy;
        });
        setActiveStopIndex(null);
      } else {
        setWaypoints((prev) => [...prev, { address: displayName, lat: s.lat, lng: s.lon }]);
      }
      setActiveInput("dropoff");
      setEntranceModal(null);
      return;
    }
    setDropoff(displayName);
    AsyncStorage.setItem("vura.ride.dropoff", JSON.stringify([s.lat, s.lon]));
    AsyncStorage.setItem("vura.ride.dropoff.address", displayName);
    saveSearch({ name: displayName, addr: s.addr || "", lat: s.lat, lng: s.lon });
    setEntranceModal(null);
    AsyncStorage.setItem("vura.ride.waypoints", JSON.stringify(waypoints));
    router.push("/ride/options");
  };

  const defaultSuggestions = [
    { name: "Heathrow Airport", addr: "Terminal 5, London TW6", lat: 51.47, lon: -0.4543 },
    { name: "Mall of Africa", addr: "Waterfall City, Midrand", lat: -26.0152, lon: 28.1065 },
    { name: "British Museum", addr: "Great Russell St, London", lat: 51.5194, lon: -0.127 },
    { name: "King's Cross Station", addr: "Euston Rd, London N1C", lat: 51.532, lon: -0.124 },
  ];

  const displayResults = results.length > 0
    ? results
    : recentSearches.length > 0
      ? recentSearches.slice(0, 2).map((s) => ({ name: s.name, addr: s.addr, lat: s.lat, lon: s.lng }))
      : defaultSuggestions;

  const addStopField = () => {
    if (waypoints.length < 5) {
      const newIndex = waypoints.length;
      setWaypoints((prev) => [...prev, { address: "", lat: 0, lng: 0 }]);
      setActiveInput("stop");
      setActiveStopIndex(newIndex);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header */}
      <View className="flex-row items-center gap-4 py-3 px-5 bg-surface border-b border-border">
        <TouchableOpacity onPress={() => router.replace("/")} className="w-8 h-8 items-center justify-center">
          <Ionicons name="close" size={24} color="#2e1e1a" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-foreground">
          Route
        </Text>
      </View>

      {/* Input container wrapper */}
      <View className="px-5 pt-4 pb-4 bg-surface border-b border-border">
        <View className="flex-row gap-3">
          {/* Left vertical decorator line */}
          <View className="items-center py-3 justify-between">
            <View className="w-4 h-4 rounded-full bg-blue-100 items-center justify-center">
              <View className="w-2 h-2 rounded-full bg-blue-600" />
            </View>
            <View className="w-0.5 flex-1 my-1 border-l-2 border-dashed border-[#80716b]/40" />
            {waypoints.map((_, i) => (
              <View key={i} className="items-center my-0.5">
                <View className="w-2 h-2 rounded-full bg-amber-500" />
                <View className="w-0.5 h-6 border-l-2 border-dashed border-[#80716b]/40" />
              </View>
            ))}
            <View className="w-4 h-4 bg-[#166534]/15 rounded-md items-center justify-center border border-[#166534]/30">
              <View className="w-2 h-2 bg-[#166534] rounded-sm" />
            </View>
          </View>

          {/* Fields area */}
          <View className="flex-1 gap-y-2.5">
            {/* Pickup Input + Add Stop button */}
            <View className="flex-row items-center gap-2">
              <View className={`flex-1 flex-row items-center rounded-xl px-3 py-1 ${activeInput === "pickup" ? "border-2 border-[#166534] bg-white shadow-sm" : "bg-[#f2f1ef] border border-transparent"}`}>
                <TextInput
                  value={pickup}
                  onFocus={() => setActiveInput("pickup")}
                  onChangeText={setPickup}
                  className="flex-1 py-2.5 text-sm font-medium text-foreground bg-transparent"
                />
              </View>
              {/* small + button aligned next to pickup field */}
              <TouchableOpacity
                onPress={addStopField}
                className="w-10 h-10 rounded-full bg-[#f2f1ef] items-center justify-center shadow-sm"
              >
                <Ionicons name="add" size={20} color="#2e1e1a" />
              </TouchableOpacity>
            </View>

            {/* Waypoints/Stops */}
            {waypoints.map((wp, i) => (
              <View key={i} className="flex-row items-center gap-2">
                <View className={`flex-1 flex-row items-center rounded-xl px-3 py-1 ${activeInput === "stop" && activeStopIndex === i ? "border-2 border-[#166534] bg-white shadow-sm" : "bg-[#f2f1ef] border border-transparent"}`}>
                  <TextInput
                    placeholder={`Stop ${i + 1}`}
                    placeholderTextColor="#80716b"
                    value={wp.address}
                    onFocus={() => {
                      setActiveInput("stop");
                      setActiveStopIndex(i);
                    }}
                    onChangeText={(t) => {
                      setWaypoints((prev) => {
                        const copy = [...prev];
                        copy[i] = { ...copy[i], address: t };
                        return copy;
                      });
                    }}
                    className="flex-1 py-2.5 text-sm font-medium text-foreground bg-transparent"
                  />
                </View>
                {/* Delete Stop button */}
                <TouchableOpacity
                  onPress={() => {
                    setWaypoints((prev) => prev.filter((_, j) => j !== i));
                    if (activeStopIndex === i) {
                      setActiveStopIndex(null);
                      setActiveInput("dropoff");
                    }
                  }}
                  className="w-10 h-10 rounded-full bg-red-50 border border-red-100 items-center justify-center"
                >
                  <Ionicons name="close" size={18} color="#dc2626" />
                </TouchableOpacity>
              </View>
            ))}

            {/* Dropoff Input + Swap button */}
            <View className="flex-row items-center gap-2">
              <View className={`flex-1 flex-row items-center rounded-xl px-3 py-1 ${activeInput === "dropoff" ? "border-2 border-[#166534] bg-white shadow-sm" : "bg-[#f2f1ef] border border-transparent"}`}>
                <Ionicons name="search" size={18} color="#2e1e1a" className="mr-2" />
                <TextInput
                  placeholder={waypoints.length > 0 ? "Final destination?" : "Where to?"}
                  placeholderTextColor="#80716b"
                  value={dropoff}
                  onFocus={() => setActiveInput("dropoff")}
                  onChangeText={setDropoff}
                  className="flex-1 py-2 text-sm font-medium text-foreground bg-transparent"
                />
                {dropoff.length > 0 && (
                  <TouchableOpacity onPress={() => setDropoff("")} className="p-1">
                    <Ionicons name="close-circle" size={16} color="#80716b" />
                  </TouchableOpacity>
                )}
                {/* Small Map Pin Icon inside the input */}
                <TouchableOpacity
                  onPress={() => router.push({ pathname: "/ride/map-picker", params: { type: activeInput } })}
                  className="ml-1 p-1 bg-secondary rounded-md"
                >
                  <Ionicons name="map" size={16} color="#166534" />
                </TouchableOpacity>
              </View>
              {/* Swap Icon */}
              <TouchableOpacity
                onPress={() => {
                  const temp = pickup;
                  setPickup(dropoff);
                  setDropoff(temp);
                }}
                className="w-10 h-10 rounded-full bg-[#f2f1ef] items-center justify-center shadow-sm"
              >
                <Ionicons name="swap-vertical" size={18} color="#2e1e1a" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      <ScrollView className="flex-1 px-5 py-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-xs font-bold text-muted-foreground uppercase">
            {results.length > 0 ? "Search Results" : activeInput === "stop" ? "Select a stop" : recentSearches.length > 0 ? "Recent Searches" : "Suggestions"}
          </Text>
          {results.length === 0 && recentSearches.length > 0 && activeInput !== "stop" && (
            <TouchableOpacity onPress={async () => { await clearRecentSearches(); setRecentSearches([]); }}>
              <Text className="text-xs font-semibold text-primary">Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Set Location on Map Option */}
        <TouchableOpacity
          onPress={() => router.push({ pathname: "/ride/map-picker", params: { type: activeInput } })}
          className="flex-row items-center gap-3 py-3.5 border-b border-border"
        >
          <View className="w-10 h-10 rounded-full bg-primary/10 items-center justify-center">
            <Ionicons name="map" size={18} color="#e04e2f" />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-bold text-foreground">
              Set location on map
            </Text>
            <Text className="text-xs text-muted-foreground">
              Drag the map to position a pin precisely
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#80716b" />
        </TouchableOpacity>

        {loading && (
          <ActivityIndicator size="small" color="#e04e2f" style={{ marginVertical: 16 }} />
        )}

        {displayResults.map((s, i) => {
          // Categorize icon
          let iconName: "airplane-outline" | "briefcase-outline" | "train-outline" | "school-outline" | "location-outline" | "time-outline" = "location-outline";
          const queryResultsActive = results.length > 0;
          if (!queryResultsActive) {
            iconName = "time-outline";
          } else {
            const nameLower = s.name.toLowerCase();
            if (nameLower.includes("airport")) {
              iconName = "airplane-outline";
            } else if (nameLower.includes("mall") || nameLower.includes("shopping") || nameLower.includes("centre") || nameLower.includes("center") || nameLower.includes("plaza")) {
              iconName = "briefcase-outline";
            } else if (nameLower.includes("station") || nameLower.includes("train") || nameLower.includes("metro") || nameLower.includes("gautrain")) {
              iconName = "train-outline";
            } else if (nameLower.includes("college") || nameLower.includes("school") || nameLower.includes("university")) {
              iconName = "school-outline";
            }
          }

          // Calculate distance
          let distText = "";
          if (gpsCoords && s.lat && s.lon) {
            const km = haversineKm(gpsCoords.lat, gpsCoords.lng, s.lat, s.lon);
            distText = `${km.toFixed(1)} km`;
          }

          return (
            <TouchableOpacity
              key={i}
              onPress={() => handleSelect(s)}
              className="flex-row items-center gap-4 py-3.5 border-b border-border bg-surface"
            >
              <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                <Ionicons
                  name={iconName}
                  size={20}
                  color="#80716b"
                />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                  {s.name}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                  {s.addr || "Johannesburg"}
                </Text>
              </View>
              {distText ? (
                <Text className="text-xs font-medium text-muted-foreground mr-1">
                  {distText}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}

        {/* Footer */}
        <Text className="text-[10px] text-center text-muted-foreground/60 mt-8 mb-6">
          © OpenStreetMap, GeoNames • Who's On First, OpenAddresses
        </Text>
      </ScrollView>

      {/* Entrance Modal */}
      <Modal
        visible={!!entranceModal}
        animationType="slide"
        transparent
        onRequestClose={() => setEntranceModal(null)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setEntranceModal(null)}
        >
          <View className="bg-surface rounded-t-[2rem] p-5 max-h-[80%]">
            <Text className="text-lg font-bold text-foreground">
              Choose an entrance
            </Text>
            <Text className="text-sm text-muted-foreground mb-4 mt-1">
              Select the most convenient point for{" "}
              {entranceModal?.s?.name}.
            </Text>

            {fetchingEntrances ? (
              <View className="py-8 items-center gap-y-3">
                <ActivityIndicator size="small" color="#e04e2f" />
                <Text className="text-xs font-semibold text-muted-foreground">
                  Scanning map for drop-off zones...
                </Text>
              </View>
            ) : (
              <ScrollView className="gap-y-2 max-h-64">
                {realEntrances.map((ent, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() =>
                      proceedWithSelection(
                        entranceModal!.s,
                        `${entranceModal!.s.name} (${ent})`
                      )
                    }
                    className="w-full flex-row items-center justify-between px-4 py-3.5 rounded-full border border-border bg-surface mb-2"
                  >
                    <Text className="text-sm font-semibold text-foreground">
                      {ent}
                    </Text>
                    <Ionicons name="location" size={16} color="#80716b" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity
              onPress={() => setEntranceModal(null)}
              className="mt-2 w-full py-3.5 rounded-full bg-secondary items-center"
            >
              <Text className="text-sm font-bold text-foreground">Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
