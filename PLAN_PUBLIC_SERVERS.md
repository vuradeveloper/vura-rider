# PLAN_PUBLIC_SERVERS.md — deploy the server without leaning on public demos

**Status: implemented server-side in RC3 (vura-rider `release-candidate-3`).
This document is the contract + the operator runbook; app-side items are
DOCUMENTED ONLY (nothing client-side changed for them in RC3).**

## The rule (one sentence)

**Env var set → use it. Unset + not production → today's public demo (dev
keeps working). Unset + `NODE_ENV=production` → the seam fails HONESTLY
(503 / no tiles / empty answer) — a public demo URL is never called from
production, because router.project-osrm.org, nominatim.openstreetmap.org and
tile.openstreetmap.org all publish usage policies that ban production traffic.**

Everything lives in one module: `server/src/services/providerSeams.ts`, so the
rule is testable in isolation (`providerSeams.test.ts`, 11 tests) and printed
at boot by `logProviderSeams()` (called from `index.ts` right after
`logEtaProviderStatus()`).

## Server seams (RC3 code)

| Env var | Consumed by | Dev default (unset) | Production (unset) | Boot-log line starts with |
|---|---|---|---|---|
| `ROUTE_PROVIDER_URL` | `routes/route.ts` (`/api/route` upstream) AND `services/eta.ts` (matching road-ETA matrix) | public OSRM demo for `/api/route`; ETA provider stays UNCONFIGURED (eta has no demo fallback at all) | `/api/route` → **503** `Routing provider not configured (set ROUTE_PROVIDER_URL)`; ETA → haversine ranking only | `ROUTE_PROVIDER_URL (rider route + matching ETA): …` |
| `NOMINATIM_URL` | `routes/search.ts` (OSM fallback leg of `/api/search/geocode`) | public Nominatim | geocode fallback → **503** `Search provider not configured (set NOMINATIM_URL)` (HERE still answers when `HERE_API_KEY` is set — which is the production configuration) | `NOMINATIM_URL (geocode fallback): …` |
| `SHARE_TILE_URL` | `routes/share.ts` (server-rendered Leaflet page) | public `tile.openstreetmap.org` | **no tile layer** — markers + route line still render on the grey map background | `SHARE_TILE_URL (trip-share page tiles): …` |
| `SEARCH_PROVIDER` | `routes/search.ts` | unset → `here_then_nominatim` | same semantics | `SEARCH_PROVIDER: here_then_nominatim|here_only|nominatim_only (HERE_API_KEY present/absent)` |
| `HERE_API_KEY` | `routes/search.ts` (primary geocode/suggest) | unset → straight to the Nominatim leg | keep SET (documented production config) | folded into the `SEARCH_PROVIDER` line |

`SEARCH_PROVIDER` semantics (this is the env var `deploy/SELFHOST-MAPS.md`
and `AWS-NEW-ACCOUNT-SETUP.md` already told operators to set — RC3 is the
code that actually reads it):

- unset / anything else → HERE first, Nominatim fallback (today's behaviour);
- `here` → HERE only: an empty HERE answer returns an empty list, no OSM leg;
- `nominatim` → skip HERE entirely (self-hosted-geocoder deployments).

## Boot log (the operator's single source of truth)

```
[providers] external provider seams (env-driven; no public demo in production):
[providers]   ROUTE_PROVIDER_URL (rider route + matching ETA): http://vura-maps:8080 (env)
[providers]   NOMINATIM_URL (geocode fallback): http://vura-maps:8081 (env)
[providers]   SHARE_TILE_URL (trip-share page tiles): NOT CONFIGURED — production needs the env var; calls fail honestly (503) instead of using the public demo
[providers]   SEARCH_PROVIDER: here_then_nominatim (HERE_API_KEY present)
```

Any `NOT CONFIGURED` line in production = set the var (EB → Configuration →
Environment properties → Apply changes) and confirm on the next deploy's log.

## Verify after a production deploy

1. Boot log shows `(env)` for every seam you intend to use.
2. `curl -s -o /dev/null -w '%{http_code}' 'https://api.ridevura.com/api/route?points=28.04,-26.2;28.05,-26.1'`
   → `200` with `ROUTE_PROVIDER_URL` set; `503` (with the message above) if unset.
3. Geocode without HERE (worst case): expect `503`, never a nominatim call —
   check the instance has no egress to nominatim.openstreetmap.org if paranoid.
4. Trip-share page: map tiles load from `SHARE_TILE_URL`; if that seam is
   unset the page still works, minus the raster map.

## App-side (DOCUMENTED ONLY — not changed in RC3)

The server cannot fix what the apps render themselves. Same rule, later work:

| Where | Today | Plan |
|---|---|---|
| `figma-ui/src/components/LeafletMap.tsx:132` (driver app) | hard-coded `https://{s}.tile.openstreetmap.org/...` | switch to a self-hosted/paid tile URL at Stage 3 (MapLibre migration, `PLAN_DRIVER_APP.md`); until then driver-app traffic is the app-ATTACHMENT allowance, keep volumes observed |
| RN rider `components/MapView*.tsx` / `lib/mapHtml.ts` | same public OSM raster | same Stage-3 move |
| Rider `lib/route.ts` | calls the SERVER `/api/route` (good — inherits the server seam) | none |
| Driver `LeafletMap` route polyline | server `/api/route` | none |

Follow-up ticket (post-RC3): a single `TILE_URL` served by the server (e.g.
`/api/tiles-config`) so every app picks up the operator's tile choice without
a rebuild — that is the honest end-state for "env-driven tiles everywhere".

## Why 503 instead of a silent empty result

Empty lists and grey maps with no explanation are exactly the class of bug
this project keeps paying for (`_LIVE_STATE.md`: HERE silently fell back to
OSM and "Farmers" became farm associations). An unconfigured production seam
must be LOUD: 503 + a message naming the env var, a boot-log line, and zero
calls to a server we have no right to hammer.
