import { Link } from "expo-router";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const services = [
  { icon: "car" as const, label: "Ride", desc: "Get a car in minutes" },
  { icon: "calendar" as const, label: "Reserve", desc: "Plan ahead, save time" },
  { icon: "restaurant" as const, label: "Eats", desc: "Food delivered fast" },
  { icon: "cube" as const, label: "Package", desc: "Send across town" },
  { icon: "airplane" as const, label: "Airport", desc: "Curbside pickup" },
  { icon: "bicycle" as const, label: "Bike", desc: "Cheaper short trips" },
  { icon: "truck" as const, label: "Moving", desc: "Help with big loads" },
  { icon: "briefcase" as const, label: "Business", desc: "For your team" },
];

export default function Services() {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem]">
          <Text className="text-2xl font-bold text-white">Services</Text>
          <Text className="text-sm text-white/80 mt-1">
            Everything Vura can do for you.
          </Text>
        </View>

        <View className="px-5 mt-5">
          <View className="flex-row flex-wrap gap-3">
            {services.map((s) => (
              <Link key={s.label} href="/search" asChild>
                <TouchableOpacity className="w-[47%] rounded-xl border border-border bg-surface p-4">
                  <View className="w-11 h-11 rounded-xl bg-accent items-center justify-center">
                    <Ionicons name={s.icon} size={20} color="#e04e2f" />
                  </View>
                  <Text className="mt-3 text-sm font-bold text-foreground">
                    {s.label}
                  </Text>
                  <Text className="text-xs text-muted-foreground">{s.desc}</Text>
                </TouchableOpacity>
              </Link>
            ))}
          </View>

          <View className="mt-6 rounded-2xl bg-primary p-5">
            <Text className="text-xs font-bold text-white/80 uppercase">
              Vura One
            </Text>
            <Text className="text-lg font-bold text-white mt-1">
              Save 10% on every ride
            </Text>
            <Text className="text-xs text-white/80 mt-1">
              Membership perks across rides & eats.
            </Text>
            <TouchableOpacity className="mt-3 rounded-full bg-surface px-4 py-2 self-start">
              <Text className="text-xs font-bold text-primary">
                Try free for 30 days
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}
