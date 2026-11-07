package app.vura.rider;

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
 * The PaymentSheet is Paystack's full-screen native UI (card form, PIN, OTP,
 * Visa/Mastercard icons). The access code is created by /api/payments/card-register.
 */
@CapacitorPlugin(name = "PaystackNative")
public class PaystackNativePlugin extends Plugin implements PaymentSheetResultCallback {

    private PaymentSheet paymentSheet;
    private PluginCall pendingCall;
    private String pendingReference;

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
            } catch (Throwable t) {
                pendingCall = null;
                String msg = t.getMessage() != null ? t.getMessage() : "Could not open the card form.";
                call.reject(msg, new Exception(msg, t));
            }
        });
    }

    @Override
    public void onPaymentResult(PaymentSheetResult result) {
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
