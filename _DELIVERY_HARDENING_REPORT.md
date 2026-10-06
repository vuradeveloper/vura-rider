# Offer delivery hardening — REPORT

**Branch `offer-delivery-hardening`** (from `module1-h3-matching` @ `0010bb0`).
**Not merged. Not deployed.** STOP deliverable, together with the heartbeat fix.

| Commit | Content |
|---|---|
| `0010bb0` *(on module1-h3-matching)* | **Task 1:** `driver:heartbeat` now refreshes `driver_cells` (new `DriverIndex.touch()`) — stationary heartbeat-only drivers no longer go cold in the index after `stale_seconds` |
| `2d885e9` | counters: `offer_socket_down`, `push_delivered_zero`, `offer_undeliverable`, `offer_acked`, `offer_not_acked` |
| `e384733` | **(c)** ack counting: `offer_acked` bumped in the `driver:ride:offer:ack` handler; `offer_not_acked` bumped in `expireOffers` for offers that close with no ack on record |
| `acdaacc` | **(a)** truthful `socket_connected` + **(b)** instant skip + counters wired |

**Gates (all green):** `tsc --noEmit` **0** · mocked **65 pass / 7 skipped** ·
real-Postgres integration **7/7** (scratch container, `VURA_TEST_DB_PORT=55432`).

## (a) Truthful channel

`dispatch.ts` — new `hasLiveSocket(io, room)` reads the socket.io v4 adapter
room (`io.sockets.adapter.rooms.get("user:<uid>")` — the room `handlers.ts:163`
joins on connect). At emit time the offer records:

- trace `offer_sent { channel: "socket"|"push_only", socket_connected: true|false }`
- `logRideEvent offer_sent { socket: <real> }` (was `Boolean(firebase_uid)`)

A driver with a uid but no live connection now honestly shows
`socket_connected:false / push_only`. This supersedes the weak point listed in
`_OFFER_DELIVERY.md` §3 (the `channel` lie) — that document stays as the
pre-hardening snapshot.

## (b) Instant skip for undeliverable offers

Flow inside the offer loop (`dispatch.ts`, `offerToNextDriver`):

1. Insert offer row (unchanged) → compute `socketConnected` → emit (unchanged,
   emitting to an empty room is a no-op).
2. **Socket live** → push is fire-and-forget belt-and-braces (today's timing,
   never awaited). Offer stands.
3. **Socket down** → the push is **awaited with a 2.5 s cap** (`withPushTimeout`):
   - `delivered === 0` → close the row NOW
     (`status='expired', decline_reason='undeliverable'`), trace
     `offer_undeliverable {socket_connected:false, push_delivered:0}`, bump
     counters, **try the next candidate in the same round** — no 15 s wait.
   - rejected / timed out → outcome UNKNOWN → **never skips** (a flaky server
     network must not cost a driver the offer). The 15 s TTL applies as before.
4. If **nobody** in the round was reachable: advance to `round+1` exactly like
   `expireOffers`/`declineOffer` do (status guard: only while `searching` /
   `scheduled`), or return `{offered:false, reason:"offer_undeliverable"}` —
   the ride never stalls on an offer that cannot exist.
5. Per-ride exclusion already prevents re-offering the skipped driver later
   in the same search (`NOT EXISTS ride_offers` covers the expired row).

## (c) Counters (in `metrics.ts`, served by `/debug/counters` + trace — per instance)

| Counter | Bumped where |
|---|---|
| `offer_socket_down` | every offer attempt whose room was empty at emit |
| `push_delivered_zero` | push answered 0 (or failed) — trace still records `push_result` |
| `offer_undeliverable` | the instant-skip path |
| `offer_acked` | `driver:ride:offer:ack` handler (`handlers.ts`) |
| `offer_not_acked` | `expireOffers` — offer closed with no ack row (`ride_events` read is `execute`+try/catch, can never block expiry; parses JSONB-object and TEXT details) |

**Known counting nuance:** `offer_not_acked` judges acks at expiry time — an ack
arriving after the row closed (slow phone) counts as not_acked; `offer_acked`
still counts it on arrival. Counters are observability, not billing.

