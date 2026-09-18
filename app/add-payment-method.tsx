import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { WebView } from "react-native-webview";
import { registerPaystackCard } from "@/services/PaymentService";
import { apiFetch } from "@/lib/api";

export default function AddPaymentMethod() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isStarting, setIsStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  // Remember the in-flight Paystack transaction so "Continue" RESUMES the same
  // one instead of creating a brand-new R1 hold every time.
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [pendingResumeUrl, setPendingResumeUrl] = useState<string>("");

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

  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const startSecureAdd = async () => {
    setIsStarting(true);
    try {
      setVerifying(true);

      // RESUME the exact same Paystack transaction if one is still in-flight.
      // ONLY create a new R1 auth when there's nothing pending — otherwise the
      // rider stacks another R1 hold on every retry.
      let reference = pendingRef;
      let authorizationUrl = pendingResumeUrl;

      if (!reference || !authorizationUrl) {
        const result = await registerPaystackCard();
        if (result.mock && !result.authorizationUrl) {
          Alert.alert(
            "Payments are in test mode",
            "Your server is in mock payment mode (PAYMENTS_MODE=mock). Fill in the PAYSTACK_* values in server/.env to go live.",
            [{ text: "OK" }]
          );
          setVerifying(false);
          return;
        }
        if (!result.authorizationUrl) {
          Alert.alert("Error", "No payment page was returned by the server.");
          setVerifying(false);
          return;
        }
        reference = result.reference;
        authorizationUrl = result.authorizationUrl;
        setPendingRef(reference);
        setPendingResumeUrl(authorizationUrl);
      }

      // The original checkout page from Paystack is RESUMABLE. When the bank
      // raises a 3-D Secure challenge (transaction status "ongoing") we reopen
      // this same URL so the rider can complete the approval on the bank's
      // page — exactly what Paystack's docs direct for `paused` transactions.
      let resumeUrl: string | null = authorizationUrl;

      // Open Paystack INSIDE the app in an embedded WebView so the rider never
      // context-switches out of the app (external in-app browsers can fail the
      // return-redirect on some devices and make the R1 look "taken").
      const openCheckout = () => {
        setCheckoutUrl(resumeUrl || authorizationUrl);
      };

      // First opening — fire-and-forget so polling starts immediately.
      openCheckout();

      // Poll the server until it sees the card saved (or the transaction ends).
      // Status `pending` means the bank is still waiting on 3-D Secure — keep
      // polling. Deadlines only stop this loop after a generous window.
      const deadline = Date.now() + 300000; // 5 min automatic cap
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      while (Date.now() < deadline) {
        await sleep(3000);
        const verify = await apiFetch<any>(
          `/api/payments/verify?reference=${reference}`
        ).catch(() => null);
        const status = verify?.status;
        if (!status) continue;
        if (status === "success" || status === "completed" || status === "refunded") {
          setPendingRef(null);
          setPendingResumeUrl("");
          setCheckoutUrl(null);
          queryClient.invalidateQueries({ queryKey: ["saved-cards"] });
          setVerifying(false);
          setVerified(true);
          return;
        }
        // Genuine terminal failures from the server.
        if (status === "abandoned" || status === "failed") {
          setPendingRef(null);
          setPendingResumeUrl("");
          setCheckoutUrl(null);
          setVerifying(false);
          Alert.alert(
            "Card not added",
            `The payment page didn't complete — Paystack said: ${status}. No card was saved. Check the card details and try again.`
          );
          return;
        }
        // Pending / ongoing (3-D Secure waiting): update the resume URL from the
        // server (it stores the checkout link) so a "Continue" re-opens the
        // same page without a brand-new R1 hold.
        if (verify?.authorizationUrl) resumeUrl = verify.authorizationUrl;
      }
      // Server still says pending after 5 min: the bank approval never came
      // through in the checkout. Keep the pending ref so the next tap on
      // "Continue" RESUMES the SAME transaction (no new R1) — and tell the
      // rider to finish it inside the card page.
      setCheckoutUrl(null);
      setVerifying(false);
      Alert.alert(
        "Almost there",
        "Your bank may be waiting for you to approve this (3-D Secure / OTP) before we can save the card. Tap Continue to reopen the payment page and finish the approval — the card saves the moment it's approved. The R1 shown on your card is a temporary hold and is always returned."
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
                    {pendingRef ? "Continue with your bank…" : "Continue to secure payment"}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* In-app Paystack checkout — keeps the rider inside our app. */}
      {checkoutUrl ? (
        <Modal
          visible={!!checkoutUrl}
          animationType="slide"
          onRequestClose={() => setCheckoutUrl(null)}
        >
          <View className="flex-1 bg-white pt-12">
            <View className="flex-row items-center justify-between px-4 py-3 bg-surface border-b border-border">
              <TouchableOpacity
                onPress={() => setCheckoutUrl(null)}
                className="w-9 h-9 rounded-full bg-secondary items-center justify-center"
              >
                <Ionicons name="close" size={20} color="#2e1e1a" />
              </TouchableOpacity>
              <Text className="text-base font-bold text-foreground">
                Secure card payment
              </Text>
              <View className="w-9 h-9" />
            </View>
            <WebView
              source={{ uri: checkoutUrl }}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              onShouldStartLoadWithRequest={(req) => {
                // When Paystack redirects to our callback we don't need to load
                // it in the WebView — the poll verifies and closes this modal.
                if (req.url && req.url.includes("/api/payments/return")) {
                  setCheckoutUrl(null);
                  return false;
                }
                return true;
              }}
              onNavigationStateChange={(nav) => {
                // Backup: some Paystack redirects happen inside the WebView
                // (3-D Secure, bank redirects) that miss the load-request hook.
                if (nav.url && nav.url.includes("/api/payments/return")) {
                  setCheckoutUrl(null);
                }
              }}
            />
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}