import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";

type Props = {
  visible: boolean;
  fields: Record<string, string>;
  gatewayUrl: string;
  onDone: (result: { success: boolean; result?: string }) => void;
  onClose: () => void;
  // When a saved card (iVeri TransactionIndex) is being used, the hosted form
  // is pre-filled and auto-submits. Show a lightweight "processing" overlay so
  // the rider never sees the card-entry form again.
  savedCard?: boolean;
};

// Opens the iVeri (Nedbank) hosted payment page inside a WebView and
// auto-submits the signed form returned by POST /api/payments/initiate.
export default function PaymentWebView({ visible, fields, gatewayUrl, onDone, onClose, savedCard }: Props) {
  const [showForm, setShowForm] = useState(false);
  // Fire onDone exactly once per payment attempt. The return is detected from
  // the redirect URL (below), which can surface both as a navigation callback
  // and as the gateway's own redirect — without this guard onDone would be
  // called twice and book a ride twice.
  const reportedRef = useRef(false);

  // Reset the overlay + the "reported" guard each time the modal is (re)opened.
  useEffect(() => {
    if (visible) {
      setShowForm(false);
      reportedRef.current = false;
    }
  }, [visible]);
  const formHtml = useMemo(() => {
    if (!gatewayUrl) return "<html><body></body></html>";
    const inputs = Object.entries(fields)
      .map(
        ([k, v]) =>
          `<input type="hidden" name="${k.replace(/"/g, "&quot;")}" value="${String(v).replace(/"/g, "&quot;")}">`
      )
      .join("");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
      <form id="iveri" method="POST" action="${gatewayUrl}">${inputs}</form>
      <script>document.getElementById("iveri").submit();</script>
    </body></html>`;
  }, [fields, gatewayUrl]);

  const parseReturn = (url: string): string | null => {
    try {
      const m = url.match(/[?&](result|status)=([^&]+)/i);
      if (!m) return null;
      const v = m[2].toLowerCase();
      // iVeri Lite returns result=0 for approved transactions.
      return v === "0" || v === "success" ? "success" : v;
    } catch {
      return null;
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        {/* Branded header */}
        <View
          style={{
            backgroundColor: "#2e1e1a",
            paddingTop: 14,
            paddingBottom: 12,
            paddingHorizontal: 16,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: "#e04e2f",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>V</Text>
              </View>
              <View>
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                  {savedCard ? "Confirm payment" : "Add a card"}
                </Text>
                <Text style={{ color: "#d8cbc4", fontSize: 11 }}>
                  Secured by Nedbank iVeri
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 6,
                borderRadius: 20,
                backgroundColor: "rgba(255,255,255,0.12)",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
        <WebView
          source={{ html: formHtml }}
          originWhitelist={["*"]}
          mixedContentMode="always"
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fbf7f4" }}>
              <ActivityIndicator size="large" color="#e04e2f" />
              <Text style={{ marginTop: 14, fontSize: 13, color: "#80716b" }}>
                Loading secure payment…
              </Text>
            </View>
          )}
          onShouldStartLoadWithRequest={(request) => {
            const url = request.url || "";
            // Detect the gateway's redirect back to our server's return URL.
            // The token (Lite_TransactionIndex) which saves the card for auto-pay
            // comes ONLY in this redirect URL. We MUST forward it to the server
            // via the app's native network layer (which works over HTTP) BEFORE
            // blocking the WebView navigation that otherwise ERR_CONNECTION_REFUSED.
            if (url.includes("/api/payments/return")) {
              // 1) Forward the full URL to the server so it records the payment
              //    and the token. Fire-and-forget — the server already handles
              //    the idempotent upsert.
              fetch(url).catch((e: Error) =>
                console.warn("[PaymentWebView] return forward failed", e.message)
              );
              // 2) Parse the outcome from the URL so the app responds.
              const result = parseReturn(url);
              if (result !== null && !reportedRef.current) {
                reportedRef.current = true;
                onDone({ success: result === "success", result });
              }
              // 3) Block the WebView from trying to render the HTTP page.
              return false;
            }
            return true;
          }}
          onNavigationStateChange={(nav) => {
            const url = nav.url || "";
            // Fallback if onShouldStartLoadWithRequest was not triggered.
            if (url.includes("/api/payments/return")) {
              const result = parseReturn(url);
              if (result !== null && !reportedRef.current) {
                reportedRef.current = true;
                onDone({ success: result === "success", result });
              }
            }
          }}
          onHttpError={(syntheticEvent) => {
            // Surface the exact failing URL/status instead of Android's opaque
            // "Domain: undefined / ERR_CONNECTION_REFUSED" so support calls are
            // based on facts, not guesses.
            const { url, statusCode } = syntheticEvent.nativeEvent;
            console.warn("[PaymentWebView] HTTP error", statusCode, url);
          }}
          onError={(syntheticEvent) => {
            const { code, description, url } = syntheticEvent.nativeEvent;
            console.warn("[PaymentWebView] load error", code, description, url);
          }}
          style={{ flex: 1 }}
        />
        {savedCard && !showForm ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "#fff",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 32,
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: "#fdeee9",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ActivityIndicator size="large" color="#e04e2f" />
            </View>
            <Text style={{ marginTop: 20, fontSize: 17, fontWeight: "700", color: "#2e1e1a", textAlign: "center" }}>
              Processing payment…
            </Text>
            <Text style={{ marginTop: 8, fontSize: 13, color: "#80716b", textAlign: "center", lineHeight: 19 }}>
              We're charging your saved card. Your ride won't be booked until the payment is confirmed.
            </Text>
            <TouchableOpacity onPress={() => setShowForm(true)} style={{ marginTop: 20, padding: 8 }}>
              <Text style={{ fontSize: 13, color: "#e04e2f", fontWeight: "600" }}>
                View payment page
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
