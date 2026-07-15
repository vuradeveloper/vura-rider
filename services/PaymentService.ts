import { Linking } from "react-native";
import InAppBrowser from "react-native-inappbrowser-reborn";
import { apiFetch } from "@/lib/api";
import { getApiUrl } from "@/lib/config";

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
          const url = new URL(browserResult.url);
          const ref = url.searchParams.get("reference") || url.searchParams.get("trxref");
          if (!ref) return { success: false, error: "Payment reference missing" };
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

export const getSavedCards = async () => apiFetch("/api/payments/methods");

export const removeCard = async (cardId: string) =>
  apiFetch(`/api/payments/methods/${cardId}`, { method: "DELETE" });
