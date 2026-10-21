$root = 'c:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider'
Set-Location "$root\server"
npx tsc --noEmit *> "$root\_t.txt"
$tc = $LASTEXITCODE
npx vitest run src/services/dispatch.destination.test.ts *> "$root\_vd.txt"
$vc = $LASTEXITCODE
$m = Get-Content -Encoding Unicode "$root\_vd.txt"
$sum = ($m | Select-String -Pattern 'Test Files|Tests ' | ForEach-Object {$_.Line.Trim()}) -join [Environment]::NewLine
$fail = ($m | Select-String -Pattern 'FAIL|destination-mode|flag OFF|fitting|drop-off|allowlisted|Q13|deeply' | Select-Object -First 30 | ForEach-Object {$_.Line.Trim()}) -join [Environment]::NewLine
[IO.File]::WriteAllText("$root\_vdf.txt", "TSC=$tc VITEST=$vc`n$sum`n---`n$fail")