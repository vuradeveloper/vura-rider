import { Link } from "expo-router";
import { View, Text, TextInput, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export default function PromotionsPage() {
  const promos = [
    {
      title: "20% off your next 3 rides",
      desc: "Up to R50 per ride. Valid until end of month.",
    },
    {
      title: "R100 Welcome Bonus",
      desc: "Applied automatically on your first ride.",
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
        <Text className="mt-12 text-2xl font-extrabold text-white">
          Promotions
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        <View className="flex-row gap-2 mb-6">
          <TextInput
            placeholder="Enter promo code"
            placeholderTextColor="#80716b"
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-semibold text-foreground"
          />
          <TouchableOpacity className="rounded-2xl bg-primary px-5 items-center justify-center">
            <Text className="text-sm font-bold text-primary-foreground">Apply</Text>
          </TouchableOpacity>
        </View>

        <View className="mb-6">
          <Text className="text-sm font-extrabold text-foreground mb-3">
            Active Offers
          </Text>
          <View className="gap-y-3">
            {promos.map((p, i) => (
              <View
                key={i}
                className="rounded-2xl bg-surface border border-border p-4 flex-row items-start gap-4"
              >
                <View className="w-10 h-10 rounded-full bg-red-100 items-center justify-center">
                  <Ionicons name="gift" size={20} color="#dc2626" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-foreground">
                    {p.title}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-1">
                    {p.desc}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity className="rounded-xl bg-secondary/50 p-4 border border-border flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <Ionicons name="pricetag" size={20} color="#80716b" />
            <Text className="text-sm font-bold text-foreground">
              Past promotions
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#80716b" />
        </TouchableOpacity>
        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}
