import { initializeApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

// getReactNativePersistence is only exported in the React Native bundle (dist/rn/).
// During SSR / web builds it is absent — fall back to in-memory persistence.
let persistence = inMemoryPersistence;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rnPersistence = require("firebase/auth").getReactNativePersistence;
  if (typeof rnPersistence === "function") {
    persistence = rnPersistence(AsyncStorage);
  }
} catch {
  // Not available — use inMemoryPersistence
}

const auth = initializeAuth(app, { persistence });

export { auth };
