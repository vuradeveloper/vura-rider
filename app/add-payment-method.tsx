import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { registerPaystackCard } from "@/services/PaymentService";
import PaymentWebView from "@/components/PaymentWebView";

export default function AddPaymentMethod() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isStarting, setIsStarting] = useState(false);
  const [paystackVisible, setPaystackVisible] = useState(false);
  const [paystackUrl, setPaystackUrl] = useState("");
  const [paystackReference, setPaystackReference] = useState<string | undefined>();
  const [verified, setVerified] = useState(false);

  const navigateBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/wallet");
    }
  };

  useEffect(() => {
    if (verified) {
      const timer = setTimeout(navigateBack, 2000);
      return () => clearTimeout(timer);
    }
  }, [verified]);

  const startSecureAdd = async () => {
    setIsStarting(true);
    try {
      const result = await registerPaystackCard();
      if (result.mock) {
        Alert.alert(
          "Payments are in test mode",
          "Your server is in mock payment mode (PAYMENTS_MODE=mock). Fill in the PAYSTACK_* values in server/.env to go live.",
          [{ text: "OK" }]
        );
        return;
      }
      setPaystackUrl(result.authorizationUrl || "");
      setPaystackReference(result.reference || undefined);
      setPaystackVisible(true);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not start secure card setup");
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="px-5 pt-4 pb-2 bg-surface border-b border-border">
        <View className="flex-row items-center justify-between">
          <TouchableOpacity
            onPress={navigateBack}
            className="w-9 h-9 rounded-full bg-secondary items-center justify-center"
          >
            <Ionicons name="arrow-back" size={16} color="#2e1e1a" />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-foreground">
            Add Payment Method
          </Text>
          <View className="w-9 h-9" />
        </View>
      </View>

      <ScrollView className="flex-1 px-5 pt-6" showsVerticalScrollIndicator={false}>
        {verified ? (
          <View className="items-center mt-20 mb-6">
            <View className="w-24 h-24 rounded-full bg-emerald-100 items-center justify-center">
              <Ionicons name="checkmark-circle" size={56} color="#16a34a" />
            </View>
            <Text className="mt-4 text-xl font-extrabold text-emerald-700 text-center">
              Verified
            </Text>
          </View>
        ) : (
          <>
            <View className="items-center mt-2 mb-6">
              <View className="w-20 h-20 rounded-full bg-primary/10 items-center justify-center">
                <Ionicons name="card" size={40} color="#e04e2f" />
              </View>
              <Text className="mt-4 text-xl font-extrabold text-foreground text-center">
                Add a card
              </Text>
            </View>

            <TouchableOpacity
              onPress={startSecureAdd}
              disabled={isStarting}
              className={`w-full rounded-xl bg-white border border-border py-4 items-center ${isStarting ? "opacity-60" : ""}`}
            >
              {isStarting ? (
                <ActivityIndicator size="small" color="#e04e2f" />
              ) : (
                <View className="flex-row items-center gap-2">
                  <Ionicons name="lock-closed" size={16} color="#2e1e1a" />
                  <Text className="text-sm font-bold text-foreground">
                    Continue to secure payment
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <PaymentWebView
        visible={paystackVisible}
        authorizationUrl={paystackUrl}
        reference={paystackReference}
        onClose={() => {
          setPaystackVisible(false);
        }}
        onDone={({ success }) => {
          setPaystackVisible(false);
          if (success) {
            queryClient.invalidateQueries({ queryKey: ["saved-cards"] });
            setVerified(true);
          } else {
            Alert.alert(
              "Card not added",
              "The payment page did not complete. No card was saved. Please try again."
            );
          }
        }}
      />
    </SafeAreaView>
  );
}