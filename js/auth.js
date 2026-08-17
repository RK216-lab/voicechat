// js/auth.js - 最終版 v3 - ログイン任意対応
import { auth } from './firebase.js';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

const provider = new GoogleAuthProvider();

export function login() {
  return signInWithPopup(auth, provider).catch(e => {
    console.error("[auth] login failed", e);
    alert("ログインに失敗しました: " + e.message);
    throw e;
  });
}

export function logout() {
  return signOut(auth);
}

export function getUserId() {
  return auth.currentUser?.uid || 'guest';
}

export function isGuest() {
  return !auth.currentUser;
}

export function getUser() {
  return auth.currentUser;
}

export function initAuth(callback) {
  onAuthStateChanged(auth, (user) => {
    try { if (callback) callback(user); } catch(e){ console.warn(e); }
    safeUpdateUI(user);
  });
}

// 後方互換: 旧コードが import { auth } from "./js/auth.js" してた場合も動くように
export { auth };

function safeUpdateUI(user) {
  const statusEl = document.getElementById('auth-status');
  const logoutBtn = document.getElementById('btn-logout');
  const loginLink = document.getElementById('btn-login-link');
  const nameEl = document.getElementById('profile-name');
  const avatarEl = document.getElementById('profile-avatar');
  const greetingTitle = document.getElementById('greeting-title');
  const loginBtnHeader = document.getElementById('login-btn');

  if (statusEl) {
    if (user) {
      const display = user.displayName || user.email?.split('@')[0] || 'ユーザー';
      statusEl.innerHTML = `<p class="font-bold text-gray-800">${display}</p><p class="text-xs text-gray-400">${user.email||''}</p><div class="mt-2 px-2.5 py-1 bg-green-50 text-green-600 rounded-full text-xs inline-block">ログイン中</div>`;
    } else {
      statusEl.innerHTML = `<span class="px-2.5 py-1 bg-gray-100 rounded-full text-xs font-bold">ゲストモード</span> で利用中<br><p class="text-xs mt-2 text-gray-400">ログインするとデータがクラウドに保存されます</p>`;
    }
  }
  if (nameEl && document.body.dataset.page === 'profile') {
    nameEl.textContent = user ? (user.displayName || user.email?.split('@')[0]) : 'ゲスト';
  }
  if (greetingTitle) {
    greetingTitle.textContent = user ? `おはよう、${(user.displayName?.split(' ')[0]||'ユーザー')}さん` : 'おはよう、ゲストさん';
  }
  if (avatarEl && user?.photoURL) avatarEl.src = user.photoURL;
  if (logoutBtn) {
    logoutBtn.style.display = user ? '' : 'none';
    if (user) logoutBtn.onclick = logout;
  }
  if (loginLink) loginLink.style.display = user ? 'none' : '';
  if (loginBtnHeader) {
    loginBtnHeader.textContent = user ? 'ログアウト' : 'ログイン';
    loginBtnHeader.onclick = user ? logout : login;
  }
}
