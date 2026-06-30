import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  if (!ready) return null;
  if (!user) {
    router.replace("/welcome");
    return null;
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Hero greeting */}
        <View className="bg-primary px-5 pt-4 pb-10 rounded-b-[2rem] relative overflow-hidden">
          <View className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <View className="absolute right-12 top-20 h-24 w-24 rounded-full bg-white/10" />
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs text-white/80">Good morning,</Text>
              <Text className="text-2xl font-bold text-white">
                {user.name}
              </Text>
            </View>
            <TouchableOpacity className="w-10 h-10 rounded-full bg-white/15 items-center justify-center">
              <Ionicons name="notifications" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          <Link href="/search" asChild>
            <TouchableOpacity className="mt-6 flex-row items-center gap-3 rounded-2xl bg-surface px-4 py-3.5">
              <Ionicons name="search" size={20} color="#e04e2f" />
              <Text className="text-sm font-medium text-muted-foreground flex-1">
                Where to?
              </Text>
              <View className="flex-row items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1">
                <Ionicons name="time" size={12} color="#80716b" />
                <Text className="text-xs font-semibold text-foreground">
                  Now
                </Text>
              </View>
            </TouchableOpacity>
          </Link>
        </View>

        {/* Quick services */}
        <View className="px-5 -mt-4">
          <View className="flex-row justify-between rounded-2xl bg-surface border border-border p-4">
            {[
              { icon: "car" as const, label: "Ride", to: "/search" },
              { icon: "restaurant" as const, label: "Eats", to: "/services" },
              { icon: "cube" as const, label: "Package", to: "/services" },
              { icon: "briefcase" as const, label: "Business", to: "/services" },
            ].map(({ icon, label, to }) => (
              <Link key={label} href={to as any} asChild>
                <TouchableOpacity className="items-center gap-2">
                  <View className="w-12 h-12 rounded-xl bg-accent items-center justify-center">
                    <Ionicons name={icon} size={20} color="#e04e2f" />
                  </View>
                  <Text className="text-[11px] font-semibold text-foreground">
                    {label}
                  </Text>
                </TouchableOpacity>
              </Link>
            ))}
          </View>
        </View>

        {/* Saved places */}
        <View className="px-5 mt-6">
          <Text className="text-sm font-bold text-foreground mb-3">
            Saved places
          </Text>
          <View className="gap-y-2">
            {[
              { icon: "home" as const, label: "Home", sub: "221B Baker St, London" },
              { icon: "briefcase" as const, label: "Work", sub: "Canary Wharf, London" },
            ].map((p) => (
              <Link key={p.label} href="/search" asChild>
                <TouchableOpacity className="flex-row items-center gap-3 rounded-xl bg-surface border border-border px-3.5 py-3">
                  <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                    <Ionicons name={p.icon} size={16} color="#2e1e1a" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">
                      {p.label}
                    </Text>
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {p.sub}
                    </Text>
                  </View>
                </TouchableOpacity>
              </Link>
            ))}
          </View>
        </View>

        {/* Map preview placeholder */}
        <View className="mx-5 mt-6 rounded-2xl overflow-hidden border border-border">
          <View className="h-[180px] bg-secondary items-center justify-center">
            <Ionicons name="map" size={48} color="#80716b" />
            <Text className="text-xs text-muted-foreground mt-2">
              Map preview
            </Text>
          </View>
          <View className="flex-row items-center justify-between px-4 py-3 bg-surface">
            <View>
              <Text className="text-xs text-muted-foreground">Nearest driver</Text>
              <Text className="text-sm font-bold text-foreground">
                2 min away
              </Text>
            </View>
            <Link href="/search" asChild>
              <TouchableOpacity className="rounded-full bg-primary px-4 py-2">
                <Text className="text-xs font-bold text-primary-foreground">
                  Book now
                </Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>

        <View className="h-6" />
      </ScrollView>
    </SafeAreaView>
  );
}
