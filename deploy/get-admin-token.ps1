# ─────────────────────────────────────────────────────────────────────────────
# get-admin-token.ps1 — mint a Firebase ID token for an ADMIN_EMAILS account.
#
# The admin features API (§8 of DEPLOY_RC4.md) accepts only a Firebase ID
# token whose email is in ADMIN_EMAILS; this prints ONE token to stdout and
# keeps the password (secure prompt) and API key off disk / out of history.
#
# Usage:
#   .\deploy\get-admin-token.ps1 -Email you@ridevura.com
#   $env:FIREBASE_WEB_API_KEY = '<web-api-key>'   # optional: skips the key prompt
#
# FIREBASE_WEB_API_KEY: Firebase console → Project settings → General →
# Web API Key. Then: -H "Authorization: Bearer <printed-token>"
# ─────────────────────────────────────────────────────────────────────────────
param(
    [Parameter(Mandatory = $false)] [string] $Email = $env:EMAIL,
    [Parameter(Mandatory = $false)] [string] $ApiKey = $env:FIREBASE_WEB_API_KEY
)

if (-not $Email) { $Email = Read-Host 'Admin email (must be in ADMIN_EMAILS)' }

$secure = Read-Host 'Password (not echoed)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if (-not $ApiKey) { $ApiKey = Read-Host 'Firebase Web API Key' }

$body = @{ email = $Email; password = $password; returnSecureToken = $true } | ConvertTo-Json -Compress
try {
    $r = Invoke-RestMethod -Method Post `
        -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$ApiKey" `
        -ContentType 'application/json' -Body $body
    if (-not $r.idToken) { throw 'response carried no idToken' }
    Write-Output $r.idToken
} catch {
    Write-Error ("get-admin-token.ps1: sign-in failed: " + $_.Exception.Message)
    exit 1
} finally {
    Remove-Variable password -ErrorAction SilentlyContinue
}