import { Link } from "expo-router";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export default function Welcome() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary flex-1 flex justify-end rounded-b-[2rem] px-6 pt-10 pb-8 relative overflow-hidden">
        <View className="absolute -right-16 -top-10 h-56 w-56 rounded-full bg-white/10" />
        <View className="absolute -left-10 bottom-24 h-40 w-40 rounded-full bg-white/10" />

        <View className="flex-row items-center gap-2 mb-auto">
          <Ionicons name="car" size={28} color="#fff" />
          <Text className="text-lg font-extrabold text-white">Vura Ride</Text>
        </View>

        <View>
          <Text className="text-3xl font-extrabold text-white leading-tight">
            Go anywhere.{"\n"}Get anything.
          </Text>
          <Text className="mt-3 text-sm text-white/80 max-w-[18rem]">
            Request a ride, hop in, and relax. Drive on your terms — earn whenever you want.
          </Text>
        </View>
      </View>

      <View className="px-6 py-6 gap-y-3 bg-surface">
        <Link href="/signup" asChild>
          <TouchableOpacity className="flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4">
            <Text className="text-sm font-bold text-primary-foreground">
              Create an account
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#fff" />
          </TouchableOpacity>
        </Link>
        <Link href="/login" asChild>
          <TouchableOpacity className="flex-row items-center justify-center rounded-2xl border border-border bg-surface py-4">
            <Text className="text-sm font-bold text-foreground">
              I already have an account
            </Text>
          </TouchableOpacity>
        </Link>
        <View className="flex-row flex-wrap justify-center mt-3 px-4">
          <Text className="text-[11px] text-muted-foreground">
            By continuing, you agree to Vura Ride's{" "}
          </Text>
          <Link href="/terms" asChild>
            <TouchableOpacity>
              <Text className="text-[11px] font-bold text-primary underline">
                Terms of Service
              </Text>
            </TouchableOpacity>
          </Link>
          <Text className="text-[11px] text-muted-foreground"> and </Text>
          <Link href="/privacy" asChild>
            <TouchableOpacity>
              <Text className="text-[11px] font-bold text-primary underline">
                Privacy Policy
              </Text>
            </TouchableOpacity>
          </Link>
          <Text className="text-[11px] text-muted-foreground">.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
