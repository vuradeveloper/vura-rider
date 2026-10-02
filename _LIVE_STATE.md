# Vura live state — 2026-10-02

`origin/main` = **`3e480e7`** (rider). The driver app is its own repository,
`vura-driver`, now at **`51ace72`** on its `main`.

**A deploy HAS already run — it is only one commit behind.** Prod serves a build
stamped `2026-10-01T12:24:00Z`; `3e480e7` was written at `16:35Z` that same day.
The live diag response proves both halves: it answers at all (so `354bf42`'s route
and its `sharp` *encode* check are live — `sharp.loads=true, encodedBytes=95`), but
it carries **no `dispatch` and no `queue` block**, which is exactly what `3e480e7`
adds. The dispatch-conflict fix, the one-live-trip-per-driver index and the
per-driver candidate checks are therefore NOT live. **Re-run the deploy.**

## Shipped since the last deploy

| Commit | What it changes |
|---|---|
| `939cc65` | Driver identity resolved via `driver_profiles.user_id`, not the mutable `users.role`; `vehicle_images.last_error` surfaced to admins; atomic `queued → fetching` claim so CarsXE credits are not double-spent |
| `66d1ac9` | Search asks HERE for **relevance**, not distance, and names the bias source when there is no GPS |
| `354bf42` | Deploy no longer ships foreign native binaries; both EB hooks verify `sharp` can actually **encode**; adds `GET /api/dev/diag` |
| `d3ccd81` | Restored a corrupted Gradle exit-code line in `rider-local-build.cmd`; NDK 27.0 / `NODE_OPTIONS` pins kept |
| `773d4f3` | `.gitattributes` pins `eol=lf` for the Linux-run files |
| `9426385` | Declares the vehicle-image generator `devDependencies` at the root |
| `eb959ce` | The CarsXE stranded-row reclaim runs **before** the budget guard, so an exhausted budget can no longer freeze a half-finished `fetching` row |

## The three proven bugs

**Blank Earnings / driver invisible to dispatch.** `/api/drivers/stats` filtered
`WHERE role = 'driver'`, but `POST /api/users/sync` writes `role` from the client
payload — so one rider-app sign-in rewrote a real driver to `passenger` and his
stats 403'd while his `driver_profiles` row (`id 7b914ff9`, `user_id d5eb8836`)
sat intact. Fixed by joining on `driver_profiles.user_id`; `/api/drivers/online`
now self-heals a drifted role back to `driver`.

**Search returning the wrong places.** A rider with no GPS sent no `at`, so the
server asked HERE an unranked question, got nothing usable, and silently answered
from OpenStreetMap — "Farmers" came back as KZN farm associations. With a bias
present HERE returns "Fourways Farmers Market" 556 m first. Bias now falls back to
the rider's last ride pickup / last saved search, items without a position are
dropped before the limit is applied, and the response names its bias source.

**Vanishing car photos.** `server/node_modules` is built on Windows and shipped
inside the deploy zip (`.ebignore` re-includes it so a fresh instance boots
without a 100 MB install). That shortcut is only safe for pure-JS packages: the
zip carries `@img/sharp-win32-x64` to a linux-x64 instance, and every install
guard only ever checked `express/package.json` — a pure-JS dep — so nothing
complained. `sharp` is imported lazily, so it failed only when the image pipeline
called it, and the only symptom was a car with no photo while CarsXE returned
HTTP 200 with nine images.

> Not yet confirmed on the live instance which of the two mechanisms won: the
> mismatched `@img` suppressing npm's optional-dependency fetch, or the
> postdeploy guard skipping the install outright. `354bf42` fixes both and makes
> the result self-reporting, so the diagnostic below settles it.

## Found on the live instance this session

**A stranded image row and an exhausted CarsXE budget were frozen together.** The
live `diag` reports `carsxe.budget = {"used":90,"max":90,"left":0,"blocked":true}`
— the 90-call ceiling (`DEFAULT_MAX_CALLS`) is fully spent, so **no car can fetch a
photo until that is raised or the CarsXE plan is upgraded**; no deploy fixes that.
Pinned to the same exhaustion was the release of a half-finished row:
`toyota|etios|2017-2020|blue` was left at `status='fetching'` with `attempts=78`
(and `api_calls_used=0`). The only code that frees a `fetching` row is the worker's
five-minute reclaim — and it ran *after* the budget guard, so while the budget was
exhausted the guard returned first and the row could never return to `queued`. It
could not recover even once budget exists. Freeing a row costs no API call (it just
becomes eligible again), so the reclaim now runs **before** the guard.
`queue` and `dispatch` blocks above stay the dispatch-side counterpart to this.

## Two things the earlier notes got wrong

