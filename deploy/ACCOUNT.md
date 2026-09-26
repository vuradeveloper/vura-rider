# Vura — account & infrastructure identity

**Fill this in. No secrets in this file** — secrets live in EB environment properties and the
password manager (see `deploy/AWS-NEW-ACCOUNT-SETUP.md` §2 mistake 2 and §4).

## AWS — the account in use now (production)

| Field | Value | Where to find it |
|---|---|---|
| Account ID | `171180524226` | Console → top-right account menu → Account |
| Account alias / sign-in URL | `https://__________.signin.aws.amazon.com/console` | Console → Account → alias |
| Root email | `________________` (recommended: `aws@ridevura.com` via Cloudflare Email Routing) | |
| Region | `________________` (recommended `af-south-1` for SA users) | Console → region dropdown |
| Elastic Beanstalk app / env | `vura-rider` / `vura-rider-prod` | EB console |
| EB hostname | `________________________________.elasticbeanstalk.com` | EB → env → URL |
| RDS endpoint | `________________________________` | RDS → Databases → Connectivity |
| DB name / user | `vura` / `vura_admin` | |
| S3 documents bucket | `________________` | S3 console |
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
