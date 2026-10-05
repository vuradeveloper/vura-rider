# Manual test: is a ride reaching a driver?

The fastest way to find out where a ride died is one trace. This is the
step-by-step test for a single rider and a single online driver, with the log
lines that mean "working" and the ones that mean each specific failure.

## Before you start

You need the read key. It is NOT `vura-devlog-key` on production — that value
is only the local fallback in `routes/devLogs.ts`. The instance sets its own
`DEV_LOG_READ_KEY`, which lives in `figma-ui/_live_diag.mjs`.

```powershell
$key = (Select-String -Path .\figma-ui\_live_diag.mjs -Pattern "READ = '([^']+)'").Matches[0].Groups[1].Value
```

## Setup (5 minutes)

1. **One driver account.** Sign in on the driver phone. Documents approved, so
   the account can go live. Tap **Go Online**. Keep the app in the FOREGROUND
   for test A.
2. **Confirm the driver is actually visible to dispatch.** This is the step
   people skip, and it is the cause of most "nothing arrived":

   ```powershell
   curl "https://api.ridevura.com/api/dev/dispatch?key=$key"
   ```

   Find the driver in the `drivers` array. You need:
   - `status` = `available`
   - `is_online` = true
   - `seconds_since_seen` < 20 (it is demoted to offline after 20s of silence)
   - `has_coords` = true

   If `seconds_since_seen` is climbing past 20, the driver's GPS or heartbeat
   is not reaching the server and **no offer will ever be made**. Fix that
   before continuing.
3. **One rider account** on a second phone, signed in.
4. Pickup: somewhere within ~3km of the driver (the offer radius), and confirm
   the pickup pin has real coordinates.

## Test A — foreground (proves the socket path)

1. Rider books. Note the **ride id** from the rider's screen (or from the ack).
2. Driver phone should show the offer within about a second.

Healthy trace:

```powershell
curl "https://api.ridevura.com/api/dev/dispatch/trips/<RIDE_ID>/trace?key=$key"
```

You want, in order:

```
request_received      ms_from_start: 0
trip_saved            ms_from_start: small
dispatch_started
drivers_found         count: 1        <-- must be 1, not 0
offer_sent            channel: "socket"
offer_delivered_ack   channel: "socket"   <-- only if the NEW apk is installed
driver_response       response: "accept"
```

`total_ms` should be well under 2000, and `within_budget: true`.

## Test B — background (this is the real test)

1. On the driver phone, **swipe the app fully away** (not just home — use
   recents-clear or force-stop).
2. Rider books again.
3. The driver phone should buzz and show a notification within ~2s.

Healthy trace differs in exactly two places:

```
offer_sent            channel: "push_only"    <-- socket was down
push_result           delivered: 1, ok: true <-- FCM actually reached a device
```

### What each failure looks like

| Symptom in the trace | Meaning | Where to look |
|---|---|---|
| `drivers_found count: 0` | Driver invisible to dispatch | `seconds_since_seen` in the dispatch inspector. Offline, stale GPS, or already on a trip |
| `candidates_query_failed` in stages | Database error, not "no drivers" | Server logs. The rider may have been wrongly told no drivers |
| `offer_sent` never appears | Dispatch stopped before offering | Check for `dispatch_exhausted` (hit the 12-round cap) |
| `channel: "push_only"` + `delivered: 0` | **FCM reached nobody** | The token is not registered, or the APK's signing SHA-1 does not match `google-services.json`. Check `device_tokens` for that user |
| `offer_sent` present, no `offer_delivered_ack` | Sent but never confirmed on a device | The driver APK predates the ack commit — rebuild it |
| `no_drivers` | Nobody matchable | Usually stale GPS, not genuinely no drivers |
| `offer_sent` at round 1, `driver_response` at round 6 | Offer cycling through drivers | Each driver is declining or letting the 15s window lapse |

## Confirming push registration (the single most common cause)

```sql
SELECT dt.platform, dt.is_active, dt.last_seen_at, LEFT(dt.push_token, 20) AS token
  FROM device_tokens dt
  JOIN users u ON u.id = dt.user_id
 WHERE u.email = 'driver@example.com';
```

- **No rows** → the app never registered a token. Confirm the driver APK
  includes the push plugin and that `figma-ui/src/lib/notify.ts` init runs on
  launch. Look for `[push] device registered` in the app log.
- **Rows but `is_active = false`** → FCM reported the token dead and we
  deactivated it. A rebuild/reinstall produces a new token.
- **Row present and active, still `delivered: 0`** → almost certainly a SHA-1
  mismatch between the installed APK's signing key and the one in
  `google-services.json`. FCM accepts the send and drops it silently.

## Rollback

Every change is commit-scoped, so:

```powershell
git revert <sha>          # one fix
git revert <sha>..<sha>    # a range
```

The 20s freshness change (`bb3441e`) is the one most likely to need reverting
in the field: if drivers start dropping off dispatch during testing, their GPS
is flapping and `LOCATION_FRESH_SECONDS` / `DRIVER_STALE_SECONDS` are the knobs.
Raising them back to 30/45 is the quickest mitigation and does not require a
code change — they are read from constants on boot.