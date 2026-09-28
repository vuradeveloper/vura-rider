import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Without this a render error unmounts the tree and the app is just a white
        screen with nothing to diagnose (reported from the field 27 Sep 2026). */}
    <ErrorBoundary app="rider">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
