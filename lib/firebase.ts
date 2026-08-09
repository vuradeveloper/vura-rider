import { getAnalytics, isSupported } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { initializeAuth, getAuth, browserLocalPersistence, Auth, getReactNativePersistence } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: "AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q",
  authDomain: "vura-f667d.firebaseapp.com",
  projectId: "vura-f667d",
  storageBucket: "vura-f667d.firebasestorage.app",
  messagingSenderId: "678275862018",
  appId: "1:678275862018:web:9a6143cd00746894d2e11b",
  measurementId: "G-L1KVVZEJWQ"
};

const app = initializeApp(firebaseConfig);

isSupported().then((yes) => yes && getAnalytics(app));

let auth: Auth;
if (Platform.OS === "web") {
  auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
  });
} else {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
}

export { auth };
export const FIREBASE_API_KEY = firebaseConfig.apiKey;

