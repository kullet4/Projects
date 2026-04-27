// Import the functions you need from the CDN SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// Your web app's Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyCq85PKh7Mj0laokR-keEq9sovI6nHGkT4",
  authDomain: "elms-sdt-capstone.firebaseapp.com",
  projectId: "elms-sdt-capstone",
  storageBucket: "elms-sdt-capstone.firebasestorage.app",
  messagingSenderId: "791358266196",
  appId: "1:791358266196:web:92eec87af5c3d78e5e46c1",
  measurementId: "G-ZZKVGML05Q"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and export it
export const auth = getAuth(app);

// Initialize Cloud Firestore and export it
export const db = getFirestore(app);

// Enable offline persistence for Firestore
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Firebase persistence failed: Multiple tabs open');
    } else if (err.code == 'unimplemented') {
        console.warn('Firebase persistence not supported by browser');
    }
});