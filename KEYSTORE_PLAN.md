# KEYSTORE_PLAN.md — dedicated release signing key for the figma-ui driver app

**Status: PLAN ONLY.** Nothing here has been executed — no keystore exists yet,
no build file was touched. Running §1 needs explicit approval.
**Audit facts (2026-10-09):** `figma-ui/android` defines **no `signingConfig`**,
so `assembleRelease` is unsigned, while the shipped APK
`vura-driver-figma-2026-09-28.apk` is v2-signed with the **machine-default debug
key** `C:\Users\mbofh\.android\debug.keystore` (alias `androiddebugkey`,
SHA-256 `B8:48:7F:D4:07:A7:89:58:8B:79:3E:0C:C9:BB:7E:AF:BA:40:F6:DA:CA:74:2A:43:FB:4D:21:6C:65:B6:02:9D`)
— which is **not** the Expo project's debug keystore
(`vura-driver\android\app\debug.keystore`, SHA-256 `FA:C6:17:45:…:3B:9C`).
*(`PLAN_DRIVER_APP.md`, the 4-stage driver-app plan referenced below, lives on
the `module2-destination` / `docs/module2-dist-gate` line, not this branch.)*

---

## 1. Generate the release keystore (run once, by hand)

PKCS12, 10 000 days validity, stored **outside every git repo**:

```powershell
# one-time: folder outside all repositories
New-Item -ItemType Directory -Force "$env:USERPROFILE\vura-keys"

keytool -genkeypair -v `
  -keystore "$env:USERPROFILE\vura-keys\vura-driver-release.p12" `
  -storetype PKCS12 `
  -storepass <STORE_PASS> `
  -keypass   <STORE_PASS> `
  -alias vura-driver-release `
  -keyalg RSA -keysize 2048 `
  -validity 10000 `
  -dname "CN=Vura Driver, O=Vura (Pty) Ltd, L=Cape Town, ST=Western Cape, C=ZA"
```

- **File:** `C:\Users\mbofh\vura-keys\vura-driver-release.p12` — outside the
  repo, never `git add`'d (ignore rules in §2a are belt-and-braces).
- `-keypass` **must equal** `-storepass`: PKCS12 stores the key inside the
  store, so keytool effectively enforces one password — use a generated
  passphrase (password manager / `pwgen -s 32`), never a reused one.
- 10 000 days ≈ 27 years — comfortably past Stages 1–4 of the driver-app plan.
- Right after generation run `keytool -list -v -keystore … -alias
  vura-driver-release` and file the output per §3 (fingerprint, validity end).

## 2. Wiring `signingConfigs.release` (planned change — NOT applied yet)

**2a. Ignore rules first**, in the repo that owns `figma-ui/android`:

```
figma-ui/android/keystore.properties
*.p12
*.jks
```

**2b. Gitignored `figma-ui/android/keystore.properties`** (local file only):

```properties
storeFile=C\:\\Users\\mbofh\\vura-keys\\vura-driver-release.p12
storePassword=<STORE_PASS>
keyAlias=vura-driver-release
keyPassword=<STORE_PASS>
```

**2c. Planned shape of `figma-ui/android/app/build.gradle`:**

```groovy
def kpFile = file('../keystore.properties')     // app/ → android/
def kp = new Properties()
if (kpFile.exists()) kp.load(new FileInputStream(kpFile))

signingConfigs {
    debug {
        // existing default debug config — unchanged, dev builds only
    }
    release {
        if (!kpFile.exists())
            throw new GradleException("keystore.properties missing — see KEYSTORE_PLAN.md §2")
        storeFile     file(kp['storeFile'])
        storePassword kp['storePassword']
        keyAlias      kp['keyAlias']
        keyPassword   kp['keyPassword']
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release    // ← today: none (unsigned)
        // minifyEnabled / proguardFiles unchanged
    }
}
```

- No password ever sits in `build.gradle`, git, or CI logs — only the local,
  gitignored properties file is read at build time.
- Missing `keystore.properties` → **loud build failure**, never a silently
  unsigned or debug-signed release.

---

## 3. Backup procedure — two locations, one off-machine

