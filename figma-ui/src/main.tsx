// Polyfills FIRST: module evaluation order guarantees the shims exist before
// react/app code runs (old WebView floor — see lib/legacyPolyfills.ts).
import './lib/legacyPolyfills'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { installGlobalErrorScreens, installWebviewGuard } from './lib/webviewGuard'
import './index.css'
import './legacy-compat.css'

// Uncaught anything → readable screen, never a silent white page.
installGlobalErrorScreens()
// Old-WebView gate (Huawei without Play services ships frozen System WebViews):
// shows the full-screen "Please update Android System WebView / Chrome" message
// (with the detected version) when the engine is below the floor — in that case
// the app is NOT mounted.
const guard = installWebviewGuard()

if (guard.ok) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* Without this a render error unmounts the tree and the app is just a white
          screen with nothing to diagnose (reported from the field 27 Sep 2026). */}
      <ErrorBoundary app="rider">
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
