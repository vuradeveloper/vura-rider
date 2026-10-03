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
| `e72eb3e` | Vehicle photos come from the **local Car DB**, always the white model for any colour the driver picks, matched against the DB's own production ranges; CarsXE off behind `VEHICLE_IMAGES_SOURCE`; adds `scripts/import-car-db.js` |

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

## Vehicle photos now come from the local Car DB, not CarsXE

`VEHICLE_IMAGES_SOURCE` defaults to `cardb`, so CarsXE no longer runs: a miss is no
longer a queued fetch. `runCarsxeFetch()` returns before it can spend a credit,
whoever calls it. Flip the variable to `carsxe` to restore the old path exactly.

**Import it (this is the step that fills the table):**

```bash
cd ~/vura-rider
CARSXE_ADMIN_PASSWORD='...' node scripts/import-car-db.js \
  --dir="C:\Users\mbofh\Downloads\New Car DB"     # Windows, from the repo root
node scripts/import-car-db.js --selftest          # no upload, no DB, no network
node scripts/import-car-db.js --dry               # what it would import
```

It needs **no AWS key and no database access** — it posts each original file to the
existing `/api/admin/vehicle-images/seed` endpoint with `process:true` (the server
runs the standard key-out/trim/900×560/WebP-under-80KB pipeline, so an import looks
identical to a fetched photo) and `approve:true` (195 hand-checked images need no
195 manual approvals). Re-running is safe: it overwrites the same rows.

**What the folder holds:** 195 files → **152 imported**, 4 skipped because the DB has
no white model of that car, 0 unreadable names, and 31 cars had duplicate `_vN`
copies collapsed to one (the best variant: `_Recolored` first, then the highest
`_vN`). The 4 skipped are `Chevrolet_Aveo_2008-2011_Silver.png`, `Toyota_Camry_Blue.jpg`,
`Volkswagen_Polo-Hatch_2017-Present_Blue.jpg` and `..._Red.jpg`.

**Always white, whatever the driver picks.** The requirement is not "white when no
colour is given" — the lookup takes no colour parameter at all, so red, black and
purple all resolve to the white row. The rule lives in `resolveVehicleImage`.

**Year matching is against the DB's own ranges.** `generationRange()` guesses a
4-year bucket (`2017-2020`), which can never equal the DB's `2016-2019` or
`2020-Present`. The stated range is now stored in a new `year_range` column and
tested for membership, so a 2019 A4 gets `Audi_A4_2016-2019_White` and a 2025 A5 gets
`Audi_A5_2020-Present_White`. `pickBestWhiteRow()` is the single pure function
deciding which image wins; `--selftest` proves it against all 152 entries and prints
`✓ self-test passed`.

## Only photographed cars can be picked, and the colour silhouette is gone (`ad06243`)

The rider can only see a car photo if the driver's car has an approved image, so the
picker now offers exactly what the library can serve. `GET /api/drivers/vehicle-catalogue`
builds its makes/models from `vehicle_images` (`status='approved'`, `image_url IS NOT
NULL`, `colour='white'`) instead of the static catalogue, which offered 24 makes / 150+
models while only 126 models had a picture - every other pick fell through to the SVG.
Now every car a driver can select resolves to a real photo; there is nothing left to
offer that cannot be served. Colours, body types and fallbacks still come from the static
catalogue, and it is also the failure fallback, so the dropdown can never come back
empty.

Live library: **152 approved white rows, 27 makes, 126 models.** Model tokens come back
as labels (`polo-hatch` -> `Polo Hatch`); they round-trip through the server's
`normToken()` on save, so no driver-app change was needed and the stored model still
matches exactly.

### Year: proven, not asserted

`pickBestWhiteRow()` uses the year ONLY as a tie-breaker (exact model > variant, then
"a stated range that covers it", then the nearest range start, then the newest approval).
It is never a filter, so no year can stop an image being served. Two commands prove it:

```bash
cd server
node _cat_test.mjs     # 152 library pairs -> 27 makes / 126 models
                       # 0 missing, 0 bad round-trips, 0 offered without an image   PASS
node _year_test.mjs    # 152 cars x 13 years (1990..9999, null, undefined) = 1976
                       # resolutions, 0 failures; + 104 generic-model lookups = 0     PASS
```

### The coloured silhouette is gone

`figma-ui/src/components/vehicle/VehicleImage.tsx` no longer paints the body layer in the
car's colour - it is always `GENERIC_CAR_HEX` (neutral grey). A red car drawn where a
photo belongs reads as "this is your driver's car" rather than "we have no photo of it";
grey is unmistakably a placeholder, and the card's own text still names the real colour,
make and model. The `colour` prop was removed so a colour cannot be passed in by mistake,
and `DriverVehicleCard` now falls back to the placeholder when a photo URL fails to load
instead of showing a broken image frame.

Found while doing this: the `missing` prop was documented as "no vehicle data at all ->
neutral grey generic car" but was never referenced in the component, so a car with no
data at all rendered SILVER. The prop and the bug are both gone.

`figma-ui/src/assets/vehiclePhotos.json` is **EMPTY (0 entries)**, so the server-resolved
`vehicle_image_url` is the only photo path in practice; the bundle lookup is kept as
documented dead code (the offline path if that generator is ever run again).
## The library cars are now KNOWN cars, not guessed ones (`d7cf8c7`)

Pruning the picker to the image library exposed something the library had been hiding:
**81 of those 126 cars were not in the static catalogue at all**. `resolveBodyType()`
falls back to hatchback and `resolveCategory()` then returns "economy", so a Toyota
Hiace, a BMW 5 Series or a Tesla Model Y would have been offered and then TIERED and
drawn as an economy hatchback. None of those cars could be picked before the pruning,
so this was a bug the pruning would have introduced.

