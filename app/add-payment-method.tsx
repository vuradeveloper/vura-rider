import { useRouter } from "expo-router";
import { useState } from "react";
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
import { registerIveriCard } from "@/services/PaymentService";
import PaymentWebView from "@/components/PaymentWebView";

export default function AddPaymentMethod() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isStarting, setIsStarting] = useState(false);
  const [iveriVisible, setIveriVisible] = useState(false);
  const [iveriFields, setIveriFields] = useState<Record<string, string>>({});
  const [iveriGateway, setIveriGateway] = useState("");
  const [iveriReference, setIveriReference] = useState<string | undefined>();

  const navigateBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/wallet");
    }
  };

  const startSecureAdd = async () => {
    setIsStarting(true);
    try {
      const result = await registerIveriCard();
      if (result.mock) {
        Alert.alert(
          "Payments are in test mode",
          "Your server is in mock payment mode (PAYMENTS_MODE=mock). No real card is charged. Fill in the IVERI_* values in server/.env to go live.",
          [{ text: "OK" }]
        );
        return;
      }
      setIveriFields(result.fields || {});
      setIveriGateway(result.gatewayUrl || "");
      setIveriReference(result.reference || undefined);
      setIveriVisible(true);
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
        <View className="items-center mt-2 mb-6">
          <View className="w-20 h-20 rounded-full bg-primary/10 items-center justify-center">
            <Ionicons name="card" size={40} color="#e04e2f" />
          </View>
          <Text className="mt-4 text-xl font-extrabold text-foreground text-center">
            Add a card securely
          </Text>
          <Text className="mt-2 text-sm text-muted-foreground text-center leading-relaxed max-w-[300px]">
            We'll take you to a secure Nedbank payment page to add your card.
            Your card details are never stored on our servers.
          </Text>
        </View>

        <View className="flex-row items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl mb-6">
          <Ionicons name="shield-checkmark" size={22} color="#059669" />
          <View className="flex-1">
            <Text className="text-xs font-bold text-emerald-800">
              Safe & Secure Processing
            </Text>
            <Text className="text-[11px] text-emerald-600 leading-normal mt-0.5">
              Your full card number and CVV never touch our servers. Payments are
              processed on Nedbank's PCI-compliant page.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={startSecureAdd}
          disabled={isStarting}
          className={`w-full rounded-xl bg-primary py-4 items-center ${isStarting ? "opacity-60" : ""}`}
        >
          {isStarting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <View className="flex-row items-center gap-2">
              <Ionicons name="lock-closed" size={16} color="#fff" />
              <Text className="text-sm font-bold text-primary-foreground">
                Continue to secure payment
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <Text className="mt-4 text-[11px] text-muted-foreground text-center leading-relaxed">
          By continuing you agree to save this card for future rides. You can
          remove it anytime from your wallet.
        </Text>
      </ScrollView>

      <PaymentWebView
        visible={iveriVisible}
        fields={iveriFields}
        gatewayUrl={iveriGateway}
        reference={iveriReference}
        onClose={() => {
          setIveriVisible(false);
        }}
        onDone={({ success }) => {
          setIveriVisible(false);
          if (success) {
            queryClient.invalidateQueries({ queryKey: ["saved-cards"] });
            Alert.alert(
              "Card Added",
              "Your card was added and saved securely. You'll never need to re-enter it when paying for a ride.",
              [{ text: "OK", onPress: navigateBack }]
            );
            setTimeout(navigateBack, 100);
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