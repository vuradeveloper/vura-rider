package app.vura.rider;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

/**
 * In-app bank authentication page.
 *
 * The paystack-ui SDK normally opens 3-D Secure in a Chrome Custom Tab. That
 * looks like leaving Vura. This Activity is launched instead (see the local
 * patched paystack-ui AAR) and shows the same bank page in a full-screen
 * WebView with the Vura header. When the bank redirects to our callback the
 * Activity closes; the SDK then polls the charge and completes the sheet.
 */
public class VuraAuthActivity extends AppCompatActivity {

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_vura_auth);

        findViewById(R.id.btnDone).setOnClickListener(v -> finish());

        webView = findViewById(R.id.webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // Some bank ACS pages reject the "; wv" WebView marker. Present as the
        // Chrome build the WebView actually is.
        settings.setUserAgentString(settings.getUserAgentString().replace("; wv", ""));

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (handleUrl(url)) {
                    view.stopLoading();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                View progress = findViewById(R.id.progress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });

        String url = getIntent().getStringExtra("url");
        if (url == null || url.isEmpty() || !url.startsWith("https://")) {
            finish();
            return;
        }
        webView.loadUrl(url);
    }

    /**
     * Paystack redirects to our own callback after the bank approves. Close so
     * the PaymentSheetActivity resumes and polls the final status.
     */
    private boolean handleUrl(String url) {
        if (url == null) return false;
        try {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
            if (!scheme.equals("http") && !scheme.equals("https")) {
                // Bank app deep link (e.g. capitec://..., intent://...).
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // No app installed; let the WebView surface the error.
                }
                return true;
            }
            String host = uri.getHost() != null ? uri.getHost() : "";
            String path = uri.getPath() != null ? uri.getPath() : "";
            if (host.endsWith("ridevura.com") && path.contains("/api/payments/return")) {
                finish();
                return true;
            }
        } catch (Exception ignored) {
            // Malformed bank redirect: let the WebView handle it.
        }
        return false;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
