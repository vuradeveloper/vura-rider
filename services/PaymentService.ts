import { Linking } from "react-native";
import InAppBrowser from "react-native-inappbrowser-reborn";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "@/lib/api";
import { getApiUrl } from "@/lib/config";

/**
 * Parses the redirect URL from the payment gateway (e.g. Payfast, Paystack)
 * to extract the reference or transaction ID. Returns null if it is a cancel/fallback URL.
 */
const parsePaymentReference = (urlStr: string): string | null => {
  const lowerUrl = urlStr.toLowerCase();
  if (
    lowerUrl.includes("/cancel") ||
    lowerUrl.includes("/fallback") ||
    lowerUrl.includes("status=cancelled") ||
    lowerUrl.includes("status=failed")
  ) {
    return null;
  }

  try {
    const url = new URL(urlStr);
    return (
      url.searchParams.get("reference") ||
      url.searchParams.get("trxref") ||
      url.searchParams.get("pf_payment_id") ||
      url.searchParams.get("m_payment_id") ||
      url.searchParams.get("payment_id") ||
      url.searchParams.get("paymentId")
    );
  } catch {
    // Regex fallback for deep links or custom schemes
    const params = ["reference", "trxref", "pf_payment_id", "m_payment_id", "payment_id", "paymentId"];
    for (const param of params) {
      const regex = new RegExp(`[?&]${param}=([^&#]*)`, "i");
      const match = urlStr.match(regex);
      if (match) return decodeURIComponent(match[1]);
    }
    return null;
  }
};

export const payForRide = async (rideId: string) => {
  try {
    const result = await apiFetch<any>("/api/payments/initialize", {
      method: "POST",
      body: JSON.stringify({ rideId, paymentMethod: "card" }),
    });

    if (result.status === "success") return { success: true, method: "saved_card" };
    if (result.paymentMethod === "cash") return { success: true, method: "cash" };

    if (result.authorizationUrl) {
      if (await InAppBrowser.isAvailable()) {
        const browserResult = await InAppBrowser.openAuth(
          result.authorizationUrl,
          getApiUrl("/api/payments/verify"),
          {
            showTitle: false,
            enableUrlBarHiding: true,
            enableDefaultShare: false,
          }
        );

        if (browserResult.type === "success") {
          const ref = parsePaymentReference(browserResult.url);
          if (!ref) return { success: false, error: "Payment was cancelled or reference is missing" };
          const verify = await apiFetch<any>(`/api/payments/verify?reference=${ref}`);
          return { success: verify.status === "success", method: "card" };
        }
      } else {
        Linking.openURL(result.authorizationUrl);
      }
    }

    return { success: false, error: "Payment cancelled" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};

export const payWithCash = async (rideId: string) => {
  return apiFetch("/api/payments/initialize", {
    method: "POST",
    body: JSON.stringify({ rideId, paymentMethod: "cash" }),
  });
};

export const getSavedCards = async () => {
  try {
    const cards = await apiFetch("/api/payments/methods");
    await AsyncStorage.setItem("vura.saved_cards", JSON.stringify(cards));
    return cards;
  } catch {
    const local = await AsyncStorage.getItem("vura.saved_cards");
    if (local) {
      try { return JSON.parse(local); } catch {}
    }
    return [];
  }
};

export const removeCard = async (cardId: string) => {
  try {
    await apiFetch(`/api/payments/methods/${cardId}`, { method: "DELETE" });
  } catch {}
  try {
    const local = await AsyncStorage.getItem("vura.saved_cards");
    if (local) {
      const cards = JSON.parse(local);
      const filtered = cards.filter((c: any) => c.id !== cardId);
      await AsyncStorage.setItem("vura.saved_cards", JSON.stringify(filtered));
    }
  } catch {}
  return { success: true };
};

export const addCard = async (cardData: {
  card_type: string;
  last4: string;
  bank?: string;
  exp_month?: number;
  exp_year?: number;
}): Promise<{ success: boolean; error?: string }> => {
  try {
    const result = await apiFetch<any>("/api/payments/methods", {
      method: "POST",
      body: JSON.stringify(cardData),
    });

    if (result && result.id) {
      try {
        const local = await AsyncStorage.getItem("vura.saved_cards");
        const cards = local ? JSON.parse(local) : [];
        cards.forEach((c: any) => { c.is_default = false; });
        cards.unshift(result);
        await AsyncStorage.setItem("vura.saved_cards", JSON.stringify(cards));
      } catch {}
      return { success: true };
    }
  } catch (err: any) {
    // Fallback to local storage if backend is unavailable or unauthenticated (401)
    try {
      const newCard = {
        id: "local_" + Date.now(),
        card_type: cardData.card_type,
        last4: cardData.last4,
        bank: cardData.bank || null,
        exp_month: cardData.exp_month,
        exp_year: cardData.exp_year,
        is_default: true,
      };
      const local = await AsyncStorage.getItem("vura.saved_cards");
      const cards = local ? JSON.parse(local) : [];
      cards.forEach((c: any) => { c.is_default = false; });
      cards.unshift(newCard);
      await AsyncStorage.setItem("vura.saved_cards", JSON.stringify(cards));
      return { success: true };
    } catch (localErr: any) {
      return { success: false, error: localErr.message || err.message || "Failed to add card" };
    }
  }
  return { success: false, error: "Failed to add card" };
};
