import type { CapacitorConfig } from '@capacitor/cli';

// ─────────────────────────────────────────────────────────────────────────────
// Wraps the Figma Make rider UI in a native shell so it can ship to the Play
// Store and the App Store.
//
// appId is `app.vura.rider` — a fresh, production package. The old Expo rider
// app used `com.nhlanhlanb.vurarider`; the two are separate listings.
//
// It talks to the same backend as the driver app (https://api.ridevura.com).
// ─────────────────────────────────────────────────────────────────────────────
const config: CapacitorConfig = {
  appId: 'app.vura.rider',
  appName: 'Vura',
  webDir: 'dist',
  server: {
    // Firebase Auth requires a secure (https) origin inside the WebView.
    androidScheme: 'https',
  },
  android: {
    // Let Waze / dialler / mail links leave the WebView and open the real app.
    allowMixedContent: true,
  },
  plugins: {
    // ─────────────────────────────────────────────────────────────────────────
    // CapacitorHttp — REQUIRED FOR THE API TO WORK AT ALL in the APK.
    //
    // The WebView runs the page at origin `https://localhost`, and the API's
    // CORS policy only allows the real website origins. Verified with a live
    // preflight against https://api.ridevura.com:
    //
    //   Origin: https://localhost      -> NO Access-Control-Allow-Origin
    //   Origin: http://localhost       -> NO Access-Control-Allow-Origin
    //   Origin: capacitor://localhost  -> NO Access-Control-Allow-Origin
    //   Origin: https://ridevura.com   -> Access-Control-Allow-Origin: (allowed)
    //
    // Enabling CapacitorHttp patches window.fetch/XMLHttpRequest to use the
    // native HTTP stack, which removes CORS from the equation. backend.ts also
    // routes its calls through CapacitorHttp explicitly.
    // ─────────────────────────────────────────────────────────────────────────
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
