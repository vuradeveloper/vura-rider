import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";

type Props = {
  visible: boolean;
  fields: Record<string, string>;
  gatewayUrl: string;
  onDone: (result: { success: boolean; result?: string }) => void;
  onClose: () => void;
  savedCard?: boolean;
  /** Payment reference returned by the initiate/card-register endpoint.
   *  When provided, the component polls GET /api/payments/verify?reference=
   *  every 3 seconds as a fallback — the gateway's S2S callback updates the
   *  DB asynchronously, so even if the WebView redirect fails (Android
   *  blocks HTTPS→HTTP), the app eventually detects the success. */
  reference?: string;
};

const API_BASE_URL =
  (typeof process !== "undefined" && (process as any).env?.EXPO_PUBLIC_API_URL) ||
  "http://92.4.135.243";

/**
 * Opens the iVeri (Nedbank) hosted payment page inside a WebView and
 * auto-submits the signed form returned by POST /api/payments/initiate.
 *
 * The gateway is told to redirect to a fake HTTPS URL
 * (https://vura-payments.local/return) — Android doesn't block HTTPS→?
 * navigation. The redirect is caught in onShouldStartLoadWithRequest AND
 * as a fallback the app polls the server for payment status via the
 * reference prop (the gateway's S2S callback updates the DB directly).
 */
export default function PaymentWebView({
  visible,
  fields,
  gatewayUrl,
  onDone,
  onClose,
  savedCard,
  reference,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);

  // ── Error diagnostic state ─────────────────────────────────────────────
  const [errorUrl, setErrorUrl] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorDesc, setErrorDesc] = useState<string | null>(null);

  // ── Polling state ──────────────────────────────────────────────────────
  const [pollStatus, setPollStatus] = useState<"idle" | "polling" | "timeout">("idle");

  // Fire onDone exactly once per payment attempt.
  const reportedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Reset state each time the modal is (re)opened.
  useEffect(() => {
    if (visible) {
      setShowForm(false);
      reportedRef.current = false;
      setErrorUrl(null);
      setErrorCode(null);
      setErrorDesc(null);
      setPollStatus("idle");
    }
  }, [visible]);

  // ── Polling: after the WebView is visible and we have a reference, check
  // the server every 3 seconds. The gateway's S2S callback (Lite_Server_Server_Url)
  // posts the payment result to our /api/payments/return, which updates the DB.
  // Once the poll sees "completed" or "failed", we call onDone and stop.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const startPolling = useCallback(() => {
    if (!reference || reportedRef.current || stoppedRef.current) return;

    stoppedRef.current = false;
    setPollStatus("polling");

    // Safety timeout — give up after 60 seconds.
    pollTimeoutRef.current = setTimeout(() => {
      if (!stoppedRef.current) {
        stoppedRef.current = true;
        setPollStatus("timeout");
      }
    }, 60000);

    const check = async () => {
      if (stoppedRef.current || reportedRef.current) return;
      try {
        const res = await fetch(`${API_BASE_URL}/api/payments/verify?reference=${encodeURIComponent(reference!)}`);
        const data = await res.json();
        if (stoppedRef.current || reportedRef.current) return;

        const s = data.status?.toLowerCase();
        if (s === "completed" || s === "success") {
          stoppedRef.current = true;
          reportedRef.current = true;
          if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          onDoneRef.current({ success: true, result: "completed" });
        } else if (s === "failed" || s === "cancelled" || s === "declined" || s === "error") {
          stoppedRef.current = true;
          reportedRef.current = true;
          if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          onDoneRef.current({ success: false, result: s });
        }
      } catch {
        // Network error — keep polling
      }
    };

    // Check immediately, then every 3s
    check();
    pollIntervalRef.current = setInterval(check, 3000);
  }, [reference]);

  const stopPolling = useCallback(() => {
    stoppedRef.current = true;
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
  }, []);

  // Start/stop polling based on visibility + reference.
  useEffect(() => {
    if (visible && reference) {
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [visible, reference, startPolling, stopPolling]);

  // ── WebView handling ────────────────────────────────────────────────────
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

  const forwardReturnToServer = (url: string) => {
    const qIndex = url.indexOf("?");
    if (qIndex < 0) return;
    const query = url.substring(qIndex);
    fetch(`${API_BASE_URL}/api/payments/return${query}`).catch((e: Error) =>
      console.warn("[PaymentWebView] return forward failed", e.message)
    );
  };

  const isReturnUrl = (url: string) =>
    url.includes("/api/payments/return") || url.includes("vura-payments.local");

  const handleReturn = (url: string) => {
    if (!isReturnUrl(url)) return false;
    forwardReturnToServer(url);
    const result = parseReturn(url);
    if (result !== null && !reportedRef.current) {
      reportedRef.current = true;
      stopPolling();
      onDone({ success: result === "success", result });
    }
    return true;
  };

  // ── Error / Waiting view ────────────────────────────────────────────────
  const CustomErrorView = () => {
    // If we're polling, show a calm "checking status" screen instead of an error.
    if (pollStatus === "polling" || pollStatus === "timeout") {
      return (
        <View style={{ flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", padding: 32 }}>
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
            {pollStatus === "timeout" ? "Still waiting…" : "Checking payment status…"}
          </Text>
          <Text style={{ marginTop: 8, fontSize: 13, color: "#80716b", textAlign: "center", lineHeight: 19 }}>
            {pollStatus === "timeout"
              ? "The payment page could not load, but your payment may still have gone through. Check your bank or tap Cancel."
              : "Nedbank is processing your payment. This should only take a few seconds."}
          </Text>
          <TouchableOpacity
            onPress={() => {
              stopPolling();
              setPollStatus("timeout");
            }}
            style={{ marginTop: 24, paddingVertical: 10, paddingHorizontal: 20 }}
          >
            <Text style={{ color: "#e04e2f", fontSize: 14, fontWeight: "600" }}>Cancel & check later</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Plain error with full diagnostics (no reference / not polling).
    return (
      <View style={{ flex: 1, backgroundColor: "#fff", padding: 24, justifyContent: "center" }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: "#2e1e1a", marginBottom: 12, textAlign: "center" }}>
          Payment page error
        </Text>
        {errorUrl ? (
          <Text
            style={{
              fontSize: 11,
              color: "#666",
              backgroundColor: "#f5f5f5",
              padding: 10,
              borderRadius: 6,
              fontFamily: "monospace",
              lineHeight: 16,
              marginBottom: 12,
            }}
            selectable
          >
            {errorUrl}
          </Text>
        ) : null}
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
        {pollStatus === "polling" ||
        (pollStatus === "timeout" && errorUrl) ? (
          // Show polling/waiting overlay on top of everything
          <View style={{ flex: 1 }}>
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
                    stopPolling();
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
                setErrorUrl(url);
                setErrorCode(code != null ? String(code) : null);
                setErrorDesc(description || null);
              }}
              style={{ flex: 1 }}
            />
            {/* Polling indicator bar at bottom */}
            {pollStatus === "polling" ? (
              <View
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  backgroundColor: "#fff",
                  borderTopWidth: 1,
                  borderTopColor: "#eee",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <ActivityIndicator size="small" color="#e04e2f" />
                <Text style={{ fontSize: 12, color: "#80716b" }}>
                  Confirming payment with server…
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
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
                  stopPolling();
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
              setErrorUrl(url);
              setErrorCode(code != null ? String(code) : null);
              setErrorDesc(description || null);
            }}
            style={{ flex: 1 }}
          />
        )}
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