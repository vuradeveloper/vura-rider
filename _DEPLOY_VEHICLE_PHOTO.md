# Deploy: the rider's car photo (one resolver decides)

**Commit:** `7b5f7d7` — `fix(vehicle photos): ONE resolver decides the rider's car photo`
**Status:** ✅ **DEPLOYED AND VERIFIED LIVE** — 2 Oct 2026.

```
EB version label : vura-7b5f7d7-20261002-213808   (af-south-1, vura-rider-prod)
env status       : Ready / Green
/health          : {"status":"ok", ...}
diag build.builtAt = 2026-10-02T06:49:16.000Z   (was 2026-10-01T12:24 — the code changed)
diag sharp       = { loads: true, encodedBytes: 95 }
diag storage     = { bucket: vura-driver-docs-171180524226, region: af-south-1 }
library rows     : 156 total, 153 approved, 0 pending, 164 white keys
```

**The fix is proven on prod by four colour-graded runs of `_veh_live_colour.mjs`** — a driver
saves "VW / Polo / 2019" in four different colours, and every one resolves to the SAME white
photo (`PROBE_COLOUR=white|black|silver|red` → all `ALL CHECKS PASSED`, exit 0):

```
vehicle_color = "white"  -> .../volkswagen-polo-vivo-2018-present-white.webp   PASS 200 image/webp
vehicle_color = "black"  -> .../volkswagen-polo-vivo-2018-present-white.webp   PASS
vehicle_color = "silver" -> .../volkswagen-polo-vivo-2018-present-white.webp   PASS
vehicle_color = "red"    -> .../volkswagen-polo-vivo-2018-present-white.webp   PASS
```

**And the served file is genuinely a white car, not a coloured one** — `server/_pixcheck.mjs`
samples the pixels (run it against any `/api/vehicle-images/*.webp`):

| image | saturated px | near-white | transparent |
|---|---|---|---|
| `…polo-vivo-2018-present-white.webp` (served now) | **0.0 %** | 26.9 % | 29.8 % |
| `…polo-2017-2020-red-2-*.webp` (old CarsXE row) | **37.3 %** | 2.7 % | — |

So the control proves the metric discriminates: the served image contains essentially no
colour. (Caveat: the `avg luminance` label in that script is NOT a reliable signal — tyres,
glass and shadow drag it down, and it reads "dark" for both images. Use the **saturated %
column**, which is the one that separates them.)

**Before the deploy**, the identical probe returned `vehicle_image_url = null` for a white car
— that was the reported bug. See "Live evidence … BEFORE this deploy" below for that output.

## Read this first: two separate faults, both now fixed

1. **The Car DB was never imported.** `vehicle_images` had no `|white` rows at all, so the
   lookup could only ever miss. **Fixed:** all **152** white models are imported and
   **approved** on prod (`imported: 152  failed: 0`), each with a stored, serving copy
   (verified `HTTP 200 image/webp`, e.g. `volkswagen-polo-hatch-2017-present-white.webp`,
   74,588 bytes). Re-running the import is safe — it is idempotent per `cache_key`.

2. **The rider's trip card read a *different*, colour-matched query.** This is the part that
   still needs the deploy, and it is the reason the photo stayed missing *even after* the
   import succeeded. The rider's card is fed by `GET /api/rides/me/active`
   (`figma-ui/src/App.tsx` → `getActiveRide()`), which matched:

   ```sql
   WHERE lower(vi.model) = lower(dp.vehicle_model)
     AND lower(vi.colour) = lower(dp.vehicle_color)
   ```

   The curated Car DB keys models by generation (`polo-hatch`, `polo-vivo`, …), so this
   exact-string match on `'polo'` could **never** match `'polo-hatch'` — and a driver who
   saved a colour with no dedicated row matched nothing at all. Result: `vehicle_image_url
   = null` → the app draws its SVG icon.

   **Fixed:** `attachVehicleImages()` in `services/vehicleImages.ts` is now the single source
   of truth, called from `/me/active-state`, `/me/active`, `/history`, `/scheduled`, `/:id`,
   the public `/api/share/:token`, and the `ride:accepted` socket payload. All 7
   colour-matched subqueries were deleted.

## Live evidence, captured on prod BEFORE this deploy

`figma-ui/_veh_live_colour.mjs` (a colour-parameterised copy of `_veh_live.mjs`) mints a
throwaway driver + rider, saves **"VW" / "Polo" / 2019 / white**, books, accepts, and reads
back the rider's own payload:

```
$env:PROBE_COLOUR='white'; node _veh_live_colour.mjs
  vehicle_color = "white"
  vehicle_image_url = null
  FAIL  payload carries a car photo URL - vehicle_image_url=null
  /api/rides/:id also carries it: null
1 CHECK(S) FAILED - the photo is not reaching the rider payload
```

The same probe with the default colour (`red`) **passes** on the old code, because prod
already had a `volkswagen|polo|2017-2020|red` row whose colour and model both matched
exactly. That is why the bug looked intermittent: it only bit drivers whose car had no
same-colour, same-spelling row — which, after the import, is *every* driver, because the
Car DB's generation-suffixed models never match a plain `'polo'`.

## Run this in AWS CloudShell

`deploy/ACCOUNT.md` is authoritative: the env is **`vura-rider-prod` in `af-south-1` (Cape Town)** —
*every* resource lives there, so `--region us-east-1` fails with
`ERROR: NotFoundError - Environment "vura-rider-prod" not Found.`