**The diag key is NOT `vura-devlog-key` on prod.** That value is only the local
fallback in `routes/devLogs.ts`; the instance sets its own `DEV_LOG_READ_KEY`
(`deploy/env.prod.example` ships `<random-string>`). A wrong key is answered with
`401 {"error":"bad read key"}`, which reads like "the route is missing" but is not:
`/api/dev/zzz-nonexistent` returns `404 {"error":"Route not found"}`, and that is
the contrast to judge by. The read key the probe scripts actually use lives in
`figma-ui/_live_diag.mjs`.

**`server/dist` is the deployed artefact.** `git ls-files server/dist/index.js`
answers, and *neither* EB hook runs `tsc` — they only install dependencies. Editing
`server/src/**` changes nothing on the instance until `npm run build` is run in
`server/` and the regenerated `dist` is committed alongside it. Confirm with
`git status --porcelain server/dist` before every deploy.

## Run the deploy (AWS CloudShell)

```bash
cd ~/vura-rider && git pull --ff-only
git log --oneline -1          # must print 3e480e7
bash deploy/deploy.sh vura-rider-prod
```

## Verify — one request, no shell on the instance

```bash
curl -s 'https://api.ridevura.com/api/dev/diag?key=351d6e8d4be23114e219f579a19de045&s3=1'
```

| Field | Expected | Means |
|---|---|---|
| `build.builtAt` | fresh timestamp | the new build is actually serving |
| `sharp.loads` | `true` | a usable native binary exists |
| `sharp.encodes` | `true` | **it can encode** — resolving a module is not enough, this is the check that was missing |
| `storage.roundTrip.ok` | `true` | S3 write + delete works |
| `driverRoleMismatch` | `[]` | no account owns a `driver_profiles` row while `users.role` is not `driver` |
| `vehicleImages[].lastError` | readable text | why the last photo attempt failed, instead of a silent grey icon |
| `dispatch[].is_candidate` | `true` for the driver who is online with a fresh fix | the four-part offer predicate is satisfied. When it is `false` the same row names **which** condition failed (`has_coords`, `location_age_s`, `heartbeat_age_s`, `status`) |
| `queue[].pending_offers` | `>= 1` for a `searching` ride | a driver is really being asked. `searching` with `0` means dispatch found nobody — a driver problem; `1` means a phone is refusing — a client problem. |
| `carsxe.budget.blocked` | `false` | a CarsXE credit exists to spend (see below) |

Then re-fetch the Picanto (`cache_key kia|picanto|2017-2020|red`, row `312804a6…`)
from the admin page and confirm candidates appear with no `none_found`.

## APKs

Copied to `C:\Users\mbofh\Downloads\`, every copy SHA256-verified byte-identical to
the build output it came from:

- **rider** — `vura-rider-figma.apk` = `vura-rider-2026-10-01.apk` = `VURA-RIDER-latest.apk` (8.84 MB, 2026-10-01 02:21)
- **driver** — `vura-driver-figma.apk` = `VURA-DRIVER-latest.apk` = `vura-driver-2026-10-01-locationfix.apk`, SHA256 `48B0088B…62FD8` (8.07 MB, 2026-10-01 18:27)

**`vura-driver-2026-10-01.apk` is NOT that build.** It hashes differently
(`7D10A859…18C9`) and was written 02:25, before the GPS fix — installing it
reproduces the *"Location is off"* banner and the silent no-offer state that
started this work. Delete it.

The three fixes are provably inside the good APK: its bundled web assets
(`figma-ui/android/app/src/main/assets/public/assets/index-*.js`) contain
`maximumAge`, `ride:offer:cancelled` and `ride:taken`. Verify any future APK the
same way — grep those three strings in the **asset** copy, not in `dist`, because
only the asset copy is what the WebView loads.

Two-phone loop — `_dispatch.mjs` needs six arguments and exits with a usage line
without them, so mint throwaway accounts first (shared password `FlowTest123!`):

```bash
cd figma-ui
node _mkaccounts.mjs            # prints RIDER=, DRIVER_A=, DRIVER_B=
node _dispatch.mjs <RIDER> 'FlowTest123!' <DRIVER_A> 'FlowTest123!' <DRIVER_B> 'FlowTest123!'
```

It books a ride, has driver B try to steal it, has A accept, and cancels
everything before exiting — safe to re-run.

## Still true / no action

- **Push notifications** are Expo-only (`services/push.ts` accepts
  `ExponentPushToken[…]` and posts to `exp.host`). A Capacitor APK cannot mint an
  Expo token, so push never reaches these builds whatever `google-services.json`
  says; while the app is open, delivery is the socket plus the driver's 1 s
  `/api/rides/available` poll.
- **Paystack** cannot resolve ZA account names — `/bank/resolve` supports only
  NGN/USD/GHS/KES. `basa` recipient creation succeeds with `account_name` null, so
  the driver's own name is used and the recipient is marked `verified: false`
  (`ddfcf70`).
- **`_deploy_wp.ps1` and `_DEPLOY_STOPS_FIX.md`** are stale Oracle-VM / waypoints
  leftovers, not part of the live path. Ignore them.
