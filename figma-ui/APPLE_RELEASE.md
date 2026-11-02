# Vura - Apple App Store release runbook

Last updated: 2 November 2026

Apps covered:

| App | Bundle ID | Version | Build | Display name |
|---|---|---|---|---|
| Vura (rider) | `app.vura.rider` | 1.5 | 6 | Vura |
| Vura Driver | `app.vura.driver` | 1.7 | 8 | Vura Driver |

Both targets are iPhone-only (`TARGETED_DEVICE_FAMILY = 1`) and have a minimum
deployment target of iOS 15.0.

Apple requirements as of November 2026:

- Uploads must be built with **Xcode 26 or newer** using the **iOS 26 SDK**
  (effective 28 April 2026).
- The required iPhone screenshot is at least one image for **iPhone with
  Dynamic Island (medium display)**: 1179 x 2556 or 1206 x 2622.
- The updated age-rating questionnaire is mandatory (effective 31 January 2026).

Official references:

- Apple Developer account: https://developer.apple.com/account/
- Certificates, Identifiers & Profiles: https://developer.apple.com/account/resources/
- App Store Connect: https://appstoreconnect.apple.com/
- App Store Connect Help: https://developer.apple.com/help/app-store-connect/
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Upcoming requirements: https://developer.apple.com/news/upcoming-requirements/
- Screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
- Age ratings: https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/
- Upload builds: https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/
- Submit an app: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/
- TestFlight: https://developer.apple.com/testflight/
- Xcode: https://apps.apple.com/us/app/xcode/id497799835
- Transporter: https://apps.apple.com/us/app/transporter/id1450874784
- Privacy manifest files: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- APNs setup: https://developer.apple.com/documentation/usernotifications/registering_your_app_with_apns

---

## 0. What you need before starting

- An active Apple Developer Program membership (approved).
- Account Holder or Admin access to App Store Connect.
- A Mac with Xcode 26 or newer for the archive and upload. Windows cannot build
  or upload an iOS app.
- An iPhone for TestFlight and screenshots.
- A demo rider account and an **approved** demo driver account (with a vehicle).
  Apple cannot test the driver app without an approved driver.
- An APNs authentication key (`.p8`) for push notifications.

---

## 1. Account checks (10 minutes)

### 1.1 Find your Team ID and seller name

1. Open https://developer.apple.com/account/
2. Sign in with the Apple ID that was approved.
3. Click **Membership details** in the left sidebar.
4. Write down:
   - **Team ID** - 10 characters, used in Xcode and APNs.
   - **Team Name**.
   - **Entity type** - Individual or Organization.
   - **Seller Name** - this is the name shown on the App Store.
5. If a banner says a Program License Agreement needs review, accept it.

Important: if the account is an **Individual** account, the App Store seller name
is your legal name, not "Vura". If that matters, you need an Organization account
(with a D-U-N-S number) before creating the app records. Tell me before you
create them if you want to change this.

### 1.2 Accept the App Store Connect agreements

1. Open https://appstoreconnect.apple.com/agreements
2. Sign in.
3. If the **Free Apps** agreement is not accepted, click **Review Agreement**
   and accept it. You cannot create an app record until the Account Holder has
   signed the latest agreement.
4. The Paid Apps agreement, banking, and tax sections are only needed if you
   sell apps or in-app purchases. Vura is free; skip them unless prompted.

Official help: https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements/

### 1.3 Check your role

1. Open https://appstoreconnect.apple.com/access/users
2. Confirm your Apple ID has **Account Holder**, **Admin**, or **App Manager**.
3. If someone else will upload the build, invite them with **App Manager** and
   give them access to both apps.

---

## 2. Register the two App IDs

Do this once per app. The bundle ID cannot be changed after the first upload.

1. Open https://developer.apple.com/account/resources/identifiers/list
2. Confirm the correct team is selected in the top-right corner.
3. Click the **+** button next to **Identifiers**.
4. Select **App IDs** -> **Continue**.
5. Select **App** -> **Continue**.
6. Fill in the rider App ID:
   - Description: `Vura Rider`
   - Bundle ID: **Explicit**
   - Bundle ID: `app.vura.rider`
