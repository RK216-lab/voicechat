/**
 * Restee 共通アプリロジック
 * - スキャン結果の保存/読み込み (localStorage)
 * - ホーム、ケア、プロフィールへのデータ反映
 * - ナビゲーションのアクティブ制御
 */
// app.js の最初に
import { initAuth } from './auth.js';
initAuth((user) => {
  // ログインしててもしてなくてもアプリ起動
  startApp(user);
});
const STORAGE_KEYS = {
  LAST_SCAN: 'restee_last_scan',
  HISTORY: 'restee_history',
  FAVORITES: 'restee_favorites'
};

// スキャン結果を保存
function saveScanResult(result) {
  const data = {
    ...result,
    timestamp: new Date().toISOString(),
    dateStr: new Date().toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  };
  localStorage.setItem(STORAGE_KEYS.LAST_SCAN, JSON.stringify(data));
  // 履歴に追加
  const history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]');
  history.unshift(data);
  if (history.length > 20) history.pop();
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  return data;
}

function loadLastScan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAST_SCAN);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]');
  } catch { return []; }
}

// 疲労タイプ判定
function getDominantType(scores) {
  if (!scores) return 'body';
  const { physical=50, brain=50, mental=50 } = scores;
  if (physical <= brain && physical <= mental) return 'body';
  if (brain <= physical && brain <= mental) return 'brain';
  return 'mental';
}

function getFatigueLabel(type) {
  const map = { body: '身体', brain: '脳', mental: '精神' };
  return map[type] || '身体';
}

function getWellbeingMessage(total) {
  if (total >= 80) return '絶好調！この調子をキープしましょう';
  if (total >= 60) return 'まずまずの調子です';
  if (total >= 40) return '少しお疲れ気味です';
  return '今日はゆっくり休みましょう';
}

// ホーム画面更新
function updateHomeUI() {
  const last = loadLastScan();
  const scoreEls = {
    brain: document.getElementById('score-brain'),
    mental: document.getElementById('score-mental'),
    body: document.getElementById('score-body'),
    brainCircle: document.getElementById('circle-brain'),
    mentalCircle: document.getElementById('circle-mental'),
    bodyCircle: document.getElementById('circle-body'),
    statusBadge: document.getElementById('status-badge'),
    fatigueTitle: document.getElementById('fatigue-type-title'),
    fatigueDesc: document.getElementById('fatigue-type-desc'),
    greeting: document.getElementById('greeting-text')
  };

  if (!last) {
    // 初回：デフォルト表示のまま
    if (scoreEls.statusBadge) scoreEls.statusBadge.innerHTML = '<span class="material-icons-outlined text-sm mr-1">update</span>本日未判定';
    return;
  }

  const { physical, brain, mental, total } = last.final || last;
  // サークル更新
  if (scoreEls.brainCircle) scoreEls.brainCircle.style.setProperty('--p-value', brain);
  if (scoreEls.mentalCircle) scoreEls.mentalCircle.style.setProperty('--p-value', mental);
  if (scoreEls.bodyCircle) scoreEls.bodyCircle.style.setProperty('--p-value', physical);
  if (scoreEls.brain) scoreEls.brain.textContent = Math.round(brain);
  if (scoreEls.mental) scoreEls.mental.textContent = Math.round(mental);
  if (scoreEls.body) scoreEls.body.textContent = Math.round(physical);

  if (scoreEls.statusBadge) {
    scoreEls.statusBadge.textContent = `${last.dateStr} 測定`;
    scoreEls.statusBadge.classList.add('bg-green-50', 'text-green-600');
  }

  const dominant = getDominantType({ physical, brain, mental });
  const label = getFatigueLabel(dominant);
  if (scoreEls.fatigueTitle) {
    scoreEls.fatigueTitle.innerHTML = `<span class="material-icons-outlined text-orange-500 mr-2 text-lg">insights</span>${label}的な疲労が蓄積しています`;
  }
  if (scoreEls.fatigueDesc && last.fatigueDetail) {
    scoreEls.fatigueDesc.textContent = last.fatigueDetail;
  }
  if (scoreEls.greeting) {
    scoreEls.greeting.innerHTML = `${getWellbeingMessage(total)}<br>${last.fatigueTitle || '結果を確認してみましょう'}`;
  }
}

// ケア画面のフィルタリング
function filterCareByFatigue() {
  const last = loadLastScan();
  if (!last) return;
  const dominant = getDominantType(last.final || last);
  // タグハイライト用にbodyにクラス付与
  document.body.setAttribute('data-dominant', dominant);
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.getAttribute('data-page') || '';
  if (page === 'home') updateHomeUI();
  if (page === 'care') filterCareByFatigue();

  // プロフィール：履歴表示
  if (page === 'profile') {
    const history = loadHistory();
    const container = document.getElementById('history-list');
    if (container && history.length) {
      container.innerHTML = history.slice(0,5).map(h => {
        const f = h.final || h;
        return `<div class="wavy-card p-4 flex justify-between items-center">
          <div><p class="text-xs text-gray-400">${h.dateStr}</p><p class="text-sm font-bold">Well-being ${Math.round(f.total || 0)}</p></div>
          <div class="flex gap-2 text-xs"><span class="px-2 py-1 bg-blue-50 rounded">脳${Math.round(f.brain||0)}</span><span class="px-2 py-1 bg-green-50 rounded">精神${Math.round(f.mental||0)}</span><span class="px-2 py-1 bg-orange-50 rounded">身体${Math.round(f.physical||0)}</span></div>
        </div>`;
      }).join('');
    }
  }

  // 学習：検索
  const searchInput = document.getElementById('learn-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#learn-articles .wavy-card').forEach(card => {
        const text = card.innerText.toLowerCase();
        card.style.display = text.includes(q) ? '' : 'none';
      });
    });
  }
});

// グローバルに公開
window.ResteeApp = { saveScanResult, loadLastScan, loadHistory, getDominantType };
