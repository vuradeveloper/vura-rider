package app.vura.rider;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.paystack.android.core.Paystack;
import com.paystack.android.core.PaystackThemeMode;
import com.paystack.android.ui.paymentsheet.PaymentSheet;
import com.paystack.android.ui.paymentsheet.PaymentSheetResult;
import com.paystack.android.ui.paymentsheet.PaymentSheetResultCallback;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Paystack's current native checkout, wrapped for the rider WebView.
 *
 * WHY NOT INLINE: Inline renders checkout.paystack.com in a cross-origin
 * iframe. After bank authentication it loads
 * paystack.com/public/test/cookie-support/start.html to return the 3DS result;
 * Android WebView blocks that with ERR_BLOCKED_BY_RESPONSE, so the card form
 * waits on "connecting to your bank" forever.
 *
 * WHY NOT THE OLD NATIVE SDK: `co.paystack.android:paystack:3.5.0` uses the
 * legacy /checkout/card/charge endpoint, which returns "Invalid Transaction"
 * for this merchant. The paystack-ui SDK uses /transaction/charge, which works.
 *
 * STUCK "CHECKING TRANSACTION STATUS" FIX: Paystack's 3DS event stream does not
 * always deliver the completion to the sheet after the bank approves. The card
 * IS tokenised (the webhook saves it), but the sheet has no way to know. While
 * the sheet is open this plugin polls /api/payments/verify for the server's
 * authoritative state; once the card is saved it closes the bank page + sheet
 * and resolves the JS call. The rider no longer has to wipe the app.
 */
@CapacitorPlugin(name = "PaystackNative")
public class PaystackNativePlugin extends Plugin implements PaymentSheetResultCallback {

    private static final String VERIFY_URL =
            "https://api.ridevura.com/api/payments/verify?reference=";

    private PaymentSheet paymentSheet;
    private volatile PluginCall pendingCall;
    private volatile String pendingReference = "";
    private volatile ScheduledExecutorService poller;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WeakReference<Activity> paystackActivity = new WeakReference<>(null);
    private WeakReference<Activity> authActivity = new WeakReference<>(null);

