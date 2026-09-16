import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import InAppBrowser from "react-native-inappbrowser-reborn";
import {
  registerPaystackCard,
  parsePaymentReference,
} from "@/services/PaymentService";
import { getApiUrl } from "@/lib/config";
import { apiFetch } from "@/lib/api";

export default function AddPaymentMethod() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isStarting, setIsStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
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
      if (result.mock && !result.authorizationUrl) {
        Alert.alert(
          "Payments are in test mode",
          "Your server is in mock payment mode (PAYMENTS_MODE=mock). Fill in the PAYSTACK_* values in server/.env to go live.",
          [{ text: "OK" }]
        );
        return;
      }
      if (!result.authorizationUrl) {
        Alert.alert("Error", "No payment page was returned by the server.");
        return;
      }

      setVerifying(true);
      let reference = result.reference;
      const callbackUrl = getApiUrl("/api/payments/return");

      if (await InAppBrowser.isAvailable()) {
        const browserResult = await InAppBrowser.openAuth(
          result.authorizationUrl,
          callbackUrl,
          { showTitle: false, enableUrlBarHiding: true, enableDefaultShare: false }
        );
        if (browserResult.type === "success") {
          const parsedRef = parsePaymentReference(browserResult.url);
          if (parsedRef) reference = parsedRef;
        }
        // NOTE: on `dismiss`/`cancel` we do NOT bail out. The user may have
        // finished the payment and then closed the tab — the R1 auth can be
        // successfully charged while the browser reports "dismiss". We fall
        // through to the poll below; only the SERVER's verify verdict decides
        // whether the card was actually saved.
      } else {
        // No in-app browser available — fall back to the system browser.
        Linking.openURL(result.authorizationUrl);
      }

      // Poll the server until it sees the card saved (or the transaction ends).
      // With 3-D Secure the user may need to approve in their banking app —
      // allow up to 3 minutes for that, then keep the page open so they can
      // tap "Done" and check again.
      const deadline = Date.now() + 180000; // 3 min automatic cap
      let lastStatus: string | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const verify = await apiFetch<any>(
          `/api/payments/verify?reference=${reference}`
        ).catch(() => null);
        const status = verify?.status;
        if (!status) continue;
        lastStatus = status;
        if (status === "success" || status === "completed" || status === "refunded") {
          queryClient.invalidateQueries({ queryKey: ["saved-cards"] });
          setVerifying(false);
          setVerified(true);
          return;
        }
        // pending / ongoing (3-D Secure waiting) is NOT a failure — keep polling.
        if (status === "abandoned" || status === "failed") {
          setVerifying(false);
          Alert.alert(
            "Card not added",
            `The payment page didn't complete — Paystack said: ${status}. No card was saved. Check the card details and try again.`
          );
          return;
        }
      }
      // Server still says pending after 3 min: the bank may be waiting on 3-D
      // Secure approval. Let the rider check again without losing their place.
      setVerifying(false);
      Alert.alert(
        "Almost there",
        "Your bank may be waiting for you to approve this (3-D Secure / OTP). If you completed it, tap Continue again to finish adding your card."
      );
    } catch (e: any) {
      setVerifying(false);
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
              disabled={isStarting || verifying}
              className={`w-full rounded-xl bg-white border border-border py-4 items-center ${isStarting || verifying ? "opacity-60" : ""}`}
            >
              {isStarting || verifying ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#e04e2f" />
                  <Text className="text-sm font-bold text-foreground">
                    {verifying ? "Confirming with bank…" : "Starting…"}
                  </Text>
                </View>
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
    </SafeAreaView>
  );
}