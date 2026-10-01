# Vura live state — 2026-10-01

`origin/main` = **`9426385`**. Everything below is committed and pushed.
**The production deploy has NOT been run yet** — that is the only blocking step.

## Shipped since the last deploy

| Commit | What it changes |
|---|---|
| `939cc65` | Driver identity resolved via `driver_profiles.user_id`, not the mutable `users.role`; `vehicle_images.last_error` surfaced to admins; atomic `queued → fetching` claim so CarsXE credits are not double-spent |
| `66d1ac9` | Search asks HERE for **relevance**, not distance, and names the bias source when there is no GPS |
| `354bf42` | Deploy no longer ships foreign native binaries; both EB hooks verify `sharp` can actually **encode**; adds `GET /api/dev/diag` |
| `d3ccd81` | Restored a corrupted Gradle exit-code line in `rider-local-build.cmd`; NDK 27.0 / `NODE_OPTIONS` pins kept |
| `773d4f3` | `.gitattributes` pins `eol=lf` for the Linux-run files |
| `9426385` | Declares the vehicle-image generator `devDependencies` at the root |

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

## Run the deploy (AWS CloudShell)

```bash
cd ~/vura-rider && git pull --ff-only
git log --oneline -1          # must print 9426385
bash deploy/deploy.sh vura-rider-prod
```

## Verify — one request, no shell on the instance

```bash
curl -s 'https://api.ridevura.com/api/dev/diag?key=vura-devlog-key&s3=1'
```

| Field | Expected | Means |
|---|---|---|
| `build.builtAt` | fresh timestamp | the new build is actually serving |
| `sharp.loads` | `true` | a usable native binary exists |
| `sharp.encodes` | `true` | **it can encode** — resolving a module is not enough, this is the check that was missing |
| `storage.roundTrip.ok` | `true` | S3 write + delete works |
| `driverRoleMismatch` | `[]` | no account owns a `driver_profiles` row while `users.role` is not `driver` |
| `vehicleImages[].lastError` | readable text | why the last photo attempt failed, instead of a silent grey icon |

Then re-fetch the Picanto (`cache_key kia|picanto|2017-2020|red`, row `312804a6…`)
from the admin page and confirm candidates appear with no `none_found`.

## APKs

Built and byte-verified, copied to `C:\Users\mbofh\Downloads\`:

- rider — `vura-rider-figma.apk` / `vura-rider-2026-10-01.apk` / `VURA-rider-latest.apk` (8.84 MB)
- driver — `vura-driver-figma.apk` / `vura-driver-2026-10-01.apk` / `VURA-driver-latest.apk` (8.07 MB)

No car photo can appear until the deploy lands. Two-phone loop:
`cd figma-ui && node _dispatch.mjs`.

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