    @Override
    public void load() {
        // PaymentSheet registers an ActivityResult launcher, so it must be built
        // before the host activity is STARTED. Plugin.load() runs during
        // BridgeActivity.onCreate, which is the right time.
        try {
            if (getActivity() != null) {
                paymentSheet = new PaymentSheet(getActivity(), this);
            }
        } catch (Throwable t) {
            paymentSheet = null;
            android.util.Log.e("PaystackNative", "Could not create PaymentSheet", t);
        }

        // Track the Paystack sheet and our in-app 3DS page so the server poll
        // can finish them when the card has been saved on the backend.
        try {
            Application app = (Application) getContext().getApplicationContext();
            app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
                @Override
                public void onActivityCreated(Activity activity, Bundle savedInstanceState) { }

                @Override
                public void onActivityStarted(Activity activity) { }

                @Override
                public void onActivityResumed(Activity activity) {
                    if (activity == null) return;
                    if ("com.paystack.android.ui.paymentsheet.PaymentSheetActivity"
                            .equals(activity.getClass().getName())) {
                        paystackActivity = new WeakReference<>(activity);
                    }
                    if (activity instanceof VuraAuthActivity) {
                        authActivity = new WeakReference<>(activity);
                    }
                }

                @Override
                public void onActivityPaused(Activity activity) { }

                @Override
                public void onActivityStopped(Activity activity) { }

                @Override
                public void onActivitySaveInstanceState(Activity activity, Bundle outState) { }

                @Override
                public void onActivityDestroyed(Activity activity) {
                    if (activity == paystackActivity.get()) {
                        paystackActivity = new WeakReference<>(null);
                    }
                    if (activity == authActivity.get()) {
                        authActivity = new WeakReference<>(null);
                    }
                }
            });
        } catch (Throwable t) {
            android.util.Log.e("PaystackNative", "Could not track card activities", t);
        }
    }

    @PluginMethod
    public void charge(PluginCall call) {
        String publicKey = call.getString("publicKey");
        String accessCode = call.getString("accessCode");
        String reference = call.getString("reference");

        if (publicKey == null || publicKey.isEmpty()
                || accessCode == null || accessCode.isEmpty()) {
            call.reject("Missing card charge details.");
            return;
        }
        if (paymentSheet == null) {
            call.reject("The card form is not ready. Please reopen the app and try again.");
            return;
        }
        if (pendingCall != null) {
            call.reject("A card form is already open.");
            return;
        }

        Paystack paystack;
        try {
            paystack = Paystack.builder()
                    .setPublicKey(publicKey)
                    .setLoggingEnabled(false)
                    .setThemeMode(PaystackThemeMode.LIGHT)
                    .build();
        } catch (Throwable t) {
            String msg = t.getMessage() != null ? t.getMessage() : "Invalid Paystack key.";
            call.reject(msg, new Exception(msg, t));
            return;
        }

        pendingCall = call;
        pendingReference = reference != null ? reference : "";

        getActivity().runOnUiThread(() -> {
            try {
                paymentSheet.launch(paystack, accessCode);
                startSavedPoll(pendingReference);
            } catch (Throwable t) {
                pendingCall = null;
                stopSavedPoll();
                String msg = t.getMessage() != null ? t.getMessage() : "Could not open the card form.";
                call.reject(msg, new Exception(msg, t));
            }
        });
    }

    /**
     * The backend is the source of truth. The card is saved by the
     * charge.success webhook or by /verify; once the row is final this poll
     * closes the native sheet and resolves the JS call.
     */
    private void startSavedPoll(String reference) {
        stopSavedPoll();
        if (reference == null || reference.isEmpty()) return;

        ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
        poller = executor;
        final int[] attempts = {0};
        executor.scheduleWithFixedDelay(() -> {
            if (pendingCall == null) {
                stopSavedPoll();
                return;
            }
            if (++attempts[0] > 360) { // 15 minutes at 2.5 s
                stopSavedPoll();
                return;
            }
            String status = fetchPaymentStatus(reference);
            if (isSavedStatus(status)) {
                mainHandler.post(() -> completeFromServer(reference));
            }
        }, 2500, 2500, TimeUnit.MILLISECONDS);
    }

    private String fetchPaymentStatus(String reference) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(VERIFY_URL + URLEncoder.encode(reference, "UTF-8"));
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setUseCaches(false);
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) return "";
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            return new JSONObject(body.toString()).optString("status", "");
        } catch (Exception e) {
            return "";
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private boolean isSavedStatus(String status) {
        return "completed".equals(status)
                || "success".equals(status)
                || "refunded".equals(status)
                || "card_saved".equals(status);
    }

    private void completeFromServer(String reference) {
        PluginCall call = pendingCall;
        if (call == null) return;
        pendingCall = null;
        stopSavedPoll();
        dismissPaystack();
        JSObject result = new JSObject();
        result.put("status", "success");
        result.put("reference", reference);
        call.resolve(result);
    }

    private void dismissPaystack() {
        Activity auth = authActivity.get();
        if (auth != null && !auth.isFinishing()) auth.finish();
        Activity sheet = paystackActivity.get();
        if (sheet != null && !sheet.isFinishing()) sheet.finish();
    }

    private void stopSavedPoll() {
        ScheduledExecutorService executor = poller;
        poller = null;
        if (executor != null) executor.shutdownNow();
    }

    @Override
    public void onPaymentResult(PaymentSheetResult result) {
        stopSavedPoll();
        PluginCall call = pendingCall;
        pendingCall = null;
        if (call == null) {
            return;
        }

        if (result instanceof PaymentSheetResult.Completed) {
            String reference = ((PaymentSheetResult.Completed) result)
                    .getPaymentCompletionDetails()
                    .getReference();
            JSObject ret = new JSObject();
            ret.put("status", "success");
            ret.put("reference", reference != null && !reference.isEmpty() ? reference : pendingReference);
            call.resolve(ret);
            return;
        }

        if (result instanceof PaymentSheetResult.Cancelled) {
            JSObject ret = new JSObject();
            ret.put("status", "cancelled");
            call.resolve(ret);
            return;
        }

        if (result instanceof PaymentSheetResult.Failed) {
            PaymentSheetResult.Failed failed = (PaymentSheetResult.Failed) result;
            Throwable error = failed.getError();
            String message = error != null && error.getMessage() != null
                    ? error.getMessage()
                    : "The card could not be added.";
            call.reject(message, new Exception(message, error));
            return;
        }

        call.reject("The card could not be added.");
    }
}
