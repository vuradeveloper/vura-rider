$root = 'c:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider'
Set-Location "$root\server"
npx tsc --noEmit *> "$root\_t.txt"
$tc = $LASTEXITCODE
npx vitest run --exclude '**/*.integration.test.ts' *> "$root\_va.txt"
$vc = $LASTEXITCODE
"TC=$tc VITEST=$vc" | Out-File -Encoding ascii "$root\_gate.txt"

