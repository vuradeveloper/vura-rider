import { getAnalytics, isSupported } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence } from "firebase/auth";

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

const auth = initializeAuth(app, { persistence: inMemoryPersistence });

export { auth };
export const FIREBASE_API_KEY = firebaseConfig.apiKey;
