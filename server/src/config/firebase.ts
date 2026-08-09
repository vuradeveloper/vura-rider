import admin from "firebase-admin";

let firebaseApp: admin.app.App | null = null;

export function getFirebaseApp(): admin.app.App {
  if (firebaseApp) return firebaseApp;

  // GOOGLE_APPLICATION_CREDENTIALS env var points to the service account JSON file
  // Firebase Admin SDK picks it up automatically
  firebaseApp = admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "vura-f667d",
  });

  console.log("✓ Firebase Admin SDK initialized");
  return firebaseApp;
}

export function getAuth(): admin.auth.Auth {
  return getFirebaseApp().auth();
}