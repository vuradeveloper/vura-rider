# Vura Rider - Store Release Runbook

Last updated: 1 November 2026

This is the single checklist for shipping the Vura **rider** app to Google Play and
the Apple App Store. Everything that can be prepared on Windows is already done.
The remaining steps are console actions, confirming no rider has an open Pay Later
balance, and the iOS archive (which needs a Mac).

**v1.5 ships without Ride Now, Pay Later.** The credit feature is hidden by the
build switch `VITE_PAY_LATER_ENABLED=false`; it is not in the signed artifacts in
§2. See §9 for the future-release compliance work.

---

## 1. Build identity

| Item | Value |
|---|---|
| Android application ID | `app.vura.rider` |
| iOS bundle ID | `app.vura.rider` |
| Version name | `1.5` |
| Android version code | `6` |
| iOS build number | `6` |
| Min Android SDK | 24 (Android 7.0) |
| Target / compile SDK | 36 (Android 16) |
| Min iOS | 15.0 |
| Device family (iOS) | iPhone only (`TARGETED_DEVICE_FAMILY = 1`) |
| Backend | `https://api.ridevura.com` |
| Firebase project | `vura-f667d` |
| Launcher name | `Vura` |
| Suggested store name | `Vura - Ride Hailing` |

This is a **new production listing**. The old Expo rider app used
`com.nhlanhlanb.vurarider`; it is a separate package and a separate Play/App Store
entry. There is no upgrade path between the two, so existing riders have to install
the new app. Do not try to reuse the old listing's package name.

The Android version code must increase for every Play upload. The iOS build number
must increase for every App Store Connect upload. Both currently start at `6`.

**Firebase caveat:** `app.vura.rider` is not registered in the Firebase console yet.
The current `android/app/google-services.json` contains a temporary client cloned
from the old `app.vura.rider.figma` client (it reuses the same
`mobilesdk_app_id`). It builds and runs, but it attributes auth/push to the wrong
Firebase app. Register the real Android app before production and rebuild. The iOS
`GoogleService-Info.plist` does not exist yet.

---

## 2. Ready-made artifacts

| Artifact | Path |
|---|---|
| Signed AAB (Play upload) | `release-artifacts/vura-rider-1.5-release.aab` |
| Signed APK (device testing) | `release-artifacts/vura-rider-1.5-release.apk` |
| Play icon 512x512 | `store-assets/play-icon-512.png` |
| App Store icon 1024x1024 | `store-assets/app-icon-1024.png` |
| Feature graphic 1024x500 | `store-assets/feature-graphic-1024x500.png` |
| In-app wordmark | `store-assets/vura-wordmark.png` |
| Account-deletion web page | `store-assets/delete-account.html` |
| Android launcher / adaptive / splash | `android/app/src/main/res/` |
| iOS icon / launch splash | `ios/App/App/Assets.xcassets/` |

SHA-256:

```
AAB  824DB073F5203DD7F8D6BD6EFBB98B132B8A7D8C05D09C47237586650B035CAC
APK  B436311E35D970D2F60BE86B2231CC7A49C8F7F50272A7F6BEC4030DE0948242
```

Sizes: AAB 9,859,806 bytes; APK 10,184,105 bytes.

These artifacts were rebuilt on 1 November 2026 with
`VITE_PAY_LATER_ENABLED=false`, after the new wordmark, the
settings/account-deletion fix, the Pay Later release switch and the
ride-continuity fix (a `searching`/`no_drivers` ride now reopens the matching
screen after the app is backgrounded instead of being lost, and a duplicate ride
is never booked while restoring). The web bundle contains no Pay Later screen,
payment option, eligibility call or credit copy. The AAB contains:

```
base/assets/public/assets/index-CUA5OgXL.js
base/assets/public/assets/index-DZ7ehpCu.css
base/assets/public/assets/vura-wordmark-Dk_BJShG.png
```

The same `index-CUA5OgXL.js` (SHA-256
`6781E8E0A2AAB7D07E65A07F042DED7CD808748619AEAF9B414513F033486255`) is inside the
APK and the synced iOS `public` folder.

### Signing key - back this up

- Keystore: `android/keystore/vura-rider-release.jks`
- Credentials: `android/keystore.properties`
- Alias: `vura-rider`
- Certificate DN: `CN=Vura Rider, OU=Mobile, O=Vura, L=Johannesburg, ST=Gauteng, C=ZA`
- Certificate SHA-256: `1627fb241f00c910bdfc8e1f2af4b25eb23234a2e995b20356ffe90b0a65b257`
- Certificate SHA-1: `9238c60720f54d76015e433e12ad18e0ce6bdf08`

