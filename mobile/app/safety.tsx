import { Link } from "expo-router";
import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export default function SafetyPage() {
  const [activeSetting, setActiveSetting] = useState<string | null>(null);

  const settings = [
    {
      id: "contacts",
      icon: "people" as const,
      title: "Trusted Contacts",
      desc: "Share your trip status with family and friends.",
    },
    {
      id: "pin",
      icon: "key" as const,
      title: "Verify Your Ride",
      desc: "Use a PIN to make sure you get in the right car.",
    },
    {
      id: "check",
      icon: "alarm" as const,
      title: "RideCheck",
      desc: "We'll check on you if your trip goes off route.",
    },
  ];

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <Link href="/account" asChild>
          <TouchableOpacity className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center">
            <Ionicons name="arrow-back" size={16} color="#fff" />
          </TouchableOpacity>
        </Link>
        <View className="mt-12 flex-row items-center gap-3">
          <Ionicons name="shield-checkmark" size={32} color="#fff" />
          <Text className="text-2xl font-extrabold text-white">
            Safety Center
          </Text>
        </View>
        <Text className="text-sm text-white/80 mt-2">
          Your safety is our priority. Manage your preferences below.
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        <Text className="text-sm font-extrabold text-foreground mb-3">
          Safety tools
        </Text>
        <View className="rounded-2xl bg-surface border border-border overflow-hidden">
          {settings.map((s) => (
            <View key={s.id} className="border-b border-border last:border-b-0">
              <TouchableOpacity
                onPress={() =>
                  setActiveSetting(activeSetting === s.id ? null : s.id)
                }
                className="flex-row items-center gap-4 p-4"
              >
                <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                  <Ionicons name={s.icon} size={20} color="#e04e2f" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-foreground">
                    {s.title}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    {s.desc}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color="#80716b"
                  style={{
                    transform: [
                      {
                        rotate:
                          activeSetting === s.id ? "90deg" : "0deg",
                      },
                    ],
                  }}
                />
              </TouchableOpacity>
              {activeSetting === s.id && (
                <View className="px-4 pb-4">
                  <View className="rounded-full bg-secondary/50 border border-border p-4">
                    <View className="flex-row justify-between items-center">
                      <Text className="text-sm font-bold text-foreground">
                        Feature Enabled
                      </Text>
                      <Ionicons name="checkmark" size={16} color="#16a34a" />
                    </View>
                    <Text className="text-xs text-muted-foreground mt-1">
                      This feature is actively running to keep you safe.
                    </Text>
                  </View>
                </View>
              )}
            </View>
          ))}
        </View>

        <View className="mt-4 rounded-2xl bg-red-50 p-5 border border-red-100 items-center">
          <Text className="text-sm font-bold text-red-800">
            Need emergency help?
          </Text>
          <Text className="text-xs text-red-600 mt-1 mb-4 text-center">
            Our emergency response team is available 24/7.
          </Text>
          <TouchableOpacity
            onPress={() => Alert.alert("Connecting to emergency services...")}
            className="w-full rounded-xl bg-red-600 py-2.5 items-center"
          >
            <Text className="text-sm font-bold text-white">
              Call Emergency Services
            </Text>
          </TouchableOpacity>
        </View>
        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}
