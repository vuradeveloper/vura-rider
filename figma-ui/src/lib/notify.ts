// ─────────────────────────────────────────────────────────────────────────────
// Phone notifications for ride milestones.
//
// STATUS: stubbed on purpose. The intended implementation uses
// @capacitor/local-notifications (a SYSTEM notification needs no FCM), but that
// plugin's Android module requires a JDK 21 toolchain and this build machine only
// has JDK 17 — including it broke the whole APK build:
//
//   Could not create task ':capacitor-local-notifications:compileDebugJavaWithJavac'
//     > Cannot find a Java installation matching: {languageVersion=21}
//
// Everything else about the ride is untouched: the screens still show "Driver
// accepted" / "Driver has arrived" live, and they now also POLL the server so a
// missed event can never leave the rider stuck on "waiting for a driver".
//
// To switch the phone notification on: either install a JDK 21 toolchain and
// re-add the plugin, or use FCM push (needs android/app/google-services.json)
// which also covers a CLOSED app — then replace the body of notifyRide() below.
// ─────────────────────────────────────────────────────────────────────────────

export async function notifyRide(_title: string, _body: string): Promise<void> {
  // no-op until the plugin can be compiled (see the note above)
  return
}