Copy the `.jks` and `keystore.properties` into a password manager and an offline
backup. Losing them means you cannot upload an update under the same upload key
without a Play key reset. This is a new listing, so this key is the upload key and
Play App Signing will hold the app-signing key.

### Rebuild

```powershell
cd figma-ui
$env:VITE_PAY_LATER_ENABLED='false'
powershell -ExecutionPolicy Bypass -File scripts\build-android-release.ps1
npx cap sync ios
Remove-Item Env:VITE_PAY_LATER_ENABLED
```

The script sets `JAVA_HOME` to JDK 21, `ANDROID_HOME=C:\Android`, runs the web
build with the legacy-compatibility gate, syncs Android and runs Gradle
`bundleRelease assembleRelease`.

The `VITE_PAY_LATER_ENABLED=false` line is required for v1.5. With the variable
unset (or set to anything except `false`), the build includes Ride Now, Pay Later.
After changing the flag, always rebuild and re-sync iOS; the bundle hash changes.

Regenerate icons/splashes/store art after a branding change:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\make-brand-assets.ps1
```

---

## 3. Google Play - remaining steps

1. **Create the app** in Play Console:
   - Name: `Vura - Ride Hailing` (the launcher label is `Vura`)
   - Default language: English (South Africa) or English (United States)
   - App or game: App
   - Free
2. **App content** (Dashboard -> App content):
   - **Privacy policy:** `https://www.ridevura.com/privacy`
   - **App access:** provide the demo rider account (see §5). Reviewers sign in
     with email and password; they must not be asked to sign up, because signup
     uses an emailed verification code.
   - **Ads:** No ads.
   - **Content rating:** complete the questionnaire. Ride-hailing app, no
     violence, no sexual content, no gambling. Location sharing is disclosed.
   - **Target audience:** 18+ (the Terms require riders to be 18 or older).
   - **Data safety:** use the answers in §4.
   - **Data deletion:** in-app deletion is at **Account -> Support & settings ->
     Settings -> Account removal -> Delete account**. Web deletion link:
     `https://vura-account-deletion.pages.dev/` (live, verified 1 November 2026).
     Use that in Play Console; swap it to
     `https://www.ridevura.com/delete-account` once the marketing site serves it.
   - **Financial features:** v1.5 has **no** Pay Later or other credit feature.
     Answer "My app doesn't provide any financial features." Paying for a ride
     with cash or a saved card is not a separate financial product. If you later
     ship a build with Pay Later enabled, complete the declaration and read §9.
   - **Health:** No.
   - **Government:** No.
3. **Store listing:**
   - Short description (<=80 chars):
     `Book a ride in seconds. Track your driver and pay by card or cash.`
   - Full description (<=4000 chars) - suggested copy:
     ```
     Vura is the easy way to get around town.

     Book a ride in a few taps, see your driver on the map, and pay with cash
     or a saved card.

     • Set your pickup and add stops
     • See nearby drivers and live arrival times
     • Follow your trip on the map and share it with someone you trust
     • Pay with cash or a saved card
     • Rate your driver and find past trips in Activity
     • Manage your profile, payment methods and privacy in Settings

     Vura uses your location to set your pickup point, find nearby drivers and
     show your trip on the map. You can turn location permission off at any
     time, but booking a ride needs it.

     By using Vura you agree to the Vura Terms of Service and Privacy Policy.

     Vura is operated by Dorfnew (Pty) Ltd in South Africa.
     ```
   - App icon: `store-assets/play-icon-512.png`
   - Feature graphic: `store-assets/feature-graphic-1024x500.png`
   - Phone screenshots: at least 2 (1080x1920 recommended). Capture these on a
     real phone from the release APK - splash/login, home map, ride options,
     live trip, receipt, Settings. See §7.
4. **Release:**
   - Testing -> Internal testing -> Create release.
   - Upload `vura-rider-1.5-release.aab`.
   - Let Play App Signing handle the app-signing key.
   - Add yourself as an internal tester, install from the Play link, and smoke-test.
   - Promote to Closed/Open testing, then Production.
5. **Permissions:** the manifest declares only `INTERNET`,
   `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` and `POST_NOTIFICATIONS`.
   There is **no** background-location permission and no foreground-service
   declaration. The location permission is used only while the rider is using the
   app to set a pickup and follow a trip.

