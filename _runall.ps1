$root = 'c:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider'
Set-Location "$root\server"
npx vitest run --exclude '**/*.integration.test.ts' *> "$root\_va.txt"
$vc = $LASTEXITCODE
$m = Get-Content -Encoding Unicode "$root\_va.txt"
$sum = ($m | Select-String -Pattern 'Test Files|Tests ' | ForEach-Object {$_.Line.Trim()}) -join [Environment]::NewLine
$fail = ($m | Select-String -Pattern 'FAIL|AssertionError' | Select-Object -First 20 | ForEach-Object {$_.Line.Trim()}) -join [Environment]::NewLine
[IO.File]::WriteAllText("$root\_vaf.txt", "VITEST=$vc`n$sum`n---`n$fail")