7. Under **Capabilities**, tick **Push Notifications**. Leave everything else
   off (no Sign in with Apple, Associated Domains, App Groups, iCloud, Wallet).
8. Click **Continue**, then **Register**.
9. Repeat for the driver:
   - Description: `Vura Driver`
   - Bundle ID: **Explicit**
   - Bundle ID: `app.vura.driver`
   - Tick **Push Notifications**.
   - **Continue** -> **Register**.
10. The bundle IDs may take 5-10 minutes to appear in App Store Connect. If the
    dropdown is empty when you create the app record, wait and refresh.

Official help: https://developer.apple.com/help/account/manage-identifiers/register-a-new-app-identifier/

---

## 3. Create the APNs authentication key

One key works for both apps. This is the key the server uses to send iOS push
notifications.

1. Open https://developer.apple.com/account/resources/authkeys/list
2. Click the **+** button.
3. Key Name: `Vura APNs`
4. Tick **Apple Push Notifications service (APNs)**.
5. Click **Continue**, then **Register**.
6. Click **Download**. Apple lets you download the `.p8` file **once**. Store it
   in a password manager or secure vault. Do not commit it to git.
7. Write down:
   - **Key ID** - 10 characters.
   - **Team ID** - from Membership details.

If the server will talk to APNs directly (recommended for this codebase), the
server needs the `.p8`, Key ID, Team ID, and each app's bundle ID. If you later
choose Firebase Cloud Messaging for iOS, upload the same `.p8` in Firebase ->
Project Settings -> Cloud Messaging -> Apple app configuration.

Note: Push Notifications must already be enabled on both App IDs before the key
can deliver to them.

---

## 4. Create the two app records

1. Open https://appstoreconnect.apple.com/apps
2. Click the **+** button in the top-left, then **New App**.
3. Rider:
   - Platforms: **iOS**
   - Name: `Vura`
   - If `Vura` is already taken, use `Vura Ride`. The home-screen name stays
     "Vura"; only the App Store listing name changes.
   - Primary Language: **English (U.K.)**, or **English (South Africa)** if the
     list offers it.
   - Bundle ID: `app.vura.rider`
   - SKU: `vura-rider-1`
   - User Access: **Full Access**
   - Click **Create**.
4. Driver:
   - Platforms: **iOS**
   - Name: `Vura Driver`
   - Primary Language: same as above.
   - Bundle ID: `app.vura.driver`
   - SKU: `vura-driver-1`
   - User Access: **Full Access**
   - Click **Create**.

Official help: https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/

---

## 5. App information (both apps)

For each app: App Store Connect -> **Apps** -> select the app -> **App
Information**.

| Field | Rider | Driver |
|---|---|---|
| Name | `Vura` (fallback `Vura Ride`) | `Vura Driver` |
| Subtitle | `Rides around South Africa` | `Drive and earn with Vura` |
| Privacy Policy URL | `https://www.ridevura.com/privacy` | same |
| Category (primary) | Travel | Business |
| Category (secondary) | none | Navigation |
| Content Rights | No third-party content you do not have rights to use | same |
| Age Rating | See below | See below |
| License Agreement | Apple's standard EULA | same |

Support URL and Marketing URL are entered on the version page (section 11):

- Support URL: `https://www.ridevura.com/contact`
- Marketing URL: `https://www.ridevura.com`

### 5.1 Age rating

Click **Edit** next to Age Rating and answer the questionnaire honestly.

For both apps:

- Cartoon/fantasy violence: None
- Realistic violence: None
- Prolonged graphic/sadistic violence: None
- Guns or other weapons: None
- Profanity or crude humour: None
- Mature or suggestive themes: None
- Sexual content or nudity: None
- Graphic sexual content: None
- Alcohol, tobacco, or drugs: None
- Medical or treatment information: None
- Horror or fear themes: None
- Simulated gambling: None
- Contests: None
- Unrestricted web access: No (the app opens specific legal/support pages, not a
  general browser)
- User-generated content: No (profile photos and documents are private, not
  publicly distributed)
- Messaging and chat: No (there is no in-app chat)
- Advertising: No
- Social media: No
- Loot boxes: None
- Gambling: No
- Age assurance: No