---

## 4. Data safety / App Store privacy answers

The app collects the following. All data is linked to the user's account, is used
for app functionality, and is **not** used for tracking or advertising. Data is
encrypted in transit (HTTPS). Users can delete their account in-app.

| Data type | Collected | Shared | Purpose |
|---|---|---|---|
| Name | Yes | No | Account, trip identity |
| Email address | Yes | No | Login, receipts, support |
| Phone number | Yes | No | Account, trip contact |
| Address (pickup/drop-off, stops) | Yes | No | Trip fulfilment |
| Precise location | Yes | No | Pickup, nearby drivers, live trip |
| Approximate location | Yes | No | Derived from GPS for matching |
| Photos | Yes | No | Profile photo, ID document |
| Payment info (card token/last4) | Yes | No | Card payments |
| User ID | Yes | No | Account identity |
| Device or other IDs (push token) | Yes | No | Ride notifications |
| Messages (in-ride chat) | Yes | No | Rider <-> driver coordination |
| Ride history / app activity | Yes | No | Receipts, support |

Third-party processors: Firebase (auth, push), Paystack (card payments), Resend
(transactional email), AWS (hosting/storage), and OpenStreetMap tile servers (map
tiles). They act as service providers, not advertising partners. There are **no
analytics or advertising SDKs** in the app.

App Store privacy nutrition labels map to the same list. The app does **not** track
users across apps/websites, so "Data Used to Track You" is empty.

`ios/App/App/PrivacyInfo.xcprivacy` declares the same categories, including
`Other User Content` for in-ride chat, `Sensitive Info` for uploaded ID documents,
and `Purchase History` for trip receipts. It does **not** declare
`Other Financial Info` because v1.5 has no credit feature.

"Payment info" is collected for saved cards. v1.5 does not collect a credit limit,
outstanding balance or repayment history, so do **not** declare "Other financial
info". If a later build enables Pay Later, add that row and the manifest entry.

---

## 5. Demo account for reviewers

Create one rider account and keep it working for the review period:

```
Email:    ______________________________
Password: ______________________________
Phone:    ______________________________
```

Requirements:

- The account must be able to sign in with email + password. Do not make the
  reviewer sign up; signup uses an emailed six-digit code.
- Give it a completed trip if possible, so Activity and the receipt screens are
  not empty.
- Reviewers will only see cash and saved-card payments. v1.5 has no Pay Later or
  credit screen.
- If you use a test ride, keep a driver account available to accept it.

Enter these credentials in:

- Play Console -> App content -> App access -> "All or some functionality is
  restricted" -> add username/password and instructions.
- App Store Connect -> App Review Information -> Sign-in required.

---

## 6. Account deletion web link

Google Play asks for a public web URL where users can request deletion. A
ready-to-publish page is included at:

```
store-assets/delete-account.html
```

It is a self-contained static page (the new wordmark is embedded, no external CSS
or JavaScript) and covers **both** Vura Rider and Vura Driver. It explains the
in-app path, lists what is deleted and what may be retained, and gives the
`info@ridevura.com` request route with a 30-day service level.

It is live at:

```
https://vura-account-deletion.pages.dev/
```

That URL returned 200 on 1 November 2026 and is the link to use in Play Console.
It is a standalone Cloudflare Pages project (`vura-account-deletion`), deployed
from this file with:

```powershell
# from a folder containing dist/index.html (a copy of delete-account.html)
npx wrangler pages deploy dist --project-name=vura-account-deletion --branch=main --commit-dirty=true
```

The preferred branded URL is:

```
https://www.ridevura.com/delete-account
```

The marketing site is a separate Vercel project and its source is not in this
repository. When the page is added there, swap the Play Console link to the
branded URL. Keep this sentence in the review notes either way:

> Riders can delete their account inside the app at Account -> Support & settings
> -> Settings -> Account removal -> Delete account. Users who cannot access the app can request deletion
> through this page or by emailing info@ridevura.com; requests are actioned within 30 days.

This is a website change, not an app change.

The in-app flow calls the existing server endpoint `POST /api/users/delete`. It
clears the local session and returns to the login screen after success. Verify it
end-to-end with a throwaway account after the server deploy (see §11).

---

## 7. Screenshots

Capture on a real Android phone from `release-artifacts/vura-rider-1.5-release.apk`
(or the Play internal-testing install):

