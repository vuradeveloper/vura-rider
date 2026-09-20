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
import { apiFetch } from "@/lib/api";

export default function Search() {
  const router = useRouter();
  const [activeInput, setActiveInput] = useState<"pickup" | "dropoff" | "stop">("dropoff");
  const [activeStopIndex, setActiveStopIndex] = useState<number | null>(null);
  const [pickup, setPickup] = useState("Locating...");
  const [dropoff, setDropoff] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [queryTerms, setQueryTerms] = useState<string[]>([]);
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
        const res = await apiFetch<{ name: string; address: string }>(
          `/api/search/reverse?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`
        ).catch(() => null);
        if (res?.address) {
          const label = res.address.split(",").slice(0, 2).join(", ");
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

  // WEGO-EXACT SEARCH: ONE autosuggest call with the raw query. HERE ranks the
  // results — we consume them in HERE's order (never re-sorted, never deduped).
  // The server proxies /api/search/geocode (HERE Autosuggest → OSM last-resort).
  const fetchGeocoders = async (
    term: string,
    lat?: number,
    lon?: number
  ): Promise<{ items: any[]; queryTerms: string[] }> => {
    try {
      const params = new URLSearchParams({ q: term });
      if (lat != null && lon != null) params.set("lat", String(lat));
      if (lon != null) params.set("lng", String(lon));
      params.set("limit", "10");
      const res = await apiFetch<{
        provider?: string;
        items?: any[];
        queryTerms?: string[];
      }>(`/api/search/geocode?${params.toString()}`);
      if (Array.isArray(res?.items)) {
        return {
          items: res.items.map((r: any) => ({
            name: r.name,
            addr: r.address || "",
            lat: Number(r.lat),
            lon: Number(r.lng),
            resultType: r.resultType || "place",
            distance: r.distance, // straight-line metres from `at` (WeGo badge)
            categories: r.categories || [],
            primaryCategory: r.primaryCategory || "",
            highlights: r.highlights,
            href: r.href,
            id: r.id,
          })),
          queryTerms: Array.isArray(res?.queryTerms) ? res.queryTerms : [],
        };
      }
    } catch {
      // fall through to OSM below
    }

    // FALLBACK: OSM + Photon (only used when the server/HERE truly returned nothing).
    const box = 0.35; // ~40km box for the strict "near pickup" pass
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(term)}&limit=8${lat != null ? `&lat=${lat}&lon=${lon}` : ""}`;
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(term)}&format=json&limit=5&addressdetails=1${
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
    const merged = mergeResults(nominatimData, photonData);
    return {
      items: merged.map((r: any) => ({
        name: r.name,
        addr: r.addr || "",
        lat: Number(r.lat),
        lon: Number(r.lon),
        resultType: "place",
        distance: undefined,
        categories: [],
        primaryCategory: "",
        highlights: null,
        href: undefined,
        id: undefined,
      })),
      queryTerms: [],
    };
  };

  // WeGo follow-up: tapping a "restaurants" / "Starbucks"-style suggestion row
  // runs a Discover search (exactly what WeGo does with the item's `href`).
  const followUpSearch = async (s: any) => {
    setLoading(true);
    try {
      let bias: { lat: number; lon: number } | null = null;
      const p = JSON.parse(
        (await AsyncStorage.getItem("vura.ride.pickup")) || "null"
      );
      if (p && p.length === 2) bias = { lat: p[0], lon: p[1] };
      const params = new URLSearchParams({ q: s.name || s.href || "" });
      if (bias) {
        params.set("lat", String(bias.lat));
        params.set("lng", String(bias.lon));
      }
      params.set("limit", "12");
      const res = await apiFetch<{ items?: any[] }>(
        `/api/search/discover?${params.toString()}`
      );
      const items = (res?.items || []).map((r: any) => ({
        name: r.name,
        addr: r.address || "",
        lat: Number(r.lat),
        lon: Number(r.lng),
        resultType: r.resultType || "place",
        distance: r.distance,
        categories: r.categories || [],
        primaryCategory: r.primaryCategory || "",
        highlights: r.highlights,
        href: r.href,
        id: r.id,
      }));
      setResults(items.slice(0, 10));
      setQueryTerms([]);
    } catch (err) {
      console.error("Follow-up search error:", err);
    } finally {
      setLoading(false);
    }
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
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        try {
          const res = await fetch(`${base}?data=${encodeURIComponent(query)}`, {
            signal: controller.signal,
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
        } finally {
          clearTimeout(timer);
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

        // ── WEGO-EXACT: ONE autosuggest call with the raw query ──
        // HERE ranks the results by relevance (respecting the `at` bias); we
        // show them in HERE's exact order. No candidate re-queries, no
        // community pinning, no coordinate-dedup, no radius trimming.
        const fetched = await fetchGeocoders(q, bias?.lat, bias?.lon);
        let list = fetched.items || [];

        // Silent last-resort: only if HERE (and its OSM proxy) truly returned
        // nothing do we hit the live OpenStreetMap database around the pickup.
        if (list.length === 0 && bias) {
          const words = q.trim().split(/\s+/).filter((w) => w.length > 1);
          const ov = await overpassSearch(
            words.slice(0, 2).join(" ") || q,
            bias.lat,
            bias.lon
          );
          if (ov.length > 0) {
            list = ov.map((r: any) => ({
              name: r.name,
              addr: r.addr || "",
              lat: Number(r.lat),
              lon: Number(r.lon),
              resultType: "place",
              distance: undefined,
              categories: [],
              primaryCategory: "",
              highlights: null,
              href: undefined,
              id: undefined,
            }));
          }
        }

        setResults(list.slice(0, 10));
        setQueryTerms(fetched.queryTerms || []);
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
    // WeGo follow-up rows: "restaurants" / "Starbucks" style suggestions don't
    // have a coordinate — tapping one runs a Discover search via the server.
    if (
      s.resultType === "categoryQuery" ||
      s.resultType === "chainQuery" ||
      (s.href && !Number.isFinite(Number(s.lat)))
    ) {
      followUpSearch(s);
      return;
    }
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

  const activeQueryText =
    activeInput === "pickup"
      ? pickup
      : activeInput === "stop" && activeStopIndex !== null
        ? waypoints[activeStopIndex]?.address || ""
        : dropoff;

  // Show the "drop a pin + name it" option whenever the rider is typing a
  // location (>=2 chars) — EVEN if matches exist below. Many buildings aren't
  // on OSM, so this option must never disappear once results appear.
  const isDropPinSuggest = !loading && activeQueryText.trim().length >= 2;

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
          onPress={() => router.push({ pathname: "/ride/map-picker", params: { type: activeInput, dropPin: "1" } })}
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

        {isDropPinSuggest && (
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/ride/map-picker", params: { type: activeInput, dropPin: "1", suggestName: activeQueryText.trim() } })}
            className="flex-row items-center gap-3 py-3.5 border-b border-border"
          >
            <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
              <Ionicons name="location-outline" size={18} color="#166534" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-foreground">
                Can't find it? Drop a pin + name it
              </Text>
              <Text className="text-xs text-muted-foreground">
                "Horizon Heights" not showing? Place the pin, name it — it's saved for everyone
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#80716b" />
          </TouchableOpacity>
        )}

        {loading && (
          <ActivityIndicator size="small" color="#e04e2f" style={{ marginVertical: 16 }} />
        )}

        {queryTerms.length > 0 && (
          <View className="flex-row flex-wrap gap-2 px-1 pt-1">
            {queryTerms.slice(0, 5).map((term, qi) => (
              <TouchableOpacity
                key={qi}
                onPress={() => {
                  // WeGo fills in the last word from the queryTerms list.
                  const existing = activeQueryText.trim();
                  const lastSpace = existing.lastIndexOf(" ");
                  const filled = lastSpace >= 0
                    ? existing.slice(0, lastSpace + 1) + term
                    : term;
                  if (activeInput === "pickup") setPickup(filled);
                  else if (activeInput === "stop" && activeStopIndex !== null) {
                    const copy = [...waypoints];
                    copy[activeStopIndex] = { ...copy[activeStopIndex], address: filled };
                    setWaypoints(copy);
                  } else setDropoff(filled);
                }}
                className="px-3 py-1.5 rounded-full bg-secondary/80 banner"
              >
                <Text className="text-xs font-medium text-foreground">
                  {term}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {displayResults.map((s, i) => {
          const isFollowUp =
            s.resultType === "categoryQuery" ||
            s.resultType === "chainQuery" ||
            (s.href && !Number.isFinite(Number(s.lat)));

          // Categorize icon (WeGo shows a type icon per result).
          let iconName: "airplane-outline" | "briefcase-outline" | "train-outline" | "school-outline" | "location-outline" | "time-outline" | "search" = "location-outline";
          const queryResultsActive = results.length > 0;
          if (queryResultsActive) {
            if (isFollowUp) {
              iconName = "search";
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
          } else {
            iconName = "time-outline";
          }

          // Distance badge — straight-line metres from HERE's `at` when present,
          // otherwise fall back to a client haversine from the GPS fix.
          let distText = "";
          if (Number.isFinite(Number(s.distance))) {
            const km = Number(s.distance) / 1000;
            distText = km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
          } else if (gpsCoords && s.lat && s.lon) {
            const km = haversineKm(gpsCoords.lat, gpsCoords.lng, s.lat, s.lon);
            distText = km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
          }

          // WeGo-style primary line: the title with the matched part **bold**
          // (set of [start,end) ranges from HERE `highlights.title`).
          const title = String(s.name || "");
          const titleHl = Array.isArray(s.highlights?.title) ? s.highlights.title : [];
          const titleParts: { text: string; bold: boolean }[] = [];
          let cursor = 0;
          titleHl
            .filter((r: any) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
            .sort((a: any, b: any) => a.start - b.start)
            .forEach((r: any) => {
              const st = Math.max(0, Math.min(title.length, Number(r.start)));
              const en = Math.max(st, Math.min(title.length, Number(r.end)));
              if (st > cursor) titleParts.push({ text: title.slice(cursor, st), bold: false });
              if (en > st) titleParts.push({ text: title.slice(st, en), bold: true });
              cursor = Math.max(cursor, en);
            });
          if (cursor < title.length) titleParts.push({ text: title.slice(cursor), bold: false });
          if (titleParts.length === 0) titleParts.push({ text: title, bold: false });

          // Subtitle: WeGo shows the full address label (or the category/chain for follow-ups).
          const subtitle = isFollowUp
            ? (s.resultType === "chainQuery" ? "Chain" : "Category") + " • tap to search"
            : s.addr || "";

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
                  {titleParts.map((p, pi) => (
                    <Text key={pi} className={p.bold ? "font-bold" : ""}>
                      {p.text}
                    </Text>
                  ))}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                  {subtitle}
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
          © HERE Maps • Powered by the same search engine as HERE WeGo
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