Expected result: **4+**.

The Terms require riders to be 18 or older. That is an eligibility rule, not an
Apple content rating. Do not select 18+ unless the content actually warrants it;
Apple's rating is based on the questionnaire.

Official help: https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/

---

## 6. App Privacy

For each app: App Store Connect -> select the app -> **App Privacy** -> **Get
Started**.

Answer the top-level questions:

- Does your app collect data? **Yes**
- Is any data used to track the user? **No**
- Is all data encrypted in transit? **Yes** (HTTPS)
- Privacy Policy URL: `https://www.ridevura.com/privacy`
- Do you offer account deletion? **Yes**. In-app path for the rider:
  **Account -> Support & settings -> Settings -> Account removal -> Delete
  account**. Driver: **Account -> Delete account**.

Then add the data types. These match the shipped `PrivacyInfo.xcprivacy` files.

### 6.1 Rider

| Apple data type | Detail | Linked to user | Used for tracking | Purpose |
|---|---|---|---|---|
| Contact Info | Name, Email Address, Phone Number | Yes | No | App Functionality |
| Location | Precise Location, Coarse Location | Yes | No | App Functionality |
| Financial Info | Payment Info | Yes | No | App Functionality |
| User Content | Photos or Videos, Other User Content | Yes | No | App Functionality |
| Identifiers | User ID, Device ID | Yes | No | App Functionality |
| Sensitive Info | As declared in the privacy manifest | Yes | No | App Functionality |
| Purchases | Purchase History | Yes | No | App Functionality |

### 6.2 Driver

| Apple data type | Detail | Linked to user | Used for tracking | Purpose |
|---|---|---|---|---|
| Contact Info | Name, Email Address, Phone Number | Yes | No | App Functionality |
| Location | Precise Location, Coarse Location (including while online in the background) | Yes | No | App Functionality |
| Financial Info | Payment Info, Other Financial Info | Yes | No | App Functionality |
| User Content | Photos or Videos, Other User Content | Yes | No | App Functionality |
| Identifiers | User ID, Device ID | Yes | No | App Functionality |
| Sensitive Info | As declared in the privacy manifest | Yes | No | App Functionality |
| Purchases | Purchase History | Yes | No | App Functionality |

Do not add data types the app does not collect. If you change
`PrivacyInfo.xcprivacy`, update App Store Connect to match. The privacy manifest
is the technical source of truth; App Store Connect is the public declaration.

Official help: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/

---

## 7. Pricing and availability

For each app: App Store Connect -> select the app -> **Pricing and
Availability**.

- Price: **Free**
- Availability: **South Africa**. Add other countries only if you actually
  operate there.
- Distribution: **Public on the App Store**
- Pre-order: **No**
- App Store discovery: include in search results.
- In-App Purchases: none.
- Subscriptions: none.

---

## 8. Screenshots

The required size in November 2026 is at least one screenshot for **iPhone with
Dynamic Island (medium display)**:

- 1179 x 2556 (iPhone 15 Pro), or
- 1206 x 2622 (iPhone 16 Pro / 16 Pro Max class).

Optional larger set:

- 1320 x 2868 (iPhone 16 Pro Max)
- 1290 x 2796 (iPhone 15 Pro Max)

Rules:

- 3 to 10 screenshots per size are recommended; Apple requires at least one.
- PNG or JPEG, RGB, no alpha channel or transparency.
- No iPad screenshots are required because both targets are iPhone-only.
- Do not show real personal data; use the demo accounts.
- Do not show Pay Later, credit, loans, or any financial product. It is hidden in
  v1.5.

Suggested rider shots:

1. Home map with pickup and destination.
2. Ride options and fare.
3. Searching for a driver.
4. Driver en route / live trip.
5. Receipt or trip history.

Suggested driver shots:

1. Online map with the driver's position.
2. Incoming trip offer.
3. Turn-by-turn navigation with the turn banner.
4. Earnings summary.
5. Documents / vehicle status.

Where: App Store Connect -> app -> **App Store** tab -> version -> **App
Previews and Screenshots**.

Official specifications: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/

---

## 9. Build and upload on a Mac

You need macOS with **Xcode 26 or newer**. Xcode 15/16 will be rejected by App
Store Connect under the current SDK rule.