1. Splash / login with the red Vura wordmark
2. Home map with pickup and destination
3. Ride options / tier selection
4. Driver matching or live trip
5. Trip receipt / rating
6. Account -> Support & settings -> Settings (shows Legal & privacy and Account removal)

Do not include a Pay Later or credit screen in the v1.5 listing.

Play: 1080x1920 PNG/JPEG, at least 2.
App Store: 6.9" (1320x2868) or 6.7" (1290x2796) iPhone screenshots, at least 3.
The app is iPhone-only, so no iPad screenshots are required.

---

## 8. Apple App Store - remaining steps (requires macOS)

The iOS project is prepared at `ios/App/App.xcodeproj` with:

- Bundle ID `app.vura.rider`, version `1.5` (build `6`)
- iPhone-only target (`TARGETED_DEVICE_FAMILY = 1`), minimum iOS 15
- `NSLocationWhenInUseUsageDescription` and `NSPhotoLibraryUsageDescription`
- `UIBackgroundModes`: `remote-notification` only (no background location)
- `ITSAppUsesNonExemptEncryption = false` (HTTPS only)
- `PrivacyInfo.xcprivacy` with collected-data and UserDefaults declarations
- Push Notifications capability + `App.entitlements`
  (`aps-environment = production`)
- Branded 1024 icon and 2732 splash
- `public/` web assets synced from the v1.5 flag-off `dist` (no Pay Later screen)

On a Mac:

1. Install Xcode 16 or newer and command-line tools.
2. `cd figma-ui && npm ci`. The iOS `public/` folder is already synced to the
   v1.5 flag-off bundle. If you rebuild, keep the flag off:
   `VITE_PAY_LATER_ENABLED=false npm run build && npx cap sync ios`
   (PowerShell: set `$env:VITE_PAY_LATER_ENABLED='false'`, build, sync, then
   remove the variable).
3. Open `ios/App/App.xcodeproj` (Capacitor 8 uses Swift Package Manager; there is
   no `.xcworkspace`).
4. Select the **App** target -> Signing & Capabilities:
   - Team: your Apple Developer team
   - Bundle Identifier: `app.vura.rider`
   - Confirm "Push Notifications" is on.
5. **Push notifications:** download `GoogleService-Info.plist` from Firebase
   Console -> project `vura-f667d` -> add an iOS app with bundle ID
   `app.vura.rider`, then:
   - Put the plist in `ios/App/App/` and add it to the App target (Copy Bundle
     Resources).
   - Upload your APNs auth key (`.p8`) to Firebase -> Cloud Messaging.
   Without this, iOS push registration will not deliver ride updates; foreground
   use still works through the socket.
6. Product -> Archive -> Distribute App -> App Store Connect -> Upload.
7. In App Store Connect:
   - Create the app with bundle ID `app.vura.rider`, name
     `Vura - Ride Hailing`.
   - Privacy policy: `https://www.ridevura.com/privacy`
   - Support URL: `https://www.ridevura.com/contact`
   - App Privacy: use §4.
   - Age rating: 18+ (the Terms require riders to be 18 or older).
   - Export compliance: already declared exempt in Info.plist.
   - App Review Information: demo account from §5.
   - Review notes: see below.
   - Screenshots: §7.
8. Submit for review.

### Review notes (copy into App Store Connect)

> Vura is a ride-hailing app for riders in South Africa. Riders use location to
> set their pickup point, see nearby drivers and follow the active trip. Location
> is only used while the rider is using the app; the app does not request
> background location. Riders can delete their account in the app at Account ->
> Support & settings -> Settings -> Account removal -> Delete account, and the
> same instructions are at
> https://vura-account-deletion.pages.dev/.
>
> v1.5 does not offer Pay Later, credit, loans or any other financial product.
> Riders pay with cash or a saved card.

---

## 9. Pay Later - not in v1.5 (future release)

Ride Now, Pay Later is a real credit feature, not a cosmetic label. It lets an
eligible rider take a ride now and settle the fare at the end of the month. It is
**hidden** in the v1.5 signed artifacts in §2 by `VITE_PAY_LATER_ENABLED=false`.
The bundle contains no Pay Later screen, payment option, eligibility call or credit
copy.

This section is the checklist for a **future release** that turns it back on. Do
not enable it until the disclosures and the South African credit/NCR position are
signed off.

### How it works when enabled (defaults from the server code)

- Unlock: 5 completed, paid card rides on the same saved card.
- Starting limit: R100, increasing by R50 for every 10 completed rides, capped at
  R1,000.
