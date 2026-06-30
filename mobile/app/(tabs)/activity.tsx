import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const trips = [
  {
    icon: "car" as const,
    title: "Heathrow Airport",
    date: "Today · 9:14 AM",
    price: "R42.80",
    status: "Completed",
  },
  {
    icon: "restaurant" as const,
    title: "Dishoom Shoreditch",
    date: "Yesterday · 7:42 PM",
    price: "R28.30",
    status: "Delivered",
  },
  {
    icon: "car" as const,
    title: "Canary Wharf",
    date: "Mon · 8:02 AM",
    price: "R17.50",
    status: "Completed",
  },
  {
    icon: "cube" as const,
    title: "Package to Camden",
    date: "Sat · 2:11 PM",
    price: "R9.20",
    status: "Delivered",
  },
  {
    icon: "car" as const,
    title: "British Museum",
    date: "Fri · 11:30 AM",
    price: "R11.10",
    status: "Completed",
  },
];

export default function Activity() {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem]">
          <Text className="text-2xl font-bold text-white">Activity</Text>
          <Text className="text-sm text-white/80 mt-1">
            Your past trips and orders.
          </Text>
          <View className="mt-4 flex-row gap-2 rounded-2xl bg-white/15 p-1">
            {["Past", "Upcoming", "Drafts"].map((t, i) => (
              <TouchableOpacity
                key={t}
                className={`flex-1 rounded-xl py-2 items-center ${i === 0 ? "bg-surface" : ""}`}
              >
                <Text
                  className={`text-xs font-bold ${i === 0 ? "text-primary" : "text-white/80"}`}
                >
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="px-5 mt-5 gap-y-2">
          {trips.map((t, i) => (
            <TouchableOpacity
              key={i}
              className="w-full flex-row items-center gap-3 rounded-2xl bg-surface border border-border p-3.5"
            >
              <View className="w-12 h-12 rounded-full bg-secondary items-center justify-center">
                <Ionicons name={t.icon} size={20} color="#2e1e1a" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                  {t.title}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {t.date} · {t.status}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-sm font-extrabold text-foreground">
                  {t.price}
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#80716b" />
              </View>
            </TouchableOpacity>
          ))}
        </View>
        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}