### 9.1 Rider

```bash
cd /path/to/vura-rider/figma-ui
npm ci
VITE_PAY_LATER_ENABLED=false npm run build
npx cap sync ios
npx cap open ios
```

### 9.2 Driver

```bash
cd /path/to/vura-driver/figma-ui
npm ci
npm run build
npx cap sync ios
npx cap open ios
```

### 9.3 In Xcode

1. Select the **App** project in the navigator, then the **App** target.
2. Open **Signing & Capabilities**.
   - Team: your Apple Developer team.
   - Tick **Automatically manage signing**.
   - Bundle Identifier: `app.vura.rider` or `app.vura.driver`.
   - Confirm **Push Notifications** is present.
   - Driver only: **Background Modes** -> tick **Location updates** and
     **Remote notifications** *only if* the native background-location plugin is
     in the build. The current WebView geolocation does not run while
     backgrounded; read section 14.2 before archiving.
3. Set **Version** and **Build**:
   - Rider: Version `1.5`, Build `6`.
   - Driver: Version `1.7`, Build `8`.
   - Increment the build number for every upload. Never reuse a build number.
4. Select **Any iOS Device (arm64)** as the destination. Archive is greyed out
   if a simulator is selected.
5. **Product -> Archive**.
6. When Organizer opens: **Distribute App -> App Store Connect -> Upload**.
7. Keep **Automatically manage signing** selected, then **Upload**.
8. Wait for "Upload succeeded".

If Xcode reports missing packages: **File -> Packages -> Resolve Package
Versions**. Capacitor 8 uses Swift Package Manager; there is no `.xcworkspace`.

Official upload help: https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/

### 9.4 If you do not have a Mac

Windows cannot archive or upload an iOS build. Options:

- Borrow or rent a Mac with Xcode 26.
- Use a cloud Mac/CI service that supports Capacitor (for example Codemagic or
  Ionic Appflow) and an App Store Connect API key.
- Use Xcode Cloud from App Store Connect, with a CI workflow that runs
  `npm ci`, `npm run build`, `npx cap sync ios`, then archives.

Tell me which route you want and I will prepare the CI configuration.

---

## 10. TestFlight

1. App Store Connect -> select the app -> **TestFlight**.
2. **Internal Testing** -> **+** -> group name `Vura Team`.
3. Add testers by Apple ID email.
4. **Builds** -> **+** -> select the uploaded build.
5. Fill in **Test Information**: beta description, contact email, demo account.
6. Internal testers do not need Beta App Review. External testing does; submit
   the first build for Beta App Review and provide the demo account.
7. Install **TestFlight** from the App Store, accept the invite, install the
   build.

Test on the device:

- Login and session restore.
- Location permission.
- Book a ride (rider) / go online and receive an offer (driver).
- Push notification with the app backgrounded.
- Rider: background during search, reopen, confirm the matching screen returns.
- Cancel a ride; confirm it does not come back.
- Open Settings, Terms, Privacy, and delete a throwaway account.
- Confirm Pay Later does not appear anywhere.

Official TestFlight help: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/

---

## 11. Submit for review

1. App Store Connect -> select the app -> **App Store** tab.
2. Open the version (for example `1.5`).
3. Fill in:
   - **Promotional Text**
   - **Description**
   - **Keywords**
   - **Support URL**: `https://www.ridevura.com/contact`
   - **Marketing URL**: `https://www.ridevura.com`
   - **Screenshots**
   - **Build**: select the processed build.
4. **App Review Information**:
   - Tick **Sign-in required**.
   - Enter the demo username and password.
   - Enter a reachable contact name, phone, and email.
   - Paste the review notes from section 12.
5. **Version Release**: choose **Manually release this version** so you can
   check the listing before it goes live.
6. Click **Add for Review**, then **Submit**.
7. If asked about export compliance: the app uses only standard HTTPS and
   `ITSAppUsesNonExemptEncryption` is already `false`, so answer that it does not
   use non-exempt encryption.
8. If asked about advertising identifiers: **No**.
9. Watch the status: **Waiting for Review -> In Review -> Pending Developer
   Release** (or **Rejected**).
