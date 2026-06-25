import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

let firebaseApp: admin.app.App;

function getFirebaseApp(): admin.app.App {
  if (firebaseApp) return firebaseApp;

  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (base64) {
    const serviceAccount = JSON.parse(
      Buffer.from(base64, "base64").toString("utf-8")
    );
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }

  return firebaseApp;
}

export async function verifyToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
  const app = getFirebaseApp();
  return app.auth().verifyIdToken(idToken);
}

export default getFirebaseApp;
