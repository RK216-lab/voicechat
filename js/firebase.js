// js/firebase.js - 本番用：ハードコードなし、window.__ENV__ からのみ読む
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const ENV = (typeof window !== 'undefined' && window.__ENV__) ? window.__ENV__ : {};

function env(key) {
  const v = ENV[key];
  return (typeof v === 'string' && v.trim() !== '') ? v.trim() : '';
}

const firebaseConfig = {
  apiKey: env('VITE_FIREBASE_API_KEY'),
  authDomain: env('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: env('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: env('VITE_FIREBASE_APP_ID'),
  measurementId: env('VITE_FIREBASE_MEASUREMENT_ID'),
};

// ローカルで env.js を置き忘れた時の分かりやすいエラー
if (!firebaseConfig.apiKey) {
  console.error("[firebase] apiKeyが空です。js/env.js が読み込まれているか確認してください");
}

const app = firebaseConfig.apiKey ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

if (typeof window !== 'undefined') {
  window.auth = auth;
  window.firebaseAuth = auth;
  window.firebaseDB = db;
}
