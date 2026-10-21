$root = 'c:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-rider'
[IO.File]::WriteAllText("$root\_gate_step.txt", "started " + (Get-Date).ToString('o'))
& "$root\_gate.ps1"
[IO.File]::AppendAllText("$root\_gate_step.txt", "`nwrapper done")
