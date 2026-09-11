import admin from "firebase-admin";

let firebaseApp: admin.app.App | null = null;

export function getFirebaseApp(): admin.app.App {
  if (firebaseApp) return firebaseApp;

  // Two ways to authenticate (chosen in order):
  //  1) Explicit env vars — FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY +
  //     FIREBASE_PROJECT_ID. This is the EB-friendly option (no file needed).
  //  2) GOOGLE_APPLICATION_CREDENTIALS env var pointing to the service-account
  //     JSON file — Firebase Admin SDK picks it up automatically.
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID || "vura-f667d";

  if (clientEmail && privateKey) {
    firebaseApp = admin.initializeApp({
      projectId,
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        // Env vars arrive with literal "\n" sequences; expand them to real
        // newlines that the RSA signer requires.
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
  } else {
    firebaseApp = admin.initializeApp({
      projectId,
    });
  }

  console.log("✓ Firebase Admin SDK initialized");
  return firebaseApp;
}

export function getAuth(): admin.auth.Auth {
  return getFirebaseApp().auth();
}