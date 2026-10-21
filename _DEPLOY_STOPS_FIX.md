# Deploy: rider stops (waypoints) fix

**Commit:** `ffd832f` — `fix(rides): persist rider stops (waypoints) so drivers actually get them`
**Status:** committed **and pushed** to `origin/main`. Only the production deploy is left.

## Why a deploy is needed

`api.ridevura.com` runs the **committed** `server/dist` through
`Procfile: cd server && node dist/index.js` (EB app `vura-rider`).

The live build's booking INSERT has **no waypoints column**, so stops chosen in the
rider app are dropped server-side and never reach the driver. The fix is already
committed **including the rebuilt `server/dist`**, and `.ebextensions/server-deploy.config`
runs `npm ci` on deploy — so `eb deploy` ships it with no build step.

Nothing has to be run against the database by hand: the server adds
`rides.waypoints JSONB` itself on boot (idempotent `ALTER TABLE ... ADD COLUMN IF
NOT EXISTS`), and every new query falls back to the old SQL if it cannot.

## Run this in AWS CloudShell

```bash
cd ~/vura-rider && git pull
eb list --region af-south-1                                   # the env is vura-rider-prod in af-south-1
AWS_REGION=af-south-1 bash deploy/deploy.sh                   # NOT us-east-1: nothing lives there
```

> **Region corrected (2 Oct 2026).** This note previously suggested `--region us-east-1`, which fails
> with `ERROR: NotFoundError - Environment "vura-rider-prod" not Found.` `deploy/ACCOUNT.md` is
> authoritative: the EB env `vura-rider-prod` and every other resource live in **`af-south-1`
> (Cape Town)** — hostname `vura-rider-prod.eba-2uy5gtu2.af-south-1.elasticbeanstalk.com`. The old
> us-east-1 env (`…eba-sqwpehvf.us-east-1…`) belongs to the legacy account `456097556241`.

Deploy to the env that serves `api.ridevura.com`. Takes ~5 minutes. Watch the
EB console until the env goes green.

> The AWS CLI / EB CLI are not installed on this Windows machine (see
> `deploy/cape-town/README.md`), so this cannot be automated from here.
> `_deploy_wp.ps1` in this folder targets an older Oracle-VM + systemd setup and is
> **not** part of the live deploy path — ignore it unless the VM is still in use.

## Verify after the deploy finishes

One command does it — it mints a fresh rider (probe accounts are timestamped) and
books a real ride with two stops:

```powershell
cd 'C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider\figma-ui'
powershell -NoProfile -ExecutionPolicy Bypass -File .\_verify_stops.ps1
```

Expected **after** the fix — baseline captured live on 2026-09-26, before the deploy:

| probe | before (live now) | after |
|---|---|---|
| `waypoints: [obj]` | `waypoints=null` | `waypoints=[{...},{...}]` ← the app's key |
| `stops: [obj]` | `waypoints=null` | `waypoints=[{...},{...}]` ← legacy key, now an alias |
| `waypoints: JSON string` | `waypoints=null` | `waypoints=null` (a string is not an array) |
| `route_data` / `route` / baseline | `waypoints=null` | `waypoints=null` (still not stored) |
| `POST /api/rides/schedule` → `GET /api/rides/:id` | 201 / `waypoints = undefined` | 201 / `waypoints = [{...},{...}]` |

The socket probes need an online/available driver, otherwise they report
`could not book (no_drivers)`; the `/schedule` probe always runs (it is a
reservation, no driver involved) and cancels itself afterwards. Point the probe at
another server with `$env:VURA_API`.

Note: there is no plain `POST /api/rides` — the earlier 404 from that probe was a
wrong guess at the endpoint, not a server problem. Reservations go through
`POST /api/rides/schedule` (minimum 30 minutes lead time).

Quick sanity check that the new build is serving:

```bash
curl -s https://api.ridevura.com/health
```

## What was verified before pushing

| Check | Result |
|---|---|
| `npx tsc --noEmit` on the server | clean, exit 0 |
| `npx tsc` rebuild of `dist` (all 140 files; only the 2 modules changed) | clean, exit 0 |
| `node --check` on both changed modules, source and compiled | OK |
| The patched INSERT replayed against real Postgres in a transaction that is then **rolled back** (`server/_wp_verify.mjs`) | **PASS** — stops written and read back, 0 rows persisted |
| Booting the actual `dist` locally (`server/_smoke_dist.ps1`) | `Schema up to date`, `/health` → 200, `/api/rides/available` → 401 |

## Rollback

```bash
cd ~/vura-rider && git revert ffd832f --no-edit && eb deploy vura-rider-prod --region us-east-1
```

`waypoints` is additive and nullable, so the column can stay — an older build
simply ignores it.

## Unchanged, no action needed

- **Push notifications.** The server sends **Expo** push only
  (`services/push.ts` filters to `ExponentPushToken[...]`, posts to `exp.host`).
  A Capacitor APK cannot mint an Expo token, so push cannot reach the `.figma`
  builds no matter what is in `google-services.json`. While the app is open,
  delivery works through the socket plus the driver's 1s `/api/rides/available` poll.
- **Paystack.** Working. The in-app Custom Tab is required (Paystack sends
  `x-frame-options: SAMEORIGIN`, so an iframe is impossible); it only appears for
  one-time card registration — ride charges go through server-side
  `chargeAuthorization` with the saved authorization code.