10. If rejected, open **Resolution Center**, read the exact guideline, fix it,
    reply, and resubmit. Do not resubmit without changes.

Official submit help: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/

---

## 12. Review notes (copy into App Store Connect)

### Rider

> Vura is a real-world ride-hailing app for riders in South Africa. Riders set a
> pickup and destination, see the fare, request a nearby driver, and follow the
> trip live. Payment is cash or a saved card for a real-world transport service;
> there are no digital goods and no in-app purchases.
>
> Demo rider account: `review.rider@ridevura.com` / `<password>`.
>
> To test: sign in, allow location while using the app, set a pickup and
> destination, request a ride, and open the trip screen. Location is used only
> while the rider is using the app; the rider app does not request background
> location.
>
> Account deletion is in the app at Account -> Support & settings -> Settings ->
> Account removal -> Delete account. The same instructions are at
> https://vura-account-deletion.pages.dev/.
>
> v1.5 does not offer Pay Later, credit, loans, or any other financial product.
> Riders pay with cash or a saved card.

### Driver

> Vura Driver is the driver-side app for the Vura ride-hailing platform. It is
> for approved drivers only. Drivers go online, receive nearby trip requests,
> navigate to the pickup and drop-off, and track their earnings.
>
> Demo driver account (already approved, with a vehicle):
> `review.driver@ridevura.com` / `<password>`.
> Demo rider account to create a trip:
> `review.rider@ridevura.com` / `<password>`.
>
> To test: sign in as the driver, go online, then book a ride with the rider
> account. The offer appears on the driver app. Accept it and follow the
> navigation.
>
> Background location: while a driver is online, the app keeps location active so
> the driver can receive nearby trips and riders can follow the arrival when the
> driver switches to another app (for example, navigation). Location is collected
> only while the driver is online or on an active trip, is not used for
> advertising, and is not shared with third parties. Going offline stops it.
>
> Account deletion is in the app at Account -> Delete account. The same
> instructions are at https://vura-account-deletion.pages.dev/.
>
> There are no digital goods and no in-app purchases. Pay Later is not part of
> this release.

Replace `<password>` with the real demo passwords. Do not put them in git,
screenshots, or the public listing.

---

## 13. Metadata to copy

### Rider

- Name: `Vura`
- Subtitle: `Rides around South Africa`
- Promotional text: `Book a ride, track your driver live, and pay your way. Vura makes getting around South Africa simple.`
- Keywords: `ride hailing,taxi,ride,transport,driver,pickup,dropoff,South Africa,Vura`
- Description:

> Vura is a ride-hailing app built for South Africa. Book a ride in seconds, see
> nearby drivers, track your driver live, and pay with cash or a saved card.
>
> - Set your pickup and destination on the map
> - See the fare before you book
> - Follow your driver in real time
> - Share trip details with someone you trust
> - Pay with cash or a saved card
> - View receipts and past trips
> - Manage your account and delete it in the app
>
> Vura connects you with independent drivers. Availability depends on your area.

### Driver

- Name: `Vura Driver`
- Subtitle: `Drive and earn with Vura`
- Promotional text: `Go online, accept trips, and earn on your schedule. Vura Driver keeps you moving.`
- Keywords: `driver,drive,earn,taxi,ride hailing,partner,transport,navigation,Vura`
- Description:

> Vura Driver is the app for drivers on the Vura platform. Go online, receive
> trip requests, navigate turn-by-turn, and track your earnings.
>
> - Go online and receive nearby trip requests
> - Turn-by-turn navigation with live traffic
> - See pickup and drop-off details before you accept
> - Track earnings, trips, and receipts
> - Manage your vehicle and documents
> - Get support from the Vura team
>
> Vura Driver is for approved drivers only. New drivers can apply in the app.

---

## 14. Before you archive: code blockers

These are not App Store Connect settings. They must be fixed before the iOS build
is uploaded, or the app will be incomplete in review or production.

### 14.1 iOS push transport (must fix)

Current state:

- Both clients call `POST /api/notifications/device` with
  `platform: 'android'` hardcoded in `src/lib/notify.ts`.
- The server's `src/services/notify.ts` sends every `device_tokens` row through
  Firebase Cloud Messaging.
