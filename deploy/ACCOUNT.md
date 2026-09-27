# Vura — account & infrastructure identity

**Fill this in. No secrets in this file** — secrets live in EB environment properties and the
password manager (see `deploy/AWS-NEW-ACCOUNT-SETUP.md` §2 mistake 2 and §4).

## AWS — the account in use now (production)

| Field | Value | Where to find it |
|---|---|---|
| Account ID | `171180524226` | verified 27 Sep 2026 with `aws sts get-caller-identity` |
| Account alias / sign-in URL | `https://__________.signin.aws.amazon.com/console` | Console → Account → alias |
| Root email | `________________` (recommended: `aws@ridevura.com` via Cloudflare Email Routing) | |
| Region | `af-south-1` | verified — every resource lives here |
| Elastic Beanstalk app / env | `vura-rider` / `vura-rider-prod` | EB console |
| EB hostname | `vura-rider-prod.eba-2uy5gtu2.af-south-1.elasticbeanstalk.com` | EB → env → URL. Serves **HTTP only** — Cloudflare terminates TLS for `api.ridevura.com` |
| EB instance SG | `sg-070019b918e15eded` | EC2 → Security groups (tag `elasticbeanstalk:environment-name`) |
| RDS instance / endpoint | `vura-prod` / `vura-prod.c1mcea0s8maz.af-south-1.rds.amazonaws.com` (db `vura`, user `vura_admin`, private, StorageEncrypted, 20 GB + autoscaling) | RDS → Databases → Connectivity |
| RDS security group | `sg-0ac99f697843e73a5` (`vura-rds-sg`) — 5432 open **from the EB instance SG**, not from a CIDR | EC2 → Security groups |
| DB name / user | `vura` / `vura_admin` | |
| S3 documents bucket | `vura-driver-docs-171180524226` — versioned, public access blocked, region `af-south-1` | S3 console |

**Migration status (verified 27 Sep 2026).** `api.ridevura.com` already serves this environment
(Cloudflare CNAME, confirmed by a unique access-log probe in `deploy/verify-new-account.sh`), but
**no data was migrated**: RDS `vura-prod` reports `DBSnapshotIdentifier=None` and was created empty
on `2026-09-26T22:48`. The app self-heals the *schema* (boot bootstrap + an idempotent
`ensureTable()` in every route) but not the *rows* — no ride history, wallets, earnings, driver
approvals or document metadata; `community_places` re-imports from OSM on its own. Run
`bash deploy/verify-new-account.sh`: it prints the RDS provenance line and warns about this.
| IAM admin user (daily use) | `vura-admin` | IAM → Users |
| MFA devices on root | 1) **virtual TOTP** — `arn:aws:iam::171180524226:mfa/ridevura` (created 26 Sep 2026) — **verify it is attached to root, not only to an IAM user**; 2) passkey (Windows Hello) — still to add | IAM → Security credentials |

## Previous AWS account (legacy — keep until the migration is signed off)

| Field | Value | Evidence |
|---|---|---|
| Account ID | `456097556241` | `deploy/rds-backup.sh:31`, `deploy/cape-town/02-backup-and-restore-db.sh:40` |
| Console access | **blocked in practice** — the 31 Aug / 6 Sep CSV sign-in (`nhlanhlabhengu99@gmail.com` at `https://456097556241.signin.aws.amazon.com/console`) does not get in (stale password or an MFA prompt with no device). No longer blocking: the old data turned out to be test-only, see below. Recovery if ever needed: root "Forgot password" via the root email inbox, or AWS account recovery with proof of ownership (invoice / phone on file). | attempt 27 Sep 2026 |
| EB app / env (us-east-1) | `vura-rider` / `vura-rider-prod` → `vura-rider-prod.eba-sqwpehvf.us-east-1.elasticbeanstalk.com` | `deploy/cape-town/00-overview.sh:33` |
| EB app / env (af-south-1, "cape2") | `vura-rider-prod-cape2.eba-heeiam6b.af-south-1.elasticbeanstalk.com` — **this was the live `api` CNAME target before the move** (proof the old account's production was already in af-south-1) | `ridevura.com.txt` DNS export, 16 Sep 2026 |
| **Rollback target for the `api` CNAME** | `vura-rider-prod-cape2.eba-heeiam6b.af-south-1.elasticbeanstalk.com` — confirm it still exists before relying on it | same |
| RDS endpoint (pre-cape) | `vura.cy1qwqwmkmvc.us-east-1.rds.amazonaws.com` (db `vura`, user `vura_admin`) | `deploy/production.env:9` |
| RDS after the cape-town move | never identified by name (console blocked) — but its **data was readable anyway**: the `cape2` env still answers on plain HTTP and served real DB rows on 27 Sep 2026 | `server/_probe_old_api.cjs` |
| Data handover | **NOT NEEDED — deliberately dropped (27 Sep 2026).** Read through the old backend's own API with a service-account token (no AWS sign-in): the old DB holds **test/demo data only** — 28 Firebase accounts, of which the non-test ones are the owner's Gmails (`mbofhenijunior7@`, `makhavhuemjay@`, `nhlanhlabhengu99@`) plus `*@vura-test.dev` / `@vura.app` fixtures, **none with a phone number**; total activity ≈14 test rides, R3.92 earned, one test licence-disk document. Nothing of commercial value is lost. | probe output, 27 Sep 2026 |
| Old env security | the `cape2` backend is still publicly reachable over **plain HTTP** and still accepts the **default dev-log key** (`vura-devlog-key`), so its device logs are world-readable. **Terminate that environment** (and the old account's resources) instead of holding them for 7 days. The new env uses 32-char custom keys — fine. | probe, 27 Sep 2026 |

## Other panels — who owns what

| Layer | Provider | Notes |
|---|---|---|
| Domain registrar | **Namecheap** | `ridevura.com`; nameservers → Cloudflare's pair only |
| DNS + proxy | **Cloudflare** | NS `arvind.ns.cloudflare.com`, `arya.ns.cloudflare.com`; `api` proxied |
| Public site | **Vercel** | `ridevura.com` 308 → `www.ridevura.com` |
| Admin backoffice | **Cloudflare Pages** | `vura-admin-backoffice.pages.dev` — if live |
| Auth | **Firebase** | project `vura-f667d` (sender `678275862018`) |
| Payments | **Paystack** (live) | callback `https://api.ridevura.com/api/payments/return` |
| Email | **Resend** | from `onboarding@ridevura.com` |
| API hostname | `https://api.ridevura.com` | proxied CNAME → EB; never rename (clients hardcode it) |

## Secrets policy

Never in this file, never in git. Values live in:
1. Elastic Beanstalk → Configuration → Environment properties (list in
   `deploy/env.prod.example`), and
2. the password manager (root credentials, DB password, Paystack/Resend keys, Firebase
   service-account JSON, TOTP secrets/recovery codes).

Rotate every secret after any hand-over. Full checklist:
`deploy/AWS-NEW-ACCOUNT-SETUP.md` §4 and §9.