**Test-coverage honesty:** `offer_acked`'s one line sits inside the socket
handler, whose import graph (firebase/paystack/rideSim) makes a unit test more
fragile than the line it covers — it is type-checked but not unit-tested. The
read side (`offer_not_acked`) is covered by 3 tests; the skip path by 5.

## (d) Expo vs FCM token audit — REPORT ONLY, no code changed

Requested as "report what you find **before** changing it". Findings from
`services/notify.ts` + `services/push.ts`:

**FCM path (`device_tokens`, native/Capacitor apps) — healthy:**
- Dead-token removal already exists and is correct: `DEAD_TOKEN_CODES`
  (`messaging/registration-token-not-registered`, `invalid-registration-token`,
  `invalid-argument`, `mismatched-credential`) → `UPDATE device_tokens
  SET is_active = FALSE, invalidated_at = NOW()` (`notify.ts:57-63, 160-171`).
- Transient FCM errors (quota/unavailable) are correctly NOT in the dead set.
- `successCount` = "accepted by FCM", not "rendered on the phone" — so
  `delivered ≥ 1` is weaker than it reads, but `delivered: 0` is a solid
  "reached nobody" signal, which is what the skip in (b) requires.

**Expo path (`push_tokens`, legacy RN app) — pruning is DEAD CODE:**
1. `push.ts:120-129`: `const badToken = err?.details?.error ?? ""` — Expo's
   per-message error carries `details: { error: "DeviceNotRegistered" }`, i.e.
   the **error NAME, never a token**. The guard
   `validTokens.includes(badToken)` compares that name against token strings →
   always false → **the `DELETE FROM push_tokens` never executes**. Stale Expo
   tokens accumulate and every send keeps failing on them.
2. Even with the right field, `errors = data.filter(status === "error")`
   **loses the index** needed to pair an error back to `messages[i].to`
   (the token). Correct fix: map over `json.data` with its original index and
   delete `messages[i].to` when `data[i].status === "error" &&
   data[i].details?.error === "DeviceNotRegistered"`.
3. `push.ts:114-132`: when `res.ok === false` and no per-message errors (e.g.
   HTTP 401 because `EXPO_ACCESS_TOKEN` is unset) → returns 0 **without any
   `logPush` record** — a silent branch.

**Cross-cutting (also not changed):**
- `notify.ts:100-101, 175-184`: **both transports always run** — a user holding
  an FCM token AND an old Expo token gets **two notifications** per event.
- `notify.ts:194`: `provider` label is `tokens.length > 0 ? "fcm" : "expo"` —
  wrong when both are used.
- Lifecycle asymmetry: FCM deactivates (`is_active=false`), Expo deletes —
  defensible (audit trail vs none), but worth unifying later.

**Recommended follow-up (awaiting your go):** fix the index-pairing delete in
`push.ts` (bug 1+2), log the `!res.ok` branch (3). The double-send and provider
label are product decisions (do you want belt-and-braces duplicates?). Per
instruction, **nothing in this section was modified.**

## (e) Legacy path

`findCandidates` / `findCandidatesHaversine` were **not touched** — the flag-OFF
query body remains byte-identical to the pre-Module-1 SQL (the proven
guarantee). All hardening lives in `offerToNextDriver` (shared delivery),
`expireOffers`, the ack handler, `metrics.ts`, and the test harness. Matching
behaviour under any flag combination is unchanged; only delivery/observability
changed.

## Tests added

- `dispatch.delivery.test.ts` — `4. delivery hardening` (5): truthful
  `socket_connected` true/false, dead-socket = `push_only` + `offer_socket_down`,
  instant skip → next candidate offered in the same round (counters + row
  closed + trace), unknown push outcome never skips, all-unreachable →
  `offer_undeliverable` with an advance attempt.
- `dispatch.timeout.test.ts` — `offer ack accounting` (3): not-acked counted,
  acked not counted, TEXT-detail string parsed.
- Existing suites re-verified unchanged (60 prior tests still green).

**STOP.** No merge, no deploy. Module 2 build starts only after your Q1–Q14
replies (recorded in `_MODULE2_RESTATEMENT.md` §8).

