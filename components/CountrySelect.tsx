import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { countries, Country } from "@/lib/countries";

/**
 * Full-screen country selector for the phone number field. Opens a modal that
 * covers the whole screen with a search box and a scrollable list showing each
 * country's flag, name and dial code. Works on web, Android and iOS.
 */
export default function CountrySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (dialCode: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");

  const sorted = useMemo(
    () => [...countries].sort((a, b) => a.name.localeCompare(b.name)),
    []
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial_code.replace(/\s/g, "").includes(q.replace(/\s/g, ""))
    );
  }, [sorted, query]);

  const selected = sorted.find((c) => c.dial_code === value);

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        className="w-28 h-11 rounded-xl bg-secondary border border-border flex-row items-center justify-center gap-1.5"
      >
        <Text className="text-sm font-bold text-foreground">
          {selected ? `${selected.flag} ${selected.dial_code}` : value}
        </Text>
        <Ionicons name="chevron-down" size={14} color="#80716b" />
      </Pressable>

      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 16,
              paddingTop: Platform.OS === "web" ? 16 : 52,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: "#eee",
              gap: 12,
            }}
          >
            <TouchableOpacity
              onPress={() => setVisible(false)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: "#f3f1ee",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="arrow-back" size={18} color="#2e1e1a" />
            </TouchableOpacity>
            <Text style={{ flex: 1, fontSize: 17, fontWeight: "700", color: "#2e1e1a" }}>
              Select country
            </Text>
          </View>

          {/* Search */}
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 14,
              marginBottom: 8,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: "#f3f1ee",
              borderRadius: 12,
              paddingHorizontal: 12,
              height: 44,
            }}
          >
            <Ionicons name="search" size={18} color="#80716b" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search country or code"
              placeholderTextColor="#80716b"
              style={{ flex: 1, fontSize: 15, color: "#2e1e1a" }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query ? (
              <TouchableOpacity onPress={() => setQuery("")}>
                <Ionicons name="close-circle" size={18} color="#80716b" />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* List */}
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }: { item: Country }) => {
              const isSelected = item.dial_code === value;
              return (
                <TouchableOpacity
                  onPress={() => {
                    onChange(item.dial_code);
                    setVisible(false);
                    setQuery("");
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 14,
                    paddingVertical: 13,
                    paddingHorizontal: 20,
                    backgroundColor: isSelected ? "#fdeee9" : "#ffffff",
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{item.flag}</Text>
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 15,
                      fontWeight: isSelected ? "700" : "500",
                      color: "#2e1e1a",
                    }}
                  >
                    {item.name}
                  </Text>
                  <Text style={{ fontSize: 15, color: "#80716b", fontWeight: "600" }}>
                    {item.dial_code}
                  </Text>
                  {isSelected ? (
                    <Ionicons name="checkmark" size={18} color="#e04e2f" />
                  ) : null}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={{ alignItems: "center", paddingTop: 60 }}>
                <Text style={{ color: "#80716b", fontSize: 15 }}>
                  No countries match "{query}"
                </Text>
              </View>
            }
          />
        </View>
      </Modal>
    </>
  );
}
