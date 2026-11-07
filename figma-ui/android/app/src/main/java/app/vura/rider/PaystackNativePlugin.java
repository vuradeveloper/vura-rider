package app.vura.rider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import co.paystack.android.Paystack;
import co.paystack.android.PaystackSdk;
import co.paystack.android.Transaction;
import co.paystack.android.model.Charge;

/**
 * Paystack's native Android SDK, wrapped for the rider WebView.
 *
 * WHY THIS EXISTS: Paystack Inline runs checkout.paystack.com inside a
 * cross-origin iframe. When the bank returns from 3-D Secure, Inline loads
 * https://paystack.com/public/test/cookie-support/start.html to hand the result
 * back. Android WebView blocks that page (ERR_BLOCKED_BY_RESPONSE) even with
 * third-party cookies enabled, so the card form waits on "connecting to your
 * bank" forever. The native SDK has no iframe and no cookie bridge: Paystack's
 * own card screen, PIN/OTP and the bank's 3-D Secure page all run as native
 * Android screens inside the app.
 */
@CapacitorPlugin(name = "PaystackNative")
public class PaystackNativePlugin extends Plugin {

    private boolean initialized = false;

    @PluginMethod
    public void charge(PluginCall call) {
        String publicKey = call.getString("publicKey");
        String email = call.getString("email");
        String reference = call.getString("reference");
        Integer amountCents = call.getInt("amountCents", 100);
        String currency = call.getString("currency", "ZAR");

        if (publicKey == null || publicKey.isEmpty()
                || email == null || email.isEmpty()
                || reference == null || reference.isEmpty()
                || amountCents == null || amountCents <= 0) {
            call.reject("Missing card charge details.");
            return;
        }

        if (!initialized) {
            PaystackSdk.initialize(getContext().getApplicationContext());
            initialized = true;
        }
        PaystackSdk.setPublicKey(publicKey);

        Charge charge = new Charge();
        try {
            charge.setEmail(email);
            charge.setAmount(amountCents);
            charge.setReference(reference);
            charge.setCurrency(currency);
            // Deliberately no card: this is what makes the SDK open its own
            // native card form (Paystack's CardActivity) instead of charging
            // straight away.
        } catch (Exception e) {
            call.reject(e.getMessage());
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                PaystackSdk.chargeCard(getActivity(), charge, new Paystack.TransactionCallback() {
                    @Override
                    public void onSuccess(Transaction transaction) {
                        JSObject result = new JSObject();
                        result.put("status", "success");
                        result.put("reference",
                                transaction != null && transaction.getReference() != null
                                        ? transaction.getReference()
                                        : reference);
                        call.resolve(result);
                    }

                    @Override
                    public void beforeValidate(Transaction transaction) {
                        // PIN / OTP / bank authentication is about to open.
                    }

                    @Override
                    public void showLoading(Boolean isProcessing) {
                        // The native screens show their own progress.
                    }

                    @Override
                    public void onError(Throwable error, Transaction transaction) {
                        String message = error != null && error.getMessage() != null
                                ? error.getMessage()
                                : "The card could not be added.";
                        if (isCancellation(message)) {
                            JSObject result = new JSObject();
                            result.put("status", "cancelled");
                            call.resolve(result);
                        } else {
                            call.reject(message, new Exception(message, error));
                        }
                    }
                });
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Could not start card entry.", e);
            }
        });
    }

    /**
     * The SDK reports a dismissed card/OTP/PIN screen as an error. Those are
     * user cancellations, not failures, and the JS flow shows no red error.
     */
    private boolean isCancellation(String message) {
        String m = message.toLowerCase();
        return m.contains("invalid card parameters")
                || m.contains("did not provide an otp")
                || m.contains("interrupted")
                || m.contains("pin must be exactly");
    }
}
