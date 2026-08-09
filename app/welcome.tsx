import { Link } from "expo-router";
import { View, Text, TouchableOpacity, ScrollView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export default function Welcome() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 flex justify-end rounded-b-[2rem] px-6 pt-10 pb-8 relative overflow-hidden bg-[#120805]">
        {Platform.OS === "web" ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              overflow: "hidden",
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            <iframe
              src="https://www.youtube.com/embed/QIUPoJu8PGU?autoplay=1&mute=1&loop=1&playlist=QIUPoJu8PGU&controls=0&showinfo=0&rel=0&iv_load_policy=3&modestbranding=1&playsinline=1&enablejsapi=1&disablekb=1&fs=0"
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: "100vw",
                height: "56.25vw", /* 16:9 Aspect Ratio */
                minHeight: "100vh",
                minWidth: "177.77vh", /* 16:9 Aspect Ratio */
                transform: "translate(-50%, -50%)",
                pointerEvents: "none",
                opacity: 0.55,
                border: "none",
              }}
              allow="autoplay; encrypted-media"
            />
            {/* Absolute overlay blocker to intercept clicks/hovers and keep player controls hidden */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                backgroundColor: "transparent",
                pointerEvents: "auto",
              }}
            />
          </div>
        ) : null}

        <View className="absolute -right-16 -top-10 h-56 w-56 rounded-full bg-white/10" />
        <View className="absolute -left-10 bottom-24 h-40 w-40 rounded-full bg-white/10" />

        <View className="flex-row items-center gap-2 mb-auto z-10">
          <Ionicons name="car" size={28} color="#fff" />
          <Text className="text-lg font-extrabold text-white">Vura Ride</Text>
        </View>

        <View className="z-10">
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
