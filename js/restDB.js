// js/restDB.js v3.2 - ログイン任意対応 + キャッシュユーザー別
const RestDB = (() => {
  const GAS_URL = "https://script.google.com/macros/s/AKfycbxkNZwkMCaMlRA7LRw5k9aGr8YJGdYfy_TgiOinWm6is3C8UgoueybU8IFGtENgOaiRTA/exec";
  const LOCAL_JSON_URL = "./data/restDatabase.json";
  let useLocal = false;

  function getUid() {
    try {
      return window.firebaseAuth?.currentUser?.uid || window.auth?.currentUser?.uid || 'guest';
    } catch { return 'guest'; }
  }
  function getCacheKey() {
    return `restee_rest_cache_v3_${getUid()}`;
  }
  function getHistoryKey() {
    return `restee_history_${getUid()}`;
  }

  function parseYouTubeId(urlOrId) {
    if (!urlOrId) return "";
    if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
    try {
      const u = new URL(urlOrId);
      const v = u.searchParams.get("v");
      if (v && v.length === 11) return v;
      const parts = u.pathname.split("/");
      for (const part of parts) { if (part.length === 11) return part; }
    } catch {}
    if (urlOrId.includes("youtu.be/")) {
      const p = urlOrId.split("youtu.be/")[1].split(/[?&#]/)[0];
      if (p.length >= 11) return p.slice(0,11);
    }
    if (urlOrId.includes("v=")) {
      const p = urlOrId.split("v=")[1].split(/[&#]/)[0];
      if (p.length >= 11) return p.slice(0,11);
    }
    return "";
  }

  function normalizeType(raw) {
    if (!raw) return "";
    const s = String(raw).toLowerCase().trim();
    if (["body","physical","身体","体","からだ","フィジカル"].includes(s)) return "body";
    if (["brain","脳","頭","あたま","ブレイン"].includes(s)) return "brain";
    if (["mental","精神","心","メンタル","こころ"].includes(s)) return "mental";
    return s;
  }

  function normalizeArray(input) {
    if (!input) return [];
    let arr = [];
    if (Array.isArray(input)) arr = input;
    else if (typeof input === 'string') arr = input.split(',');
    else arr = [input];
    return arr.map(t => normalizeType(t)).filter(Boolean);
  }

  function normalizeSteps(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input.map(s=>String(s).trim()).filter(Boolean);
    if (typeof input === 'string') {
      // 改行、句点、番号付きなどを考慮
      const t = input.trim();
      if (!t) return [];
      if (t.includes('\n')) return t.split('\n').map(s=>s.trim()).filter(Boolean);
      if (t.includes('。') && t.split('。').length > 2) return t.split('。').map(s=>s.trim()).filter(Boolean).map(s=>s.endsWith('。')?s:s+'。');
      if (t.includes('|')) return t.split('|').map(s=>s.trim()).filter(Boolean);
      return [t];
    }
    return [];
  }

  function enrich(m) {
    let fTypes = normalizeArray(m.fatigueTypes);
    const cat = normalizeType(m.category);
    if (fTypes.length === 0 && cat) fTypes = [cat];
    if (fTypes.length === 0) fTypes = ["body","brain","mental"];
    return {
      ...m,
      category: cat || "body",
      fatigueTypes: fTypes,
      tags: Array.isArray(m.tags) ? m.tags : String(m.tags||"").split(',').map(s=>s.trim()).filter(Boolean),
      youtubeId: m.youtubeId || parseYouTubeId(m.youtubeUrl || ""),
      imageUrl: m.imageUrl || m.image || "",
      timeMin: Number(m.timeMin) || 0,
      level: m.level || "light",
      steps: normalizeSteps(m.steps),
      detail: m.detail || m.description || "",
      description: m.description || m.detail || ""
    };
  }

  async function load({ type = "all", tag = "", level = "", q = "" } = {}) {
    const params = new URLSearchParams({ type, tag, level, q });
    const url = useLocal ? LOCAL_JSON_URL : `${GAS_URL}?${params}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      let methods = (json.methods || json).map(enrich);
      if (useLocal) {
        if (type !== "all") {
          const nType = normalizeType(type);
          methods = methods.filter(m => m.fatigueTypes.includes(nType) || m.category === nType);
        }
      }
      try { localStorage.setItem(getCacheKey(), JSON.stringify({ t: Date.now(), methods })); } catch {}
      console.log(`[RestDB] loaded ${methods.length} methods as ${getUid()}`, methods.slice(0,2));
      return methods;
    } catch (e) {
      console.warn("[RestDB] fetch failed, fallback", e);
      try {
        const saved = JSON.parse(localStorage.getItem(getCacheKey()) || "null");
        if (saved?.methods?.length) return saved.methods.map(enrich);
      } catch {}
      if (!useLocal) { useLocal = true; return load({ type, tag, level, q }); }
      return [];
    }
  }

  function pickForResult(scores, methods) {
    const map = { physical: "body", brain: "brain", mental: "mental" };
    const entries = [
      ["physical", scores.physical || 0],
      ["brain", scores.brain || 0],
      ["mental", scores.mental || 0]
    ].sort((a,b)=>b[1]-a[1]);

    const topKey = entries[0][0];
    const topType = map[topKey];
    const secondType = entries[1] ? map[entries[1][0]] : null;
    const thirdType = entries[2] ? map[entries[2][0]] : null;

    let topMatches = methods.filter(m => m.fatigueTypes.includes(topType));
    let secondMatches = secondType ? methods.filter(m => m.fatigueTypes.includes(secondType)) : [];
    let thirdMatches = thirdType ? methods.filter(m => m.fatigueTypes.includes(thirdType)) : [];

    let combined = [];
    combined.push(...topMatches.slice(0,2));
    combined.push(...secondMatches.slice(0,1));
    combined.push(...thirdMatches.slice(0,1));

    if (combined.length < 4) combined.push(...topMatches.slice(2));
    if (combined.length < 4) combined.push(...secondMatches.slice(1));
    if (combined.length < 4) combined.push(...methods);

    const uniq = [...new Map(combined.map(m=>[m.id,m])).values()];
    uniq.sort((a,b) => {
      const aTop = a.fatigueTypes.includes(topType) ? 0 : 1;
      const bTop = b.fatigueTypes.includes(topType) ? 0 : 1;
      if (aTop !== bTop) return aTop - bTop;
      const levelOrder = { light: 0, medium: 1, heavy: 2 };
      const la = levelOrder[a.level] ?? 1;
      const lb = levelOrder[b.level] ?? 1;
      if (la !== lb) return la - lb;
      return a.timeMin - b.timeMin;
    });

    const result = uniq.slice(0,4);
    console.log("[RestDB] final picks", result.map(r=>`${r.title} [${r.fatigueTypes.join(',')}]`));
    return result;
  }

  // ★追加: 診断結果保存（ゲストでも動く）
  async function saveResult(scores, pickedMethods) {
    const payload = {
      uid: getUid(),
      scores,
      methods: pickedMethods.map(m => m.id),
      createdAt: new Date().toISOString()
    };
    const key = getHistoryKey();
    try {
      const history = JSON.parse(localStorage.getItem(key) || "[]");
      history.unshift(payload);
      localStorage.setItem(key, JSON.stringify(history.slice(0,20)));
    } catch(e){ console.warn(e); }

    if (getUid() !== 'guest') {
      try {
        await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'saveResult', ...payload }) });
      } catch(e){ console.warn('cloud save failed', e); }
    }
  }

  return { load, pickForResult, saveResult, parseYouTubeId, _setUseLocal: v=>useLocal=v, _normalize: normalizeType, _getUid: getUid };
})();