- On iOS, `@capacitor/push-notifications` returns an **APNs** device token, not
  an FCM registration token. FCM cannot deliver to that token unless the app is
  registered with the Firebase iOS SDK and has an FCM token.
- There is no Firebase iOS SDK in `figma-ui`, and the Xcode project does not
  reference `GoogleService-Info.plist`. Adding the plist alone would not fix
  push.

Fix needed:

1. Send `Capacitor.getPlatform()` (`ios` or `android`) instead of the hardcoded
   `android`.
2. Split `device_tokens` by platform in the server.
3. Send Android tokens through FCM as today.
4. Send iOS tokens directly to APNs using the `.p8` key (HTTP/2 + ES256 JWT),
   or add a native Firebase Messaging plugin to both iOS apps and use FCM
   tokens. Direct APNs is the smaller change for this codebase.
5. Add the APNs key ID, team ID, and `.p8` to the Elastic Beanstalk environment.
6. Test on TestFlight with the app backgrounded and closed.

Until this is fixed, iOS push will not arrive. The driver app would only receive
offers while it is in the foreground. Do not submit the driver app for production
without fixing this.

### 14.2 Driver background location (review risk)

The driver `Info.plist` declares `UIBackgroundModes: location` and the
`NSLocationAlways...` permission strings, but `src/lib/locationService.ts` uses
the WebView `navigator.geolocation` API. iOS suspends WebView JavaScript when
the app is backgrounded, so the declared background mode may not actually keep
location updates running.

Choose one before archiving:

- Add a native background-geolocation Capacitor plugin and use it while the
  driver is online, or
- Remove `location` from `UIBackgroundModes` and the Always permission strings
  for v1.7, and ship the driver app as foreground-only. Apple may reject a
  background mode the app does not actually use.

The review notes in section 12 must match whichever choice you make.

### 14.3 Demo accounts

Create both accounts in production before submitting:

- `review.rider@ridevura.com` - verified rider, no open rides, no Pay Later
  balance.
- `review.driver@ridevura.com` - approved driver, approved documents, active
  vehicle, no open rides.

Keep the passwords out of git. Put them only in App Store Connect's App Review
Information.

### 14.4 Rider Android Firebase (not an iOS blocker)

The Android rider build still uses a cloned Firebase client for
`app.vura.rider`. Register the real Android app in Firebase project
`vura-f667d`, replace `android/app/google-services.json`, and rebuild the AAB.
The iOS build does not need a Firebase iOS app if push uses direct APNs.

### 14.5 Pay Later gate

Before uploading any rider build, run the query in `STORE_RELEASE.md` section 9
against production. It must return zero rows. v1.5 hides the only screen where a
rider can repay an outstanding balance.

### 14.6 Screenshots and on-device tests

Capture screenshots from the demo accounts on a real iPhone. Do not use Android
screenshots. Test the restore/cancel flows and the driver stale-offer flow before
submitting.

---

## 15. Release checklist

```
[ ] Apple Developer membership active; Team ID recorded
[ ] Free Apps agreement accepted
[ ] App ID app.vura.rider registered; Push Notifications on
[ ] App ID app.vura.driver registered; Push Notifications on
[ ] APNs key created; .p8 stored securely; Key ID and Team ID recorded
[ ] App Store Connect record for Vura created
[ ] App Store Connect record for Vura Driver created
[ ] App information, category, age rating completed for both
[ ] App Privacy completed for both; matches PrivacyInfo.xcprivacy
[ ] Pricing: Free; availability South Africa
[ ] iPhone screenshots captured (at least one 1179x2556 or 1206x2622 per app)
[ ] Demo rider account created and verified
[ ] Demo driver account approved with vehicle and documents
[ ] iOS push platform fix and APNs server support deployed
[ ] Driver background-location decision applied
[ ] Xcode 26 archive built for rider 1.5 (6)
[ ] Xcode 26 archive built for driver 1.7 (8)
[ ] Both builds uploaded and processed in App Store Connect
[ ] TestFlight internal testing passed on a real iPhone
[ ] Review notes and demo credentials entered
[ ] Both apps submitted for review
[ ] Approved versions released manually
```