- Due date: the last day of the month at 23:59:59 UTC.
- Repayment: saved card ("Pay what I owe"), optional auto-debit with explicit
  consent, or ride-to-repay (R25 off the balance every 4 completed rides).
- Interest and fees: none configured (0% APR, no service fee).
- Failed collection: retries on day 1/3/7 after the due date, then the account is
  frozen and the identity fingerprint is blacklisted.
- Terms acceptance is recorded server-side and required before the first
  pay-later booking.

### Google Play

Every app with financial features must complete **App content -> Financial
features declaration**. If a future build enables Pay Later:

- Declare **Buy now, pay later** under "Purchase agreements".
- Because the feature extends a revolving limit, also review **Line of credit**
  under "Banking and loans". If the form lets you select both, select both; if it
  forces one, choose Buy now, pay later and explain the limit in the declaration.
- Do **not** select "My app doesn't provide any financial features" while Pay
  Later is enabled. That is a misrepresentation and can trigger enforcement.
- Personal-loan declarations can require lender documentation and licences. Pay
  Later is a fare deferral, not a cash loan, but a reviewer may treat a revolving
  limit as a line of credit. Keep the terms, the credit-limit rules and the
  repayment schedule ready to upload.
- Confirm with South African counsel whether this is an incidental credit
  agreement or a credit facility requiring National Credit Regulator (NCR)
  registration. Do this before enabling it for real riders.

### Apple App Store

Apple's rule for personal loans is **Guideline 3.2.2(ix)**:

> Apps offering personal loans must clearly and conspicuously disclose all loan
> terms, including but not limited to equivalent maximum Annual Percentage Rate
> (APR) and payment due date. Loan apps may not charge a maximum APR higher than
> 36%, including costs and fees, and may not require repayment in full in 60 days
> or less.

This is the main risk. Vura charges 0% interest and no fees, which satisfies the
APR cap, but the month-end due date can be **less than 60 days** after a ride
(for example, a ride on the 28th is due on the 30th). If Apple treats Pay Later as
a personal loan, the 60-day minimum is not met and the build can be rejected.

If you later enable Pay Later, pick one of these before submitting that build:

**Option A - keep v1.5 without Pay Later (current build).** Already done: the
artifacts in §2 were built with the switch off, which removes the Pay Later row,
the payment option, the screen, the eligibility call and all credit copy. The Play
Financial features declaration is "My app doesn't provide any financial features".
The iOS manifest does not declare `Other Financial Info`. **Caveat:** the screen is
also where an existing rider repays an outstanding balance, so only ship this build
if no rider has an open Pay Later balance, or clear those balances first.

**Option B - keep Pay Later and make the terms compliant.**
- Show "0% interest, no fees" and the exact due date on the Pay Later screen and
  in the terms.
- Change the due date to at least 60 days after each ride (server change in
  `PayLaterService.ts`, tests, deploy). Do not rely on month-end.
- Keep the credit limit, repayment schedule and consequences of non-payment
  visible before the rider accepts.
- Have counsel confirm the NCR position.

**Option C - keep it as-is and argue it is BNPL for services, not a personal
loan.** Lower effort, higher rejection risk. Only use this if you are prepared to
appeal or resubmit.

### Review notes if a future build enables Pay Later

> Ride Now, Pay Later lets eligible riders defer the fare for a ride until the
> last day of the month. It is not a cash loan: no money is disbursed, no interest
> or fees are charged (0% APR), the limit is R100-R1,000, and repayment is by the
> rider's saved card or optional auto-debit. Riders can repay early at any time in
> Account -> Ride Now, Pay Later. The terms are accepted in the app before the
> first pay-later booking.

Do not call it a "loan" or "credit" in the store listing unless you have declared
it and can support the disclosure. "Pay for your ride at month-end" is accurate.

---

## 10. What is already fixed for store compliance

- Fake Google/Facebook/Apple login and signup buttons removed; real email/password
  auth only.
- Real password reset wired to `POST /api/users/forgot-password` (verified live).
- Signup requires an explicit, unticked Terms/Privacy consent checkbox.
- Terms and Privacy are real links to `https://www.ridevura.com/terms` and
  `/privacy` (both verified 200).
- Splash screen Terms/Privacy links open externally.
- **Settings is now reachable** from Account -> Support & settings -> Settings.
  Before this fix the Settings hub (legal links and account deletion) existed but
  no row opened it. The profile card also opens the profile screen now.
