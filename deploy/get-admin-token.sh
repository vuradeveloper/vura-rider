#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# get-admin-token.sh — mint a Firebase ID token for an ADMIN_EMAILS account.
#
# The admin features API (§8 of DEPLOY_RC4.md) accepts only a Firebase ID
# token whose email is in ADMIN_EMAILS; this prints ONE token to stdout and
# keeps everything else (password, key) off disk and out of the shell history.
#
# Usage:
#   EMAIL=you@ridevura.com ./deploy/get-admin-token.sh          # prompts for password + key
#   EMAIL=... PASSWORD=... FIREBASE_WEB_API_KEY=... ./deploy/get-admin-token.sh
#
# FIREBASE_WEB_API_KEY: Firebase console → Project settings → General →
# Web API Key. Requires curl + jq (present in AWS CloudShell / any macOS /
# most Linux distros).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

EMAIL="${EMAIL:-}"
PASSWORD="${PASSWORD:-}"
API_KEY="${FIREBASE_WEB_API_KEY:-}"

command -v jq >/dev/null 2>&1 || { echo "get-admin-token.sh: jq is required (apt-get install jq)" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "get-admin-token.sh: curl is required" >&2; exit 1; }

if [ -z "$EMAIL" ]; then
  read -r -p 'Admin email (must be in ADMIN_EMAILS): ' EMAIL
fi
if [ -z "$PASSWORD" ]; then
  read -r -s -p 'Password (not echoed): ' PASSWORD
  echo >&2
fi
if [ -z "$API_KEY" ]; then
  read -r -p 'Firebase Web API Key: ' API_KEY
fi

resp="$(curl -fsS \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg e "$EMAIL" --arg p "$PASSWORD" \
        '{email:$e, password:$p, returnSecureToken:true}')" \
  || true)"

token="$(printf '%s' "$resp" | jq -r '.idToken // empty' 2>/dev/null || true)"
if [ -z "$token" ]; then
  echo "get-admin-token.sh: sign-in failed: ${resp:-no response}" >&2
  exit 1
fi
printf '%s\n' "$token"