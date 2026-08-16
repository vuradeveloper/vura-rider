import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getRideReceipt } from "@/services/RideService";
import { submitTip, getTipSuggestions } from "@/services/TipService";
import { formatCurrency } from "@/lib/utils";
import type { RideReceipt } from "@/lib/types";

export default function ReceiptScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const router = useRouter();
  const [receipt, setReceipt] = useState<RideReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTip, setShowTip] = useState(false);
  const [tipAmount, setTipAmount] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [submittingTip, setSubmittingTip] = useState(false);

  useEffect(() => {
    if (!rideId) return;
    (async () => {
      try {
        const { receipt: data } = await getRideReceipt(rideId);
        setReceipt(data);
      } catch (err: any) {
        setError(err.message || "Could not load receipt");
      } finally {
        setLoading(false);
      }
    })();
  }, [rideId]);

  async function handleTip(amount: number) {
    setSubmittingTip(true);
    try {
      await submitTip(rideId, amount);
      setTipAmount(amount);
      Alert.alert("Tip sent!", `Thank you! ${formatCurrency(amount)} tip has been sent to your driver.`);
      setShowTip(false);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to send tip");
    } finally {
      setSubmittingTip(false);
    }
  }

  const total = receipt
    ? (receipt.fare || 0) + (receipt.ride_request_fee || 0) + (tipAmount || 0)
    : 0;

  const tipSuggestions = receipt ? getTipSuggestions(receipt.fare) : [];

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="bg-primary px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <TouchableOpacity
          onPress={() => router.back()}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/20 items-center justify-center"
        >
          <Ionicons name="arrow-back" size={16} color="#fff" />
        </TouchableOpacity>
        <Text className="mt-12 text-2xl font-extrabold text-white">
          Ride Receipt
        </Text>
        <Text className="text-sm text-white/80 mt-1">
          Trip summary and payment details
        </Text>
      </View>

      <ScrollView className="flex-1 px-5 mt-6" showsVerticalScrollIndicator={false}>
        {loading && (
          <ActivityIndicator size="large" color="#e04e2f" style={{ marginTop: 40 }} />
        )}

        {error && (
          <View className="items-center py-12">
            <Ionicons name="document-text" size={48} color="#80716b" />
            <Text className="text-sm text-muted-foreground mt-3 text-center">
              {error}
            </Text>
          </View>
        )}

        {receipt && (
          <>
            <View className="items-center py-6 border-b border-border mb-4">
              <View className="h-14 w-14 rounded-full bg-primary items-center justify-center mb-3">
                <Ionicons name="receipt" size={24} color="#fff" />
              </View>
              <Text className="text-lg font-extrabold text-foreground">
                {formatCurrency(total)}
              </Text>
              <Text className="text-xs text-muted-foreground mt-1">
                {receipt.receipt_number}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {new Date(receipt.completed_at || receipt.created_at || new Date()).toLocaleDateString("en-ZA", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>

            <View className="rounded-xl bg-surface border border-border p-4 mb-4">
              <Text className="text-xs font-bold text-muted-foreground uppercase mb-3">
                Driver
              </Text>
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 rounded-full bg-secondary items-center justify-center">
                  <Text className="text-sm font-bold text-foreground">
                    {(receipt.driver_name || "V").charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-foreground">
                    {receipt.driver_name || "Your Driver"}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {[receipt.vehicle_make, receipt.vehicle_model].filter(Boolean).join(" ")}{receipt.license_plate ? ` · ${receipt.license_plate}` : ""}
                  </Text>
                </View>
              </View>
            </View>

            <View className="rounded-xl bg-surface border border-border p-4 mb-4">
              <Text className="text-xs font-bold text-muted-foreground uppercase mb-3">
                Trip
              </Text>
              <View className="flex-row items-start gap-3">
                <View className="items-center pt-1.5">
                  <View className="w-2.5 h-2.5 rounded-full bg-foreground" />
                  <View className="w-px h-6 border-l-2 border-dashed border-muted-foreground/40" />
                  <View className="w-2.5 h-2.5 rounded-md bg-primary" />
                </View>
                <View className="flex-1 gap-y-3">
                  <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                    {receipt.pickup_address || "Pickup"}
                  </Text>
                  <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                    {receipt.destination_address || "Destination"}
                  </Text>
                </View>
              </View>

              <View className="mt-3 flex-row gap-4">
                <View className="flex-row items-center gap-1">
                  <Ionicons name="speedometer" size={14} color="#80716b" />
                  <Text className="text-xs text-muted-foreground">
                    {(receipt.distance_km || 0).toFixed(1)} km
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <Ionicons name="time" size={14} color="#80716b" />
                  <Text className="text-xs text-muted-foreground">
                    {receipt.duration_mins || 0} min
                  </Text>
                </View>
              </View>
            </View>

            <View className="rounded-xl bg-surface border border-border p-4 mb-4">
              <Text className="text-xs font-bold text-muted-foreground uppercase mb-3">
                Fare Breakdown
              </Text>
              <View className="gap-y-2">
                <View className="flex-row justify-between">
                  <Text className="text-sm text-foreground">Trip fare</Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {formatCurrency(receipt.fare)}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-foreground">Service fee</Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {formatCurrency(receipt.ride_request_fee)}
                  </Text>
                </View>
                {tipAmount != null && (
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-foreground">Driver tip</Text>
                    <Text className="text-sm font-semibold text-emerald-600">
                      {formatCurrency(tipAmount)}
                    </Text>
                  </View>
                )}
                <View className="border-t border-border my-1" />
                <View className="flex-row justify-between">
                  <Text className="text-sm font-bold text-foreground">Total</Text>
                  <Text className="text-sm font-extrabold text-foreground">
                    {formatCurrency(total)}
                  </Text>
                </View>
              </View>
            </View>

            <View className="rounded-xl bg-surface border border-border p-4 mb-4">
              <Text className="text-xs font-bold text-muted-foreground uppercase mb-3">
                Payment
              </Text>
              <View className="flex-row justify-between">
                <Text className="text-sm text-foreground">Method</Text>
                <Text className="text-sm font-semibold text-foreground capitalize">
                  {receipt.payment_method || "Cash"}
                </Text>
              </View>
              <View className="flex-row justify-between mt-2">
                <Text className="text-sm text-foreground">Status</Text>
                <View className="flex-row items-center gap-1">
                  <View
                    className={`w-2 h-2 rounded-full ${
                      receipt.payment_status === "completed"
                        ? "bg-emerald-500"
                        : "bg-amber-500"
                    }`}
                  />
                  <Text className="text-sm font-semibold text-foreground capitalize">
                    {receipt.payment_status}
                  </Text>
                </View>
              </View>
            </View>

            {!showTip && tipAmount == null && (
              <TouchableOpacity
                onPress={() => setShowTip(true)}
                className="flex-row items-center justify-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 py-3.5 mb-4"
              >
                <Ionicons name="heart" size={16} color="#16a34a" />
                <Text className="text-sm font-bold text-emerald-700">
                  Add a tip for {receipt.driver_name}
                </Text>
              </TouchableOpacity>
            )}

            {showTip && (
              <View className="rounded-xl bg-surface border border-border p-4 mb-4">
                <Text className="text-sm font-bold text-foreground mb-3">
                  Tip your driver
                </Text>
                <View className="flex-row flex-wrap gap-2 mb-3">
                  {tipSuggestions.map((opt) => (
                    <TouchableOpacity
                      key={opt.label}
                      onPress={() => handleTip(opt.amount)}
                      disabled={submittingTip}
                      className="flex-1 items-center rounded-xl bg-secondary border border-border py-3 min-w-[80px]"
                    >
                      <Text className="text-xs font-bold text-muted-foreground">
                        {opt.label}
                      </Text>
                      <Text className="text-sm font-extrabold text-foreground">
                        {formatCurrency(opt.amount)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <View className="gap-y-1">
                      <TextInput
                        placeholder="Custom amount"
                        placeholderTextColor="#80716b"
                        value={customTip}
                        onChangeText={setCustomTip}
                        keyboardType="numeric"
                        className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground"
                      />
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      const amt = parseFloat(customTip);
                      if (amt > 0) handleTip(amt);
                    }}
                    disabled={!customTip || submittingTip || parseFloat(customTip) <= 0}
                    className="rounded-xl bg-primary px-5 items-center justify-center"
                  >
                    {submittingTip ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text className="text-sm font-bold text-primary-foreground">
                        Send
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => setShowTip(false)}
                  className="mt-2 self-center"
                >
                  <Text className="text-xs font-semibold text-muted-foreground">
                    No thanks
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <View className="flex-row gap-2 mb-6">
              <TouchableOpacity
                onPress={() => router.push(`/dispute?rideId=${rideId}`)}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-border bg-surface py-3"
              >
                <Ionicons name="flag" size={14} color="#dc2626" />
                <Text className="text-xs font-bold text-foreground">
                  Report an issue
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push(`/lost-item?rideId=${rideId}`)}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-border bg-surface py-3"
              >
                <Ionicons name="search" size={14} color="#d97706" />
                <Text className="text-xs font-bold text-foreground">
                  Lost item
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
