import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { WebView } from "react-native-webview";

type Props = {
  visible: boolean;
  /** Paystack hosted-checkout URL to load in the WebView. */
  authorizationUrl: string;
  onDone: (result: { success: boolean; result?: string }) => void;
  onClose: () => void;
  savedCard?: boolean;
  /** Payment reference returned by the card-register/initiate endpoint.
   *  When provided, the component polls GET /api/payments/verify?reference=
   *  every 3 seconds as a fallback — so even if the WebView redirect fails
   *  (Android blocks HTTPS→HTTP), the app eventually detects the success. */
  reference?: string;
};

const API_BASE_URL =
  (typeof process !== "undefined" && (process as any).env?.EXPO_PUBLIC_API_URL) ||
  "http://92.4.135.243";

/** Web-only: opens the Paystack checkout in a new browser tab and shows a
 *  waiting screen since react-native-webview is unsupported on web. */
function WebCheckoutScreen({
  authorizationUrl,
  retryKey,
  pollStatus,
  onClose,
}: {
  authorizationUrl: string;
  retryKey: number;
  pollStatus: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (authorizationUrl && authorizationUrl !== "about:blank") {
      window.open(authorizationUrl, "_blank");
    }
  }, [authorizationUrl, retryKey]);

  return (
    <View style={{ flex: 1, backgroundColor: "#fbf7f4", alignItems: "center", justifyContent: "center", padding: 32 }}>
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
        {pollStatus === "timeout" ? "Still waiting…" : "Waiting for payment…"}
      </Text>
      <Text style={{ marginTop: 8, fontSize: 13, color: "#80716b", textAlign: "center", lineHeight: 19 }}>
        Paystack checkout opened in a new tab. Complete the payment there, then return here.
      </Text>
      <TouchableOpacity
        onPress={() => {
          if (authorizationUrl && authorizationUrl !== "about:blank") {
            window.open(authorizationUrl, "_blank");
          }
        }}
        style={{
          marginTop: 24,
          backgroundColor: "#e04e2f",
          paddingVertical: 14,
          paddingHorizontal: 24,
          borderRadius: 10,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>
          Open payment page again
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onClose} style={{ marginTop: 12, paddingVertical: 10 }}>
        <Text style={{ color: "#80716b", fontSize: 14 }}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Opens the Paystack hosted payment page inside a WebView and lets the rider
 * enter card details on Paystack's PCI-compliant page.
 *
 * After payment, Paystack redirects the browser to PAYSTACK_CALLBACK_URL
 * (/api/payments/return). The redirect is caught in
 * onShouldStartLoadWithRequest AND the app polls the server for payment status
 * via the reference prop as a fallback (the server calls Paystack's verify
 * endpoint and records the result, including the card's authorization token).
 */
export default function PaymentWebView({
  visible,
  authorizationUrl,
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

  // ── Polling: after the WebView is visible and we have a reference, check
  // the server every 3 seconds. The server verifies the Paystack transaction
  // (GET /api/payments/verify) and updates the DB. Once the poll sees
  // "completed" or "failed", we call onDone and stop.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const stopPolling = useCallback(() => {
    stoppedRef.current = true;
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  // Reset state each time the modal is (re)opened. IMPORTANT: stoppedRef and
  // reportedRef MUST be cleared here so startPolling() below can actually run
  // when the modal opens — otherwise it bails immediately (the effect's cleanup
  // calls stopPolling(), which flips stoppedRef to true before the body runs).
  useEffect(() => {
    if (visible) {
      setShowForm(false);
      reportedRef.current = false;
      stoppedRef.current = false;
      setErrorUrl(null);
      setErrorCode(null);
      setErrorDesc(null);
      setPollStatus("idle");
    }
  }, [visible]);

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

  const isReturnUrl = (url: string) => url.includes("/api/payments/return");

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

  const uri = useMemo(() => (authorizationUrl ? authorizationUrl : "about:blank"), [authorizationUrl]);

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
              : "Paystack is processing your payment. This should only take a few seconds."}
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
                  Secured by Paystack
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
        {/* Single WebView — never remounted, so the checkout is NOT reloaded
            when pollStatus changes. The polling indicator is an overlay;
            renderError switches between the error view and the "checking
            payment status" view based on pollStatus.
            On web, react-native-webview isn't supported, so we open the
            checkout in a new browser tab and rely on the polling below. */}
        <View style={{ flex: 1 }}>
          {Platform.OS === "web" ? (
            <WebCheckoutScreen
              authorizationUrl={uri}
              retryKey={webViewKey}
              pollStatus={pollStatus}
              onClose={onClose}
            />
          ) : (
          <WebView
            key={webViewKey}
            source={{ uri }}
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
          {/* Polling indicator bar at bottom */}
          {pollStatus === "polling" ? (
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                paddingVertical: 10,
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
