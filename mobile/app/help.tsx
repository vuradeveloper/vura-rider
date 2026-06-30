import { Link } from "expo-router";
import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export default function HelpPage() {
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  const topics = [
    { id: "trip", icon: "car" as const, title: "Trip Issues and Refunds" },
    {
      id: "account",
      icon: "receipt" as const,
      title: "Account and Payment Options",
    },
    {
      id: "safety",
      icon: "alert-circle" as const,
      title: "Report a Safety Incident",
    },
    {
      id: "support",
      icon: "chatbubbles" as const,
      title: "Support Messages",
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
        <Text className="mt-12 text-2xl font-extrabold text-white">Help</Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        <View className="mb-6">
          <Text className="text-sm font-extrabold text-foreground mb-3">
            Recent Trip
          </Text>
          <TouchableOpacity className="rounded-2xl bg-surface border border-border p-4 flex-row items-center justify-between">
            <View className="flex-row items-center gap-4">
              <View className="w-12 h-12 rounded-full bg-secondary items-center justify-center">
                <Text className="text-[10px] uppercase font-bold text-muted-foreground">
                  Jun
                </Text>
                <Text className="text-lg font-extrabold text-foreground">19</Text>
              </View>
              <View>
                <Text className="text-sm font-bold text-foreground">
                  Toyota Prius
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  R 15.90 · Cancelled
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#80716b" />
          </TouchableOpacity>
          <TouchableOpacity className="mt-2">
            <Text className="text-xs font-bold text-primary ml-2">
              View all past trips
            </Text>
          </TouchableOpacity>
        </View>

        <View className="mb-6">
          <Text className="text-sm font-extrabold text-foreground mb-3">
            All topics
          </Text>
          <View className="rounded-2xl bg-surface border border-border overflow-hidden">
            {topics.map((t) => (
              <View key={t.id} className="border-b border-border last:border-b-0">
                <TouchableOpacity
                  onPress={() =>
                    setActiveTopic(activeTopic === t.id ? null : t.id)
                  }
                  className="flex-row items-center gap-3 p-4"
                >
                  <View className="w-8 h-8 rounded-full bg-secondary items-center justify-center">
                    <Ionicons name={t.icon} size={16} color="#2e1e1a" />
                  </View>
                  <Text className="text-sm font-bold text-foreground flex-1">
                    {t.title}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color="#80716b"
                    style={{
                      transform: [
                        {
                          rotate: activeTopic === t.id ? "90deg" : "0deg",
                        },
                      ],
                    }}
                  />
                </TouchableOpacity>
                {activeTopic === t.id && (
                  <View className="px-4 pb-4">
                    <View className="rounded-full bg-secondary border border-border p-4">
                      <Text className="text-sm font-bold text-foreground">
                        Support Assistant
                      </Text>
                      <Text className="text-xs text-muted-foreground mt-1">
                        Our team is available to assist you with {t.title.toLowerCase()}. We typically reply within 2 hours.
                      </Text>
                      <TouchableOpacity
                        onPress={() => Alert.alert("Connecting to support...")}
                        className="mt-3 bg-primary px-3 py-1.5 rounded-lg self-start"
                      >
                        <Text className="text-xs font-bold text-primary-foreground">
                          Contact Support
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}