1. `norm()` now treats `-` and `_` as a space. The same car is "3 Series" in the
   catalogue and "3-series" in the DB (`normToken` on save), and the two never matched:

       findModel("BMW", "3-series")    before: null       -> guessed hatchback / economy
                                       after:  "3 Series"  -> sedan / comfort

   The same bug affected the driver app's bundled list, which has offered "BMW 3 Series"
   and "Mercedes C-Class" since it was written.

2. The catalogue gained those 81 cars and the 9 makes they arrived with: **Bajaj, Byd,
   Chevrolet, Citroen, Lexus, Maxus, MG, Tesla, Volvo**. It is now 32 makes / 179 models.
   Categories follow the file's existing rule (bakkie/minibus/suv -> xl, sedan ->
   comfort, hatchback -> economy), so `category` is written only where it differs.

   The dropdown also uses the catalogue's own spellings now, so a driver reads "XC90",
   "BR-V", "ZS EV", "S-Presso" instead of the slug-prettifier's "Xc90", "Br V" and so on.
   A variant keeps its own label: polo-hatch stays "Polo Hatch".

Every check, all PASS:

```bash
cd server
node _gen_fallback.mjs --check    126 offerable cars, 126 KNOWN, 0 guessed        PASS
node _cat_test.mjs                126 models, 0 missing, 0 bad round-trips        PASS
node _year_test.mjs               1976 car/year resolutions, 0 failures           PASS
node _catalogue_live.mjs --local  0 offered without a photo, 0 photos un-offered  PASS
node _cat_show.mjs                shape + tier table for a sample of cars
```

Known data wart, left in place and commented in the file: the Car DB has a
`volkswagen|v-class` row that is really a Mercedes. It is listed under Volkswagen only
so the nonsense car still gets a sane shape and tier - delete that one row in the admin
review page when convenient.

### The driver app's offline list (`vura-driver` `93b1bdc`)

`VehicleDetails.tsx` falls back to a bundled `FALLBACK_ROWS` when the endpoint cannot be
reached, and that list was still the original "most common SA cars" short list - so a
driver on a flaky connection could pick a car with no photo and the rider got the
placeholder. It is now the same 126 library cars, generated from the same source, so the
online and offline lists cannot disagree. Regenerate with `_gen_fallback.mjs` and
`_patch_fallback.mjs` after importing photos.

A driver APK rebuild is needed for that (offline path only). The ONLINE picker needed no
app change at all - it always came from the server.
## Run the deploy (AWS CloudShell)

```bash
cd ~/vura-rider && git pull --ff-only
git log --oneline -1          # must print d7cf8c7
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

- **rider** — 8.84 MB, built 2026-10-01 02:21, SHA256 `F32562078CD12938…`
  `vura-rider.apk` = `vura-rider-figma.apk` = `vura-rider-2026-10-01.apk` =
  `vura-rider-2026-10-02.apk` = `VURA-RIDER-latest.apk`
- **driver** — 8.07 MB, built 2026-10-01 18:27, SHA256 `48B0088B19490C27…`
  `vura-driver.apk` = `vura-driver-figma.apk` =
  `vura-driver-2026-10-01-locationfix.apk` =
  `vura-driver-2026-10-02-locationfix.apk` = `VURA-DRIVER-latest.apk`

**`vura-driver-2026-10-01.apk` is NOT that build.** It hashes differently
(`7D10A859878834F3…`) and was written 02:25, before the GPS fix — installing it
reproduces the *"Location is off"* banner and the silent no-offer state that
started this work. Delete it.

The three fixes are provably inside the good APK: its bundled web assets
(`figma-ui/android/app/src/main/assets/public/assets/index-*.js`) contain
`maximumAge`, `ride:offer:cancelled` and `ride:taken`. Verify any future APK the
same way — grep those three strings in the **asset** copy, not in `dist`, because
only the asset copy is what the WebView loads. The availability path itself reads
`getCurrentPosition(…,{enableHighAccuracy:!1,maximumAge:6e4,timeout:2e4})` with a
15 s refresh and a 4 s retry, so the `maximumAge:0`/`timeout:12e3` hits in that
same bundle are unrelated map helpers, not the dispatch path.

**Client drift — neither APK is the tip of its client source.**

- **rider** is one client commit behind: `66d1ac9` (2026-10-01 11:04, *"fix(search):
  ask HERE for relevance, not distance"*) touched `figma-ui/src` after the 02:21
  build, so that change is **not** on the phone yet.
- **driver** matches the source exactly. The fix was committed later (`51ace72`,
  2026-10-02 07:42), but the 18:27 build came from that same working tree — which
  the bundle contents confirm.

**Being a dispatch candidate needs a fix under 30 s.** The diag row for
`makhavhuju@gmail.com` reads `online=True, coords=True` but `locAge=128s` →
`is_candidate=False`: the phone *is* reporting, the app was simply suspended. With
the fixed APK in the foreground the 15 s refresh keeps the row inside the window;
backgrounded, nothing does. `users.role` is **not** a dispatch gate — there is no
`requireRole`/`requireDriver` anywhere, and the candidate predicate is only
`is_online` + `status` + coords + freshness — so the `driverRoleMismatch` entry is
cosmetic for offers. Note the self-heal in `POST /api/drivers/online` never fires
for the real app, because the app goes online over the socket (`driver:online`),
which writes `driver_profiles` only.

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
