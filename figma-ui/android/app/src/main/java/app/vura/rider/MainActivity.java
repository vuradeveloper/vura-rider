package app.vura.rider;

import android.os.Bundle;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Paystack Inline runs inside this WebView and uses its own cookies on
        // paystack.com. Android WebView blocks third-party cookies by default,
        // which makes Paystack's cookie-support check fail with
        // ERR_BLOCKED_BY_RESPONSE and leaves the card form on "connecting to
        // your bank" forever. Enable them for this app's WebView only.
        try {
            CookieManager cookies = CookieManager.getInstance();
            cookies.setAcceptCookie(true);
            cookies.setAcceptThirdPartyCookies(getBridge().getWebView(), true);
        } catch (Exception ignored) {
            // Older WebView / unexpected bridge state: the hosted fallback still works.
        }
    }
}
