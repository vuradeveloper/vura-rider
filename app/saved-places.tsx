import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface SavedPlace {
  id: string;
  type: "home" | "work" | "other";
  name: string;
  address: string;
  lat: number;
  lng: number;
}

const STORAGE_KEY = "vura.saved_places";

export default function SavedPlacesScreen() {
  const router = useRouter();
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [editingPlace, setEditingPlace] = useState<SavedPlace | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<"home" | "work" | "other">("other");
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadPlaces();
  }, []);

  async function loadPlaces() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        setPlaces(JSON.parse(raw));
      } else {
        // Seed default places
        const defaults: SavedPlace[] = [
          {
            id: "1",
            type: "home",
            name: "Home",
            address: "Select address...",
            lat: 0,
            lng: 0,
          },
          {
            id: "2",
            type: "work",
            name: "Work",
            address: "Select address...",
            lat: 0,
            lng: 0,
          },
        ];
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
        setPlaces(defaults);
      }
    } catch {
      Alert.alert("Error", "Failed to load saved places.");
    }
  }

  async function handleSave() {
    if (!address.trim() || (type === "other" && !name.trim())) {
      Alert.alert("Error", "Please fill in all required fields.");
      return;
    }

    try {
      let updated: SavedPlace[];
      if (editingPlace) {
        updated = places.map((p) =>
          p.id === editingPlace.id
            ? {
                ...p,
                name: type === "other" ? name : type === "home" ? "Home" : "Work",
                address,
                type,
              }
            : p
        );
      } else {
        const newPlace: SavedPlace = {
          id: Date.now().toString(),
          name: type === "other" ? name : type === "home" ? "Home" : "Work",
          address,
          type,
          lat: -17.824858, // default fallback to Harare Center
          lng: 31.053028,
        };
        updated = [...places, newPlace];
      }

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setPlaces(updated);
      resetForm();
    } catch {
      Alert.alert("Error", "Failed to save place.");
    }
  }

  async function handleDelete(id: string) {
    Alert.alert(
      "Remove place?",
      "Are you sure you want to remove this saved place?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              // Instead of hard deleting default Home/Work, we just reset them.
              const updated = places.map((p) => {
                if (p.id === id) {
                  if (p.type === "home" || p.type === "work") {
                    return { ...p, address: "Select address...", lat: 0, lng: 0 };
                  }
                }
                return p;
              }).filter((p) => p.type !== "other" || p.id !== id);

              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
              setPlaces(updated);
            } catch {
              Alert.alert("Error", "Failed to remove place.");
            }
          },
        },
      ]
    );
  }

  function handleEdit(place: SavedPlace) {
    setEditingPlace(place);
    setName(place.type === "other" ? place.name : "");
    setAddress(place.address === "Select address..." ? "" : place.address);
    setType(place.type);
    setShowAddForm(true);
  }

  function resetForm() {
    setEditingPlace(null);
    setName("");
    setAddress("");
    setType("other");
    setShowAddForm(false);
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <TouchableOpacity
          onPress={() => router.back()}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#fff" />
        </TouchableOpacity>
        <Text className="mt-12 text-2xl font-extrabold text-white">Saved Places</Text>
        <Text className="text-sm text-white/80 mt-1">Manage your favorite destinations</Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        {showAddForm ? (
          <View className="bg-surface border border-border rounded-2xl p-5 mb-6 gap-y-4">
            <Text className="text-base font-bold text-foreground">
              {editingPlace ? "Edit Saved Place" : "Add Saved Place"}
            </Text>

            <View className="flex-row gap-2">
              {(["home", "work", "other"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setType(t)}
                  className={`flex-1 py-2 rounded-lg border items-center justify-center ${
                    type === t
                      ? "bg-primary border-primary"
                      : "bg-surface border-border"
                  }`}
                >
                  <Text
                    className={`text-xs font-bold capitalize ${
                      type === t ? "text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {type === "other" && (
              <View className="gap-y-1">
                <Text className="text-xs font-bold text-muted-foreground ml-1">
                  Place Name
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Gym, School"
                  placeholderTextColor="#80716b"
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground"
                />
              </View>
            )}

            <View className="gap-y-1">
              <Text className="text-xs font-bold text-muted-foreground ml-1">
                Address
              </Text>
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder="Enter address"
                placeholderTextColor="#80716b"
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground"
              />
            </View>

            <View className="flex-row gap-3 mt-2">
              <TouchableOpacity
                onPress={resetForm}
                className="flex-1 py-3.5 border border-border rounded-xl items-center"
              >
                <Text className="text-xs font-bold text-foreground">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                className="flex-1 py-3.5 bg-primary rounded-xl items-center"
              >
                <Text className="text-xs font-bold text-primary-foreground">Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setShowAddForm(true)}
            className="flex-row items-center justify-center gap-2 border border-dashed border-primary rounded-xl py-4 mb-6 bg-accent"
          >
            <Ionicons name="add-circle" size={18} color="#e04e2f" />
            <Text className="text-sm font-bold text-primary">Add New Place</Text>
          </TouchableOpacity>
        )}

        <View className="gap-y-3">
          {places.map((place) => {
            const hasAddress = place.address !== "Select address...";
            return (
              <View
                key={place.id}
                className="flex-row items-center justify-between bg-surface border border-border rounded-xl p-4"
              >
                <View className="flex-row items-center gap-3 flex-1 mr-2">
                  <View className="w-10 h-10 rounded-full bg-accent items-center justify-center">
                    <Ionicons
                      name={
                        place.type === "home"
                          ? "home"
                          : place.type === "work"
                          ? "briefcase"
                          : "pin"
                      }
                      size={16}
                      color="#e04e2f"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-foreground">
                      {place.name}
                    </Text>
                    <Text
                      className="text-muted-foreground text-xs mt-0.5"
                      numberOfLines={1}
                    >
                      {place.address}
                    </Text>
                  </View>
                </View>

                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => handleEdit(place)}
                    className="p-2 bg-secondary rounded-full"
                  >
                    <Ionicons name="pencil" size={14} color="#80716b" />
                  </TouchableOpacity>
                  {hasAddress && (
                    <TouchableOpacity
                      onPress={() => handleDelete(place.id)}
                      className="p-2 bg-red-100 rounded-full"
                    >
                      <Ionicons name="trash" size={14} color="#ef4444" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
