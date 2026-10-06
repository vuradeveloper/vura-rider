# Offer delivery today — socket, FCM, ack (and what a dead socket does)

**Status: DOCUMENT ONLY** (no code changed). All line numbers on
`module1-h3-matching` @ `c2049f4`.

## 1. What happens when a driver is offered a ride

Inside `offerToNextDriver` (`server/src/services/dispatch.ts:547-752`):

1. **Offer row first** — `INSERT INTO ride_offers … 'pending',
   NOW()+15s` (`dispatch.ts:614-619`); TTL constant
   `OFFER_TTL_SECONDS = 15` (`dispatch.ts:36`).
2. **Socket emit (channel 1)** — *both* events, to that driver's personal room
   only: `io.to(\`user:${driver.firebase_uid}\`).emit("ride:offer", payload)`
   and the same for the legacy `"ride:request"` (`dispatch.ts:698-701`);
   payload at `:676-696` (offerId, expiry, pickup+destination, fare, round).
3. **Trace/log the send** — `logRideEvent offer_sent {socket: Boolean(firebase_uid)}`
   (`dispatch.ts:703-708`) and trace `offer_sent {channel: driver.firebase_uid ?
   "socket" : "push_only"}` (`dispatch.ts:710-717`).
4. **Push always (channel 2)** — `void sendPushToUsers([driver.id], {type:
   "ride_offer", highPriority: true, …})` (`dispatch.ts:719-727`) — sent
   *unconditionally*, not only when the socket is down. The sender is
   `services/notify.ts`: `device_tokens` rows (FCM, Capacitor APK) via
   firebase-admin, Android HIGH priority + channel `vura_ride_offers`
   (`notify.ts:11-16, 48-55`); legacy `push_tokens` (Expo RN app) via
   `services/push.ts` (`notify.ts:16, 28`). Result lands in the trace as
   `push_result {delivered, ok}` (`dispatch.ts:732-749`).
5. **Device ack (the receipt)** — an app that received the offer emits
   `driver:ride:offer:ack`; the server writes trace stage
   `offer_delivered_ack {channel: "socket"|"push"}` (`handlers.ts:249-267`).
   This is the brief's `offer_acked` (alias documented in
   `routes/debugTrace.ts:18-22`).
6. **Channel 3 — polling** — an *open* driver app polls
   `GET /api/rides/available` about every second (`routes/rides.ts:456-457`;
   rate limits raised for exactly this, `index.ts:119-121`), and
   `GET /api/rides/me/active-state` returns its own pending offer **with
   `seconds_remaining` countdown** (`rides.ts:18-44`). Polling is an independent
   path: a ride can be seen and claimed with no socket event at all
   (`rides.ts:493-495` — parked rides stay listed "and claimable").
7. **Expiry & re-offer** — `offerWorker` ticks every 2s
   (`offerWorker.ts:11,72`) and calls `expireOffers` (`dispatch.ts:1073+`):
   after 15s unanswered the offer closes and the NEXT candidate is offered, up
   to `MAX_OFFER_ROUNDS = 12` (`dispatch.ts:40`), then `dispatch_exhausted`
   → `markNoDrivers` → rider-facing `no_drivers` (`dispatch.ts:575-580,
   755-776`).

## 2. If the driver's socket is down when the offer is sent

Sequence and consequences, in order:

1. **The emit is a silent no-op.** `io.to("user:<uid>").emit(...)` to a room
   with nobody connected is dropped by socket.io — no error, no retry, no
   delivery report. The server cannot tell this from a delivered emit.
2. **The trace still says `channel: "socket"` — and that is misleading.**
   The channel is derived from `Boolean(driver.firebase_uid)`
   (`dispatch.ts:715`), i.e. "has a UID", **not** "has a live connection"
   (the comment at `:710-712` says "no live connection" but the condition is
   the uid). The truthful diagnostics are the *absence* of
   `offer_delivered_ack` and the `push_result` numbers.
3. **Push is the safety net** — it was fired unconditionally at step 1.4. If
   the FCM token is registered and the APK's signing SHA matches
   `google-services.json`, the phone buzzes even with the app killed
   (`DISPATCH_TEST.md:76-79, 88, 105-109`); the payload carries IDs only and
   the app fetches the ride on tap (`notify.ts:18-20`). Tap → app opens → the
   1s poll (step 1.6) takes over delivery.
4. **If push also fails** (`push_result {delivered: 0}`, `dispatch.ts:734-739`):
   the offer row just sits pending. Nothing retries the socket emit. The
   driver sees nothing unless they open the app (poll) within 15s.
5. **15s later** `expireOffers` closes it and the round moves to the next
   candidate (`dispatch.ts:1073+`). A driver whose socket stays down burns one
   round per offer; after 12 rounds the rider is told `no_drivers`.
6. **What still works with a dead socket:** polling (app open), accept via the
   guarded `acceptRide` transaction (dispatch header, `dispatch.ts:11-16`),
   and — for riders — their own poll/`ride:accepted` handling
   (`figma-ui/src/lib/notify.ts:108-109`).

**Net answer:** *socket down ≠ offer lost.* Delivery degrades to
**FCM push → (tap) → poll**, and the failure only becomes rider-visible when
push ALSO fails — at which point the trace shows the exact fingerprint:
`offer_sent` present, `push_result delivered: 0`, no `offer_delivered_ack`,
then `offer_expired`-style re-offers at rounds 2…12
(`DISPATCH_TEST.md:83-92` is the lookup table for these signatures).

## 3. Known weak points (for a future hardening pass — not today's scope)

- `channel` should reflect live connections (`io.sockets.adapter.rooms`) so
  `push_only` means what the comment says.
- No server-side receipt for socket emits; the ack only exists for APKs built
  after that commit (`DISPATCH_TEST.md:89` — old APKs never ack).
- Capacitor APKs cannot mint Expo tokens (`notify.ts:4-9`), so for those builds
  push works ONLY through `device_tokens`/FCM.
- One pending offer per driver (001b) means a dead-socket driver still holds
  the offer for the full 15s — it is skipped for other rides only when the
  INSERT conflicts (`dispatch.ts:625-638`).