- In-app account deletion at Settings -> Account removal -> Delete account, with a
  two-step confirmation and a clear list of what is deleted. Calls
  `POST /api/users/delete`, clears the session and returns to login.
- New red Vura wordmark replaces the old red-square white "V" on every launcher
  icon, adaptive icon, Android/iOS splash, Play icon and feature graphic. The
  in-app login/header wordmark is the same asset.
- `android:allowBackup="false"` so account data is not copied into Android cloud
  backups.
- Minimal Android permissions: internet, fine/coarse location, notifications. No
  background location, no contacts, no SMS, no storage-wide permissions.
- iOS privacy manifest (`PrivacyInfo.xcprivacy`), push entitlement, iPhone-only
  target, `ITSAppUsesNonExemptEncryption = false`.
- Pay Later is hidden in v1.5 with `VITE_PAY_LATER_ENABLED=false`. The signed
  bundle has no Pay Later screen, payment option, eligibility call or credit copy,
  so the app has no financial product to declare.

---

## 11. Known gaps / still pending

- **Firebase registration:** `app.vura.rider` is not in the Firebase console. The
  current Android client is a clone and should be replaced, then the AAB rebuilt.
  The iOS `GoogleService-Info.plist` and APNs key are also missing.
- **Branded deletion page:** the page is live at
  `https://vura-account-deletion.pages.dev/` and is ready for Play Console.
  Moving it to `https://www.ridevura.com/delete-account` is still a
  marketing-site change.
- **Demo account and screenshots:** still to be created/captured on a real device.
- **iOS archive:** requires macOS/Xcode; the project is prepared but has not been
  archived or uploaded.
- **Apple bundle ID:** register `app.vura.rider` in the Apple Developer portal and
  create the App Store Connect record before archiving.
- **Xcode privacy report:** run Product -> Archive -> Generate Privacy Report and
  add any required-reason API declarations used by Capacitor or its plugins. The
  app manifest currently declares UserDefaults only.
- **On-device smoke test:** install the signed APK and test login, booking, live
  trip, Settings, legal links and account deletion.
- **Open Pay Later balances:** v1.5 hides the screen where a rider repays an
  outstanding balance. Before shipping, confirm no production rider has an open
  balance, or collect/clear those balances first.
- **Future Pay Later release:** see §9. v1.5 is not blocked by this, but do not
  re-enable Pay Later for real riders until the NCR position and the Apple
  60-day issue are resolved.
- **Server deploy:** the FK-safe account-deletion work is on
  `admin-v2-reconciled` and is not deployed to production yet. Verify
  `POST /api/users/delete` with a throwaway account after deploy.
- **Signup verification code:** the six-digit code is generated on-device and
  compared in the app; it is not server-verified. This does not block store
  review, but it should be moved server-side before scaling.
- **Map tiles:** the app uses the standard OpenStreetMap tile servers. Their usage
  policy is intended for light use; move to a commercial tile provider before
  significant traffic.
- **WebView mixed content:** `capacitor.config.ts` sets
  `allowMixedContent: true`. The app loads HTTPS only, so this can be turned off
  after a final check; doing so requires a rebuild.
- **Old Expo app:** `com.nhlanhlanb.vurarider` remains a separate listing. Decide
  whether to unpublish it or leave it up with a migration message.

---

## 12. Release checklist

```
[ ] Register app.vura.rider in Firebase (Android + iOS)
[ ] Replace android/app/google-services.json with the real client
[ ] Add ios/App/App/GoogleService-Info.plist and APNs key
[x] Publish the deletion page (https://vura-account-deletion.pages.dev/)
[ ] Move the deletion page to https://www.ridevura.com/delete-account
[x] Decide Pay Later: hidden for v1.5
[x] Build with VITE_PAY_LATER_ENABLED=false and re-run cap sync
[ ] Confirm no rider has an open Pay Later balance before release
[ ] Keep Pay Later out of the store listing and screenshots
[ ] Create demo rider account; keep credentials for reviewers
[ ] Capture phone screenshots (Play >=2, App Store >=3)
[ ] Deploy admin-v2-reconciled and test account deletion end-to-end
[ ] Upload AAB to Play internal testing; smoke-test the installed build
[ ] Archive and upload the iOS build on macOS
[ ] Complete Play Data safety, Financial features ("none") and content rating
[ ] Complete App Store privacy, age rating and review notes
[ ] Submit both apps
```
