import { Link } from "expo-router";
import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const rides = [
  {
    id: "go",
    name: "VuraGo",
    desc: "Affordable, everyday rides",
    eta: "3 min",
    price: "R12.40",
    icon: "people" as const,
  },
  {
    id: "x",
    name: "VuraX",
    desc: "Faster pickups, comfy cars",
    eta: "4 min",
    price: "R15.90",
    icon: "flash" as const,
    badge: "Popular",
  },
  {
    id: "lux",
    name: "VuraLux",
    desc: "Premium cars, top-rated drivers",
    eta: "6 min",
    price: "R24.50",
    icon: "diamond" as const,
  },
];

const paymentOptions = [
  { type: "card" as const, last4: "4242" },
  { type: "card" as const, last4: "1234" },
  { type: "cash" as const },
];

export default function RideOptions() {
  const [selected, setSelected] = useState("x");
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(paymentOptions[0]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Map placeholder */}
      <View className="relative h-[260px] bg-secondary items-center justify-center">
        <Ionicons name="map" size={48} color="#80716b" />
        <Text className="text-xs text-muted-foreground mt-2">Route map</Text>
        <Link href="/search" asChild>
          <TouchableOpacity className="absolute top-3 left-4 w-9 h-9 rounded-full bg-surface border border-border items-center justify-center">
            <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
          </TouchableOpacity>
        </Link>
      </View>

      <View className="-mt-5 rounded-t-3xl bg-surface px-5 pt-5 pb-4 flex-1">
        <View className="mx-auto h-1.5 w-12 rounded-full bg-border mb-4" />
        <Text className="text-lg font-bold text-foreground mb-1">
          Choose a ride
        </Text>
        <Text className="text-xs text-muted-foreground mb-3">
          Recommended for your trip
        </Text>

        <ScrollView className="flex-1 gap-y-2" showsVerticalScrollIndicator={false}>
          {rides.map((r) => {
            const active = selected === r.id;
            return (
              <TouchableOpacity
                key={r.id}
                onPress={() => setSelected(r.id)}
                className={`w-full flex-row items-center gap-3 rounded-2xl border px-3.5 py-3 mb-2 ${active ? "border-primary bg-accent" : "border-border bg-surface"}`}
              >
                <View
                  className={`w-12 h-12 rounded-xl items-center justify-center ${active ? "bg-primary" : "bg-secondary"}`}
                >
                  <Ionicons
                    name={r.icon}
                    size={20}
                    color={active ? "#fff" : "#2e1e1a"}
                  />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-sm font-bold text-foreground">
                      {r.name}
                    </Text>
                    {r.badge && (
                      <View className="rounded-md bg-primary/10 px-2 py-0.5">
                        <Text className="text-[10px] font-bold text-primary uppercase">
                          {r.badge}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    {r.desc} · {r.eta}
                  </Text>
                </View>
                <Text className="text-sm font-extrabold text-foreground">
                  {r.price}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View className="mt-4 flex-row gap-2">
          <TouchableOpacity
            onPress={() => setShowPayment(true)}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-secondary px-3 py-2.5"
          >
            <Ionicons
              name={paymentMethod.type === "card" ? "card" : "cash"}
              size={16}
              color="#2e1e1a"
            />
            <Text className="text-xs font-semibold text-foreground">
              {paymentMethod.type === "card"
                ? `•••• ${paymentMethod.last4}`
                : "Cash"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-secondary px-3 py-2.5">
            <Ionicons name="pricetag" size={16} color="#2e1e1a" />
            <Text className="text-xs font-semibold text-foreground">
              Add promo
            </Text>
          </TouchableOpacity>
        </View>

        <Link
          href="/ride/track"
          asChild
        >
          <TouchableOpacity className="mt-3 rounded-xl bg-primary py-4 items-center">
            <Text className="text-sm font-bold text-primary-foreground">
              Confirm {rides.find((r) => r.id === selected)?.name}
            </Text>
          </TouchableOpacity>
        </Link>
      </View>

      {/* Payment Modal */}
      <Modal
        visible={showPayment}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPayment(false)}
      >
        <TouchableOpacity
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setShowPayment(false)}
        >
          <View className="bg-surface rounded-t-[2rem] p-5">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-foreground">
                Select Payment
              </Text>
              <TouchableOpacity
                onPress={() => setShowPayment(false)}
                className="w-8 h-8 rounded-full bg-secondary items-center justify-center"
              >
                <Ionicons name="close" size={16} color="#2e1e1a" />
              </TouchableOpacity>
            </View>
            <View className="gap-y-2">
              {paymentOptions.map((opt, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => {
                    setPaymentMethod(opt);
                    setShowPayment(false);
                  }}
                  className={`w-full flex-row items-center gap-3 p-3 rounded-xl border ${paymentMethod.type === opt.type && paymentMethod.last4 === opt.last4 ? "border-primary bg-primary/5" : "border-border bg-surface"}`}
                >
                  <View
                    className={`w-10 h-10 rounded-full items-center justify-center ${opt.type === "card" ? "bg-blue-100" : "bg-green-100"}`}
                  >
                    <Ionicons
                      name={opt.type === "card" ? "card" : "cash"}
                      size={20}
                      color={opt.type === "card" ? "#2563eb" : "#16a34a"}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-foreground">
                      {opt.type === "card" ? `•••• ${opt.last4}` : "Cash"}
                    </Text>
                  </View>
                  {paymentMethod.type === opt.type &&
                    paymentMethod.last4 === opt.last4 && (
                      <View className="w-2.5 h-2.5 rounded-md bg-primary" />
                    )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
