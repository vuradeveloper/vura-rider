import type { CapacitorConfig } from '@capacitor/cli';

// ─────────────────────────────────────────────────────────────────────────────
// Wraps the Figma Make UI in a native Android shell so it can ship as an APK.
//
// appId is `app.vura.driver.figma` — deliberately NOT the existing driver app's
// `app.vura.driver`, so this installs SIDE BY SIDE with the current driver app
// while it is being brought up to feature parity. Once it matches, change appId
// to `app.vura.driver` and sign with the same debug.keystore and it will install
// as an update over the React Native driver app.
//
// It talks to the SAME backend as the current driver app
// (https://api.ridevura.com) — nothing on the server changes.
// ─────────────────────────────────────────────────────────────────────────────
const config: CapacitorConfig = {
  appId: 'app.vura.rider.figma',
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
    // ───────────────────────────────────────────────────────────────────────
    // CapacitorHttp — THIS IS REQUIRED FOR THE API TO WORK AT ALL in the APK.
    //
    // The WebView runs the page at origin `https://localhost`, and the API's
    // CORS policy only allows the real website origins. Proven with a live
    // preflight against https://api.ridevura.com:
    //
    //   Origin: https://localhost      -> NO Access-Control-Allow-Origin
    //   Origin: http://localhost       -> NO Access-Control-Allow-Origin
    //   Origin: capacitor://localhost  -> NO Access-Control-Allow-Origin
    //   Origin: https://ridevura.com   -> Access-Control-Allow-Origin: (allowed)
    //
    // So every browser fetch() was blocked before a status could be read, which
    // surfaces as "TypeError: Failed to fetch" — the exact error the driver saw
    // on Earnings, Documents and Link-your-car.
    //
    // The old React Native app never hit this because it made NATIVE http
    // calls, where CORS does not apply. Enabling CapacitorHttp patches
    // window.fetch/XMLHttpRequest to use the same native HTTP stack, which
    // removes CORS from the equation and restores identical behaviour.
    // (backend.ts also routes its calls through CapacitorHttp explicitly, so it
    // works even if the global patch is ever unavailable.)
    // ───────────────────────────────────────────────────────────────────────
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