```bash
cd ~/vura-rider
git fetch origin main
git log --oneline -3          # 7b5f7d7 must be at the top; if not, the deploy ships the OLD code

eb list --region af-south-1   # confirm the real env name before deploying
AWS_REGION=af-south-1 bash deploy/deploy.sh
```

`deploy/deploy.sh` is preferred over a bare `eb deploy` (see `deploy/ACCOUNT.md:70`): EB derives the
version label from `git describe --tags` and rejects any label containing `/`, and the wrapper
deletes local slash-tags and always passes its own slash-free label. Its region comes from
`AWS_REGION`, which CloudShell sets to `us-east-1` by default — hence the explicit
`AWS_REGION=af-south-1` on the command line.

Equivalent one-liner if you would rather be explicit:

```bash
eb deploy vura-rider-prod --region af-south-1 \
  --label vura-$(git rev-parse --short HEAD)-$(date -u +%Y%m%d-%H%M%S)
```

Takes ~5 minutes. `.ebextensions/server-deploy.config` runs `npm ci` on deploy and the rebuilt
`server/dist` is already committed, so no build step is needed.

> The AWS CLI / EB CLI are **not** installed on this Windows machine (see
> `deploy/cape-town/README.md`), so this cannot be run from here.
> `.ebextensions/server-deploy.config` runs `npm ci` on deploy and the rebuilt
> `server/dist` is already committed, so no build step is needed.

## Verify after the deploy finishes

The exact command that failed above must now pass — all three checks:

```powershell
cd 'C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider\figma-ui'
$env:PROBE_COLOUR='white'; node _veh_live_colour.mjs; Remove-Item Env:\PROBE_COLOUR
node _veh_live.mjs          # the original probe (colour "red") must stay green
```

Expected **after** the deploy:

| probe | before (live now) | after |
|---|---|---|
| `vehicle_image_url` | `null` | `https://api.ridevura.com/api/vehicle-images/volkswagen-polo-hatch-2017-present-white.webp` |
| absolute URL a WebView can load | — | `PASS` |
| `HEAD` on that URL | — | `PASS` — `HTTP 200 image/webp` |
| `/api/rides/:id` | `null` | the same URL |
| exit code | `1` | `0` |

No deploy is needed for the import — that is already live. These two commands alone prove
the whole path: **driver saves a car → server resolves the curated white photo → the rider's
payload carries it.**

## What was verified before pushing

| Check | Result |
|---|---|
| `npx tsc --noEmit` on the server | clean, exit 0 |
| `npm run build` (rebuild of `dist`) | clean, exit 0 |
| `node --check` on all 4 changed compiled modules | exit 0 each |
| Boot the **shipped** `dist` against real Postgres (`server/_smoke_dist.ps1`) | `PostgreSQL connected`, `Schema up to date`, routes up |
| `server/_attach_verify.mjs` against real Postgres | **all PASS** — a RED driver car resolves to the WHITE photo for `Red`/`Blue`/`Black`/`Silver`/`null`/`undefined`; a ride list resolves every row; an unknown car stays `null` (SVG fallback intact) |
| `attachVehicleImages(null)` / `attachVehicleImages({})` | no-ops, never throw |
| Leftover `lower(vi.colour)` subqueries in `dist` | **0** |

## Rollback

```bash
cd ~/vura-rider && git revert 7b5f7d7 --no-edit && eb deploy vura-rider-prod --region us-east-1
```

Reverting only restores the previous (broken for non-matching colours) matching; the imported
rows and the new nullable columns are additive and can stay.

## Still open, not part of this fix

- **Driver app car card.** `vura-driver/figma-ui/src/App.tsx` draws a coloured SVG and has **no
  `vehicle_image_url` references at all** (confirmed inside the shipped APK too), so the driver's
  own card cannot show the photo. That needs a server + driver-app change and a new driver APK —
  decide before touching it.

## APK status — verified, corrected

An earlier note in this file claimed the shipped rider APK was "one client commit behind"
(`66d1ac9`). **That was wrong.** Both APKs were re-verified on 2026-10-02:

| | finding |
|---|---|
| Driver APK | a fresh build produces `index-BsBWdJpB.js` — the **exact same content hash inside the APK**. Byte-identical to source (`sha256 48B0088B…`). A rebuild was a no-op: gradle reported `BUILD SUCCESSFUL in 34s · 24 executed, 102 up-to-date` and the hash did not change. |
| Rider APK | a fresh build produces `index-opZBfBgk.js` vs `index-9CmO_n8l.js` in the old APK, so the filenames differ — but the bundles share a **228,588-char byte-identical prefix**, the first divergence is a **chunk filename hash** (`esm-CC1TEKkH` vs `esm-eZx-Q7BH`), and **20 app-level strings compared 1:1 gave 0 mismatches** — including `vehicle_image_url` (2 in the APK) and `relevance` (1, so `66d1ac9` *is* in there). |
| Old rider APK size | 8.84 MB vs 6.34 MB rebuilt. **Nothing was missing:** both have 530 entries; sum(uncompressed) 15,735,240 vs 15,734,993; sum(compressed) 6,516,769 vs 6,516,592. The old file simply carried **2,756,393 B of ZIP/signing-block overhead** vs 130,564 B. |
| The trap that misled the first assessment | all 5 rider APK copies in Downloads have an **identical timestamp**, because `Copy-Item` preserves the source mtime. Timestamps cannot date an APK — compare the bundle instead. |

**Conclusion: no APK rebuild is required for the vehicle-photo fix.** The photo is resolved
server-side and the rider APK already reads `vehicle_image_url`; the driver app has no photo
support by design. The deploy above is the only remaining step.

