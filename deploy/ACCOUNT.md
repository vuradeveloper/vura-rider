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
| RDS instance / endpoint | `vura-prod` / `vura-prod.<12-char-id>.af-south-1.rds.amazonaws.com` — 51 chars, print it with `aws rds describe-db-instances --region af-south-1 --db-instance-identifier vura-prod --query 'DBInstances[0].Endpoint.Address' --output text` | RDS → Databases → Connectivity |
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
| EB app / env | `vura-rider` / `vura-rider-prod` (us-east-1) | `deploy/cape-town/README.md` |
| RDS endpoint | `vura.cy1qwqwmkmvc.us-east-1.rds.amazonaws.com` | `deploy/production.env` |
| Access today | unknown — IAM user `makhavurr` / `developerdev3839@gmail.com` | `deploy/cape-town/STEPS.md:7` |
| Passkey account (NOT the app account) | `054037132330` | passkey ARN in the Windows dialog, 26 Sep 2026 |
| EB hostname (the **rollback target** for the `api` CNAME) | **not recorded** — print it with the old account's credentials: `aws elasticbeanstalk describe-environments --region us-east-1 --application-name vura-rider --query 'Environments[].[EnvironmentName,Status,Health,CNAME]' --output text`, or read Cloudflare → Audit Log → last change to the `api` record | missing as of 27 Sep 2026 |
| Data handover | **not done** — `aws rds describe-db-snapshots --region us-east-1 --db-instance-identifier vura --snapshot-type manual` returned nothing (run it with *old-account* credentials; an empty result with new-account credentials means nothing) | `AWS-NEW-ACCOUNT-SETUP.md` §6 |

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