| # | Location | What | When |
|---|---|---|---|
| 1 | `C:\Users\mbofh\vura-keys\` (primary, outside git) | `vura-driver-release.p12` | at generation |
| 2 | **Off-machine** — password-manager attachment (Bitwarden/1Password) *or* AES-256-encrypted archive (7z) in a cloud drive *or* copy on a second computer | same file + the record below | same day |

Same two-location rule for the **existing** keys (they are today's production
keys — this is also `FINAL_PREFLIGHT.md` Step 0b):

- `C:\Users\mbofh\.android\debug.keystore` — signs every installed figma APK (`B8:48:7F…`)
- `C:\Users\mbofh\2026-PROJECTS\New Boomnut\vura-driver\android\app\debug.keystore` — Expo app (`FA:C6:17…`)

**Recording checklist — password manager only (never git / chat / email):**

- [ ] File name + primary path
- [ ] Backup location(s) + date copied + restore-tested
- [ ] Alias (`vura-driver-release`)
- [ ] Store password (note: key password = store password)
- [ ] Distinguished name · RSA 2048 · storetype PKCS12
- [ ] Valid from / valid until (10 000 days)
- [ ] SHA-256 fingerprint from `keytool -list -v`
- [ ] Who generated it, when
- [ ] Consequence note: losing this file = no more updatable APKs for every
      driver who installs a build signed with it

## 4. What happens to currently installed drivers

Installed drivers run APKs signed `B8:48:7F…`. An APK signed with the **new**
key is a different signer for the same package `app.vura.driver.figma`, so
Android refuses the update: **`INSTALL_FAILED_UPDATE_INCOMPATIBLE`**.

**Cutover steps:**

1. Build `assembleRelease`, verify per §6, publish through the usual channel.
2. Drivers: **uninstall the old app first** (sideloaded — Play Store is not in
   the loop), then install the new APK (allow unknown sources as before).
3. Drivers **re-login** (phone/OTP), re-grant permissions (location,
   notifications), re-apply in-app settings.

**What they lose:** login/session and everything in app-local storage — cached
rides/searches, in-app settings, permission grants.
**What they do NOT lose:** account, ride history, wallet/balance, vehicle
documents/photos, face-verification data — all server-side, untouched by a
signature change.

**Optional bridge:** drivers who must not reinstall yet can keep receiving
interim updates signed with `~\.android\debug.keystore` — which is exactly why
Step 0b backs that keystore up first.


---

## 5. Timing vs Stage 1 of `PLAN_DRIVER_APP.md` — do this FIRST (your preference: yes)

**Yes — switch signing before Stage 1** ("Set Destination screen + 4 s GPS",
still under `app.vura.driver.figma`):

1. **Fewest installs today** — the forced uninstall/reinstall wave (§4) is at
   its cheapest now; every stage shipped beforehand grows that wave.
2. Stage 1 ships its own update; flipping the key mid-stage makes every
   Stage-1 tester uninstall anyway — do it once, before they exist.
3. Stages 2–3 head toward Play-visible distribution, which needs a real
   release-key story regardless; do the hygiene once, now.
4. The audit facts and tooling are freshly verified (2026-10-09).

**Order:** Step 0b backup (`FINAL_PREFLIGHT.md`) → §1 generate → §3 record +
back up → §2 wire → §6 verify → §4 cutover → *then* Stage 1 development.

## 6. Verify the final APK signature with `apksigner`

`apksigner` ships with Android SDK **build-tools** — this machine currently has
only `C:\Android\platform-tools`, so install build-tools first
(sdkmanager / Android Studio SDK Manager), then:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\<ver>\apksigner.bat" verify --print-certs path\to\app-release.apk
```

**See:**

- `Verified` with the v2 (and v3) scheme = true — never "DO NOT ship this
  file" / v1-only / unsigned;
- `SHA-256 digest:` **equals the fingerprint recorded in §3** — and is **not**
  `B8:48:7F…`;
- cross-check: `keytool -list -v -keystore <p12> -alias vura-driver-release`
  prints the same SHA-256;
- behavioural proof: installing the new APK over an old install fails with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (the §4 cutover in action).

**If any check mismatches → STOP; do not distribute the APK.**

---

*Out of scope (its own plan if the RN app is ever revived): the Expo app's
`vura-driver/android/app/build.gradle` also signs its **release** builds with
the debug keystore (`build.gradle:115`).*

