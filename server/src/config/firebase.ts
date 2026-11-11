import { initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth as getAdminAuth, type Auth } from "firebase-admin/auth";

let firebaseApp: App | null = null;

export function getFirebaseApp(): App {
  if (firebaseApp) return firebaseApp;

  // Two ways to authenticate (chosen in order):
  //  1) Explicit env vars — FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY +
  //     FIREBASE_PROJECT_ID. This is the EB-friendly option (no file needed).
  //  2) GOOGLE_APPLICATION_CREDENTIALS env var pointing to the service-account
  //     JSON file — Firebase Admin SDK picks it up automatically.
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // The private key can arrive two ways (both single-line, copy-safe):
  //  1) FIREBASE_PRIVATE_KEY — PEM with literal "\n" sequences (older fix)
  //  2) FIREBASE_PRIVATE_KEY_B64 — the whole PEM base64-encoded on ONE line.
  //     Long PEMs pasted into `eb setenv` frequently get line breaks mangled,
  //     which makes the RSA signer throw "DECODER routines::unsupported".
  //     Base64 has no newlines, so it can never be corrupted that way.
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!privateKey && process.env.FIREBASE_PRIVATE_KEY_B64) {
    privateKey = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_B64, "base64").toString("utf8");
  }
  const projectId = process.env.FIREBASE_PROJECT_ID || "vura-f667d";

  if (clientEmail && privateKey) {
    firebaseApp = initializeApp({
      projectId,
      credential: cert({
        projectId,
        clientEmail,
        // Env vars arrive with literal "\n" sequences; expand them to real
        // newlines that the RSA signer requires.
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
  } else {
    firebaseApp = initializeApp({
      projectId,
    });
  }

  console.log("✓ Firebase Admin SDK initialized");
  return firebaseApp;
}

export function getAuth(): Auth {
  return getAdminAuth(getFirebaseApp());
}