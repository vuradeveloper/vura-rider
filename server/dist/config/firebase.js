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
        firebaseApp = firebase_admin_1.default.initializeApp({
            projectId,
            credential: firebase_admin_1.default.credential.cert({
                projectId,
                clientEmail,
                // Env vars arrive with literal "\n" sequences; expand them to real
                // newlines that the RSA signer requires.
                privateKey: privateKey.replace(/\\n/g, "\n"),
            }),
        });
    }
    else {
        firebaseApp = firebase_admin_1.default.initializeApp({
            projectId,
        });
    }
    console.log("✓ Firebase Admin SDK initialized");
    return firebaseApp;
}
function getAuth() {
    return getFirebaseApp().auth();
}
//# sourceMappingURL=firebase.js.map