"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirebaseApp = getFirebaseApp;
exports.getAuth = getAuth;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
let firebaseApp = null;
function getFirebaseApp() {
    if (firebaseApp)
        return firebaseApp;
    // GOOGLE_APPLICATION_CREDENTIALS env var points to the service account JSON file
    // Firebase Admin SDK picks it up automatically
    firebaseApp = firebase_admin_1.default.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || "vura-f667d",
    });
    console.log("✓ Firebase Admin SDK initialized");
    return firebaseApp;
}
function getAuth() {
    return getFirebaseApp().auth();
}
//# sourceMappingURL=firebase.js.map