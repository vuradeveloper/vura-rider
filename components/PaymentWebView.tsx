import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { WebView } from "react-native-webview";

type Props = {
  visible: boolean;
  fields: Record<string, string>;
  gatewayUrl: string;
  onDone: (result: { success: boolean; result?: string }) => void;
  onClose: () => void;
  savedCard?: boolean;
};

const API_BASE_URL =
  (typeof process !== "undefined" && (process as any).env?.EXPO_PUBLIC_API_URL) ||
  "http://92.4.135.243";

/**
 * Opens the iVeri (Nedbank) hosted payment page inside a WebView and
 * auto-submits the signed form returned by POST /api/payments/initiate.
 *
 * The gateway is told to redirect to a fake HTTPS URL
 * (https://vura-payments.local/return) that the WebView intercepts in
 * onShouldStartLoadWithRequest BEFORE any navigation attempt — the app then
 * forwards the payment result to the real server via native fetch(), which
 * works over HTTP without Android's mixed-content block.
 */
export default function PaymentWebView({ visible, fields, gatewayUrl, onDone, onClose, savedCard }: Props) {
  const [showForm, setShowForm] = useState(false);
  // Incremented on retry to force-mount a fresh WebView.
  const [webViewKey, setWebViewKey] = useState(0);
  // ── Error diagnostic state ─────────────────────────────────────────────
  const [errorUrl, setErrorUrl] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorDesc, setErrorDesc] = useState<string | null>(null);

  // Fire onDone exactly once per payment attempt.
  const reportedRef = useRef(false);

  // Reset state each time the modal is (re)opened.
  useEffect(() => {
    if (visible) {
      setShowForm(false);
      reportedRef.current = false;
      setErrorUrl(null);
      setErrorCode(null);
      setErrorDesc(null);
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
      return v === "0" || v === "success" ? "success" : v;
    } catch {
      return null;
    }
  };

  /** Forward the payment result query params to the real server. */
  const forwardReturnToServer = (url: string) => {
    const qIndex = url.indexOf("?");
    if (qIndex < 0) return;
    const query = url.substring(qIndex);
    fetch(`${API_BASE_URL}/api/payments/return${query}`).catch((e: Error) =>
      console.warn("[PaymentWebView] return forward failed", e.message)
    );
  };

  /** True when the url is the gateway's redirect back to us. */
  const isReturnUrl = (url: string) =>
    url.includes("/api/payments/return") || url.includes("vura-payments.local");

  /** Parse and report a return navigation (interceptor + fallback share this). */
  const handleReturn = (url: string) => {
    if (!isReturnUrl(url)) return false;
    forwardReturnToServer(url);
    const result = parseReturn(url);
    if (result !== null && !reportedRef.current) {
      reportedRef.current = true;
      onDone({ success: result === "success", result });
    }
    return true; // true = "was a return URL, we handled it"
  };

  const CustomErrorView = () => (
    <View style={{ flex: 1, backgroundColor: "#fff", padding: 24, justifyContent: "center" }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: "#c0392b", marginBottom: 12 }}>
        Payment page error
      </Text>
      <ScrollView style={{ marginBottom: 20 }}>
        {errorCode ? (
          <Text style={{ fontSize: 14, color: "#333", marginBottom: 6 }}>
            <Text style={{ fontWeight: "600" }}>Code: </Text>
            {errorCode}
          </Text>
        ) : null}
        {errorDesc ? (
          <Text style={{ fontSize: 14, color: "#333", marginBottom: 6 }}>
            <Text style={{ fontWeight: "600" }}>Description: </Text>
            {errorDesc}
          </Text>
        ) : null}
        {errorUrl ? (
          <View style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 4 }}>
              Failed URL:
            </Text>
            <Text
              style={{
                fontSize: 11,
                color: "#666",
                backgroundColor: "#f5f5f5",
                padding: 10,
                borderRadius: 6,
                fontFamily: "monospace",
                lineHeight: 16,
              }}
              selectable
            >
              {errorUrl}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <TouchableOpacity
        onPress={() => {
          setErrorUrl(null);
          setErrorCode(null);
          setErrorDesc(null);
          reportedRef.current = false;
          setWebViewKey((k) => k + 1);
        }}
        style={{
          backgroundColor: "#e04e2f",
          paddingVertical: 14,
          borderRadius: 10,
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Retry</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onClose} style={{ paddingVertical: 10, alignItems: "center" }}>
        <Text style={{ color: "#80716b", fontSize: 14 }}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

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
          key={webViewKey}
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
          renderError={() => <CustomErrorView />}
          onShouldStartLoadWithRequest={(request) => {
            const url = request.url || "";
            if (handleReturn(url)) return false;
            return true;
          }}
          onNavigationStateChange={(nav) => {
            const url = nav.url || "";
            if (isReturnUrl(url)) {
              forwardReturnToServer(url);
              const result = parseReturn(url);
              if (result !== null && !reportedRef.current) {
                reportedRef.current = true;
                onDone({ success: result === "success", result });
              }
            }
          }}
          onHttpError={(syntheticEvent) => {
            const { url, statusCode } = syntheticEvent.nativeEvent;
            console.warn("[PaymentWebView] HTTP error", statusCode, url);
          }}
          onError={(syntheticEvent) => {
            const { code, description, url } = syntheticEvent.nativeEvent;
            console.warn("[PaymentWebView] load error", code, description, url);
            // Store diagnostic info so the custom renderError can show it.
            setErrorUrl(url);
            setErrorCode(code != null ? String(code) : null);
            setErrorDesc(description || null);
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