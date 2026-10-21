// Which dev-log write key does the LIVE server accept?
//
// routes/devLogs.ts takes DEV_LOG_WRITE_KEY from the environment and falls back
// to "vura-devlog-key". The apps bake the key in at build time as
// VITE_DEVLOG_KEY (see components/ErrorBoundary.tsx), so this probe decides the
// value that goes into figma-ui/.env.production.
//
//   node _devlog_key.mjs [candidate]
const candidates = process.argv.slice(2)
if (candidates.length === 0) candidates.push('vura-devlog-key')

for (const key of candidates) {
  const res = await fetch('https://api.ridevura.com/api/dev/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-log-key': key },
    // NOTE: routes/devLogs.ts only understands { entries: [...] } or a single
    // object. A *bare array* is read as one entry with blank app/tag/message
    // (it lands in the table as app=unknown) — which is exactly what the
    // ErrorBoundary must avoid, hence the { entries } shape here too.
    body: JSON.stringify({
      entries: [
        {
          app: 'rider',
          deviceId: 'build-machine-key-probe',
          level: 'info',
          tag: 'devlog-key-probe',
          message: 'checking which dev-log write key this server accepts',
        },
      ],
    }),
  })
  const body = await res.text()
  console.log(`key=${key} -> ${res.status} ${body.slice(0, 200)}`)
}
