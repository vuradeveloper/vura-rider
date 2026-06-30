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

export default function Search() {
  const router = useRouter();
  const [activeInput, setActiveInput] = useState<"pickup" | "dropoff">("dropoff");
  const [pickup, setPickup] = useState("Locating...");
  const [dropoff, setDropoff] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [entranceModal, setEntranceModal] = useState<{
    s: any;
    type: "pickup" | "dropoff";
  } | null>(null);
  const [realEntrances, setRealEntrances] = useState<string[]>([]);
  const [fetchingEntrances, setFetchingEntrances] = useState(false);
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setPickup("Current location");
        return;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({});
        await AsyncStorage.setItem(
          "vura.ride.pickup",
          JSON.stringify([pos.coords.latitude, pos.coords.longitude])
        );
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`
        );
        const d = await res.json();
        if (d && d.display_name) {
          setPickup(d.display_name.split(",").slice(0, 2).join(", "));
        } else {
          setPickup("Current location");
        }
      } catch {
        setPickup("Current location");
      }
    })();
  }, []);

  useEffect(() => {
    const q = activeInput === "pickup" ? pickup : dropoff;
    if (q === "Locating..." || q === "Current location" || q.length < 3) {
      setResults([]);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        let locBias = "";
        const p = JSON.parse(
          (await AsyncStorage.getItem("vura.ride.pickup")) || "null"
        );
        if (p && p.length === 2) locBias = `&lat=${p[0]}&lon=${p[1]}`;
        const res = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6${locBias}`
        );
        const data = await res.json();
        if (data.features) {
          setResults(
            data.features.map((f: any) => ({
              name: f.properties.name || f.properties.street || f.properties.city,
              addr: [
                f.properties.street,
                f.properties.district,
                f.properties.city,
                f.properties.state,
                f.properties.country,
              ]
                .filter(Boolean)
                .join(", "),
              lat: f.geometry.coordinates[1],
              lon: f.geometry.coordinates[0],
            }))
          );
        }
      } catch {}
      setLoading(false);
    }, 600);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pickup, dropoff, activeInput]);

  const handleSelect = (s: any) => {
    const isMall =
      /mall|shopping|centre|center|square|plaza/i.test(s.name) ||
      /mall|shopping/i.test(s.addr);
    if (isMall) {
      setEntranceModal({ s, type: activeInput });
      setFetchingEntrances(true);
      setRealEntrances([]);
      const query = `[out:json];(node(around:200,${s.lat},${s.lon})["entrance"];node(around:200,${s.lat},${s.lon})["highway"="bus_stop"];node(around:200,${s.lat},${s.lon})["amenity"="parking_entrance"];);out;`;
      fetch(
        `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
      )
        .then((r) => r.json())
        .then((data) => {
          if (data.elements && data.elements.length > 0) {
            const entrances = data.elements.map((e: any, i: number) => {
              if (e.tags?.name) return e.tags.name;
              if (e.tags?.ref) return `Entrance ${e.tags.ref}`;
              if (e.tags?.entrance === "main") return "Main Entrance";
              if (e.tags?.amenity === "parking_entrance") return "Parking Drop-off";
              if (e.tags?.highway === "bus_stop") return "Transit Drop-off Zone";
              return `Gate / Entrance ${i + 1}`;
            });
            const unique = Array.from(new Set(entrances)) as string[];
            setRealEntrances(unique.slice(0, 6));
          } else {
            setRealEntrances([
              "Main Entrance",
              "Secondary Entrance",
              "Parking Drop-off",
            ]);
          }
        })
        .catch(() => {
          setRealEntrances(["Main Entrance", "Secondary Entrance", "Parking Drop-off"]);
        })
        .finally(() => setFetchingEntrances(false));
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
      setActiveInput("dropoff");
      setEntranceModal(null);
    } else {
      setDropoff(displayName);
      AsyncStorage.setItem("vura.ride.dropoff", JSON.stringify([s.lat, s.lon]));
      setEntranceModal(null);
      router.push("/ride/options");
    }
  };

  const defaultSuggestions = [
    { name: "Heathrow Airport", addr: "Terminal 5, London TW6", lat: 51.47, lon: -0.4543 },
    { name: "Mall of Africa", addr: "Waterfall City, Midrand", lat: -26.0152, lon: 28.1065 },
    { name: "British Museum", addr: "Great Russell St, London", lat: 51.5194, lon: -0.127 },
    { name: "King's Cross Station", addr: "Euston Rd, London N1C", lat: 51.532, lon: -0.124 },
  ];

  const displayResults = results.length > 0 ? results : defaultSuggestions;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="px-5 pt-3 pb-4 bg-surface border-b border-border">
        <View className="flex-row items-center gap-3 mb-4">
          <Link href="/" asChild>
            <TouchableOpacity className="w-9 h-9 rounded-full bg-secondary items-center justify-center">
              <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
            </TouchableOpacity>
          </Link>
          <Text className="text-base font-bold text-foreground">
            Plan your ride
          </Text>
        </View>

        <View className="flex-row gap-3">
          <View className="items-center pt-4">
            <Ionicons name="ellipse" size={12} color="#2e1e1a" />
            <View className="w-px flex-1 my-1 border-l-2 border-dashed border-muted-foreground/40" />
            <Ionicons name="location" size={16} color="#e04e2f" />
          </View>
          <View className="flex-1 gap-y-2">
            <TextInput
              value={pickup}
              onFocus={() => setActiveInput("pickup")}
              onChangeText={setPickup}
              className={`w-full rounded-xl px-3 py-3 text-sm font-medium ${activeInput === "pickup" ? "bg-accent border border-primary/30" : "bg-secondary border border-transparent"}`}
            />
            <TextInput
              autoFocus
              placeholder="Where to?"
              placeholderTextColor="#80716b"
              value={dropoff}
              onFocus={() => setActiveInput("dropoff")}
              onChangeText={setDropoff}
              className={`w-full rounded-xl px-3 py-3 text-sm font-medium ${activeInput === "dropoff" ? "bg-accent border border-primary/30" : "bg-secondary border border-transparent"}`}
            />
          </View>
        </View>
      </View>

      <ScrollView className="flex-1 px-5 py-4">
        <Text className="text-xs font-bold text-muted-foreground uppercase mb-2">
          {results.length > 0 ? "Search Results" : "Suggestions"}
        </Text>
        {loading && (
          <ActivityIndicator size="small" color="#e04e2f" style={{ marginVertical: 16 }} />
        )}
        {displayResults.map((s, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => handleSelect(s)}
            className="flex-row items-center gap-3 py-3 border-b border-border"
          >
            <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
              <Ionicons
                name={results.length > 0 ? "location" : i === 0 ? "star" : "time"}
                size={16}
                color={results.length > 0 ? "#e04e2f" : i === 0 ? "#e04e2f" : "#80716b"}
              />
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
        ))}
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
