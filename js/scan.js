/* =========================================================
   Restee 自分スキャン scan.js 完全版 vFixed-Patched
   ========================================================= */

const BACKEND_URL = "https://voicechat-9w4o.onrender.com";
const CHAT_URL = "/api/chat"; // Vercel側のGroq用。Renderじゃない！

const TRANSFORMERS_CANDIDATES = [
  "https://esm.sh/@huggingface/transformers@3.7.2",
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm",
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1/dist/transformers.js/+esm"
];

const ASR_MODEL_CANDIDATES = [
  "onnx-community/Moonshine-tiny-ONNX",
  "wmoto-ai/moonshine-tiny-ja-ONNX"
];

const EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const LOCAL_TTS_MODEL = "Xenova/mms-tts-jpn";

const SILENCE_THRESHOLD = 0.011;
const SILENCE_MS = 2200;
const POST_TTS_GAP_MS = 500;
const MAX_RECORDING_MS = 20000;

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_SAFARI = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const AVOID_CONCURRENCY = IS_IOS || IS_SAFARI;

let transformersModule = null;
let transcriber = null, extractor = null, defVectors = null, localTTSPipeline = null;
let isModelReady = false, isEmbedReady = false, isLocalTTSReady = false;
let isRecording = false, isSpeaking = false, isConversationStarted = false;
let mediaRecorder = null, audioChunks = [];
let audioContext = null, analyserContext = null, analyser = null;
let silenceStart = null, waveRaf = null, recordingTimeoutId = null;
let currentTurn = 0, allUserTexts = [], lastAudioBlob = null, conversationLog = [], lastAcoustic = {}, currentOpening = "";
let loadCopyTimer = null, recognition = null, iosLastTranscript = "", iosRecognitionStarted = false, iosStopResolver = null, iosNativeMode = false, useNativeASR = false;
let audioUnlocked = false, playbackAudio = null, playbackObjectURL = null;

const DOM = {};
function bindDOM() {
  DOM.statusText = document.getElementById("statusText");
  DOM.aiPromptText = document.getElementById("aiPromptText");
  DOM.progressBar = document.getElementById("progressBar");
  DOM.progressText = document.getElementById("progressText");
  DOM.micBtn = document.getElementById("micBtn");
  DOM.micHint = document.getElementById("micHint");
  DOM.micInnerIcon = document.getElementById("micInnerIcon");
  DOM.waveContainer = document.getElementById("waveContainer");
  DOM.waveDots = DOM.waveContainer ? [...DOM.waveContainer.querySelectorAll(".wave-dot")] : [];
  DOM.viewResultBtn = document.getElementById("viewResultBtn");
  DOM.recoveryList = document.getElementById("recoveryList");
  DOM.scanScreen = document.getElementById("scanScreen");
  DOM.resultScreen = document.getElementById("resultScreen");
}

function resetSessionState() {
  allUserTexts = []; conversationLog = []; lastAcoustic = {}; window.lastEmbedRaw = null; iosLastTranscript = ""; currentTurn = 0; lastAudioBlob = null; audioChunks = [];
}

function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const order = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/aac"];
  for (const t of order) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {} }
  return "";
}

function isMediaRecorderSupported() {
  return typeof MediaRecorder !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

function revokePlaybackURL() { if (playbackObjectURL) { try { URL.revokeObjectURL(playbackObjectURL); } catch {} playbackObjectURL = null; } }

function createPlaybackAudio() {
  if (playbackAudio) return playbackAudio;
  playbackAudio = new Audio(); playbackAudio.preload = "auto"; playbackAudio.playsInline = true;
  playbackAudio.setAttribute("playsinline", ""); playbackAudio.setAttribute("webkit-playsinline", "");
  playbackAudio.style.position = "fixed"; playbackAudio.style.left = "-9999px"; playbackAudio.style.width = "1px"; playbackAudio.style.height = "1px"; playbackAudio.style.opacity = "0.01";
  document.body.appendChild(playbackAudio); return playbackAudio;
}

async function unlockAudioContext() {
  if (audioUnlocked) return;
  try {
    createPlaybackAudio();
    if (!audioContext) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioContext = new AC(); }
    if (audioContext?.state === "suspended") await audioContext.resume();
    if (audioContext) { const b = audioContext.createBuffer(1, 1, 22050); const s = audioContext.createBufferSource(); s.buffer = b; s.connect(audioContext.destination); s.start(0); }
    audioUnlocked = true;
  } catch (e) { console.warn("[unlock]", e); }
}

function installAudioUnlock() {
  const h = () => { if (!audioUnlocked) unlockAudioContext().catch(() => {}); };
  document.addEventListener("touchstart", h, { once: true, passive: true });
  document.addEventListener("pointerdown", h, { once: true, passive: true });
  document.addEventListener("click", h, { once: true, passive: true });
}

const OPENINGS = ["こんにちは。今日はどんな一日でしたか？楽しかったことや、疲れたことなど教えてください。","お疲れさまです。今の調子はいかがですか？元気、眠い、少しだるいなど、近いものを教えてください。","今日は体の調子、いかがでしたか？重い、眠い、元気など、感じたことを教えてください。","今日は頭の調子、どうでしたか？集中できた、ぼーっとしたなど、思ったことを教えてください。","今日は気分、どうでしたか？楽しい、落ち着く、ちょっとモヤモヤするなど、聞かせてください。","今日、一番疲れたのはどんなときでしたか？勉強、仕事、人とのやりとりなど、何でも大丈夫です。","今日は何か頑張ったこと、ありましたか？勉強や部活、家のことなど、何でも大丈夫です。","今日、いつもよりしんどいと感じたことはありましたか？眠気やだるさなど、気になることを教えてください。","今いちばん気になるのはどこですか？体、頭、気分のことなど、何でも大丈夫です。","今日をひとことで言うと、どんな日でしたか？「疲れた」「元気だった」くらいでも大丈夫です。"];
const LOAD_COPIES = ["耳を澄ます準備をしています…","言葉のニュアンスを読み解く準備中…","あなたの声を聴く準備をしています…","声の特徴を受け取る準備中…","まもなくお話しできます…"];
const SYSTEM_BASE = `あなたはユーザーの疲れに寄り添う、自然でやわらかい聞き手です。\n厳守: 60文字以内1〜2文。まず受け止め共感。質問最大1つ。箇条書き・診断・スコア禁止。`;

function buildTurnSystem(phase, openingText) {
  if (phase === "followup") return `${SYSTEM_BASE}\n今は2回目。最初は「${openingText}」①受け止め②違う角度で1つだけ深掘り。同じ聞き直し禁止。`;
  return `${SYSTEM_BASE}\n最後の発話。これまでを1文で受け止め「話してくれてありがとう」で終える。質問禁止。40文字以内。`;
}

const FATIGUE_DEFS = {
  body: ["体が重い、だるい、肩や首や腰が張って動くのがつらい","朝起きたときに体が軽く感じられない","目がしょぼしょぼする、まぶたが重い","いつもより動くことが負担","筋肉の張りや違和感","眠いというより体が鉛のよう","頭痛や肩こりが続いている"],
  brain: ["頭がぼんやりして集中できない","情報を整理したり思い出す作業が難しい","何も考えたくない","画面を見続けるとすぐ疲れる","判断にいつもより時間がかかる","言葉が出にくい","同じことを何度も確認してしまう","頭の回転が遅い感じ"],
  mental: ["気持ちが休まらない、イライラする","プレッシャーを感じて心が疲れている","やる気が出ない","不安が続きリラックスできない","人と話すのが少し負担","些細なことで腹が立つ","落ち込みやすく","心がざわついて落ち着かない"],
  healthy: ["特に疲れはなく調子がよい","集中できて気分も安定している","睡眠も食欲も問題なく","ストレスはあるがコントロールできて","体も気持ちもすっきり"]
};

const RECOVERY = {
  body: [{ icon: "self_improvement", color: "#ea580c", bg: "bg-orange-100", title: "軽いストレッチ", desc: "座ったまま肩・首をゆっくり回す（3分）" },{ icon: "hot_tub", color: "#0284c7", bg: "bg-sky-100", title: "温活", desc: "ぬるめのお湯で体の芯を温める" },{ icon: "hotel", color: "#7c3aed", bg: "bg-violet-100", title: "短い仮眠", desc: "15〜20分の昼寝で体を休める" }],
  brain: [{ icon: "visibility", color: "#0891b2", bg: "bg-cyan-100", title: "画面から離れる", desc: "5〜10分、遠くを見て目と頭を休める" },{ icon: "directions_walk", color: "#16a34a", bg: "bg-green-100", title: "短い散歩", desc: "外の空気を吸って頭を切り替える" },{ icon: "timer", color: "#64748b", bg: "bg-slate-100", title: "ポモドーロ休息", desc: "25分集中したら5分完全に休む" }],
  mental: [{ icon: "air", color: "#2563eb", bg: "bg-blue-100", title: "深呼吸", desc: "4秒吸って6秒吐く呼吸を5回" },{ icon: "edit_note", color: "#db2777", bg: "bg-pink-100", title: "気持ちの書き出し", desc: "今気になっていることをメモに出すだけ" },{ icon: "music_note", color: "#9333ea", bg: "bg-purple-100", title: "好きな休息", desc: "何もしない時間を10分つくる" }],
  general: [{ icon: "local_drink", color: "#0d9488", bg: "bg-teal-100", title: "水分補給", desc: "常温の水をゆっくり飲む" },{ icon: "bedtime", color: "#4f46e5", bg: "bg-indigo-100", title: "早めの就寝準備", desc: "いつもより30分早く寝る準備を始める" }]
};

function preprocessText(raw) { if (!raw) return ""; let t = String(raw).normalize("NFKC").trim(); t = t.replace(/^(えっと|えー|あの|その|まあ|なんか|こう|はい|うん|うーん)+/g, ""); return t.trim(); }
function analyzeModifiers(text) { const t = text || ""; let scale = 1.0, negated = false; if (/(つらくない|疲れてない|疲れていない|大丈夫|問題ない|平気|別につら|そんなに(疲れ|つら)|特に(ない|疲れ))/.test(t)) { negated = true; scale *= 0.45; } if (/(少し|ちょっと|やや)/.test(t)) scale *= 0.75; if (/(かなり|とても|すごく|めっちゃ|本当に|ひどく|限界|もう無理)/.test(t)) scale *= 1.28; return { scale: Math.max(0.4, Math.min(1.35, scale)), negated }; }

async function importTransformersRobust() {
  if (transformersModule) return transformersModule;
  let lastErr = null;
  for (const url of TRANSFORMERS_CANDIDATES) {
    try {
      console.log("[Transformers] try", url);
      const mod = await import(/* @vite-ignore */ url);
      const cand = mod.pipeline ? mod : mod.default || mod;
      if (cand?.pipeline) { transformersModule = cand; console.log("[Transformers] loaded", url); return cand; }
    } catch (e) { lastErr = e; console.warn("[Transformers] failed", url, e?.message || e); }
  }
  throw lastErr || new Error("transformers import failed");
}

async function loadEmbedder(pipelineFn, envObj) {
  try {
    if (!pipelineFn) { const mod = await importTransformersRobust(); pipelineFn = mod.pipeline; envObj = mod.env; }
    extractor = await pipelineFn("feature-extraction", EMBED_MODEL, { dtype: "q8", device: "wasm" });
    defVectors = {}; const limit = IS_IOS ? 3 : 999;
    for (const [k, texts] of Object.entries(FATIGUE_DEFS)) {
      const vecs = []; for (const t of texts.slice(0, limit)) { const out = await extractor(t, { pooling: "mean", normalize: true }); vecs.push(Array.from(out.data)); } defVectors[k] = vecs;
    } isEmbedReady = true; console.log("[Embedding] ready");
  } catch (e) { console.warn("[Embedding] failed, heuristic fallback", e); isEmbedReady = false; throw e; }
}

async function loadLocalTTS() {
  if (isLocalTTSReady || window._localTTSLoading) return; window._localTTSLoading = true;
  try {
    const { pipeline } = await importTransformersRobust();
    localTTSPipeline = await pipeline("text-to-speech", LOCAL_TTS_MODEL, { dtype: "q8", device: "wasm" });
    isLocalTTSReady = true; console.log("[Local TTS] ready");
  } catch (e) { console.warn("[Local TTS] failed", e); } finally { window._localTTSLoading = false; }
}

function cosine(a, b) { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }
function simToCategory(v, p) { if (!p?.length) return 0.5; const sims = p.map(x => cosine(v, x)); return 0.7 * Math.max(...sims) + 0.3 * sims.reduce((a, b) => a + b, 0) / sims.length; }
function acousticFatigueProxy(f) { if (!f || !Object.keys(f).length) return null; const get = (...keys) => { for (const k of keys) if (f[k] != null && Number.isFinite(Number(f[k]))) return Number(f[k]); for (const k of Object.keys(f)) for (const w of keys) if ((k.endsWith(w) || k.includes(w)) && Number.isFinite(Number(f[k]))) return Number(f[k]); return null; }; const loud = get("loudness_sma3_amean"), jitter = get("jitterLocal_sma3nz_amean"), hnr = get("HNRdBACF_sma3nz_amean"); let sc = 50; if (loud != null) sc += (0.35 - loud) * 60; if (jitter != null) sc += (jitter - 0.02) * 400; if (hnr != null) sc += (8 - hnr) * 2.5; return Math.max(20, Math.min(88, Math.round(sc))); }
function heuristicTextScores(t) { let ph = 42, br = 42, me = 42; if (/肩|首|腰|だるい|重い|体|眠い|目が疲/.test(t)) ph += 22; if (/集中|ぼんやり|頭|忘れ|ミス|判断|モヤ|整理/.test(t)) br += 22; if (/イライラ|不安|ストレス|やる気|落ち込|しんどい|つらい|ざわ/.test(t)) me += 22; if (/元気|調子いい|大丈夫|問題ない|すっきり/.test(t)) { ph -= 18; br -= 18; me -= 18; } const mod = analyzeModifiers(t); ph = Math.max(15, Math.min(92, Math.round(ph * mod.scale))); br = Math.max(15, Math.min(92, Math.round(br * mod.scale))); me = Math.max(15, Math.min(92, Math.round(me * mod.scale))); if (mod.negated) { ph = Math.min(ph, 40); br = Math.min(br, 40); me = Math.min(me, 40); } return { physical: ph, brain: br, mental: me, total: Math.max(22, Math.min(92, Math.round(100 - ((ph + br + me) / 3) * 0.88))) }; }

async function scoreFromText(userText, acoustic) {
  const cleaned = preprocessText(userText); const mod = analyzeModifiers(userText || cleaned); let es;
  if (!isEmbedReady || !extractor || !defVectors) es = heuristicTextScores(cleaned);
  else { try { const out = await extractor(cleaned || "特になし", { pooling: "mean", normalize: true }); const v = Array.from(out.data); const raw = { body: simToCategory(v, defVectors.body), brain: simToCategory(v, defVectors.brain), mental: simToCategory(v, defVectors.mental), healthy: simToCategory(v, defVectors.healthy) }; const toPct = c => Math.max(12, Math.min(93, Math.round(48 + c * 160))); let ph = toPct(raw.body - raw.healthy), br = toPct(raw.brain - raw.healthy), me = toPct(raw.mental - raw.healthy); ph = Math.max(12, Math.min(93, Math.round(ph * mod.scale))); br = Math.max(12, Math.min(93, Math.round(br * mod.scale))); me = Math.max(12, Math.min(93, Math.round(me * mod.scale))); if (mod.negated) { ph = Math.min(ph, 38); br = Math.min(br, 38); me = Math.min(me, 38); } es = { physical: ph, brain: br, mental: me, total: Math.max(18, Math.min(95, Math.round(100 - ((ph + br + me) / 3) * 0.88))), raw }; } catch { es = heuristicTextScores(cleaned); } }
  if (/肩|首|腰|だるい|重い|体が/.test(userText)) es.physical = Math.min(93, es.physical + 18);
  if (/眠い|ぼんやり|集中|頭|忘れ|ミス|判断/.test(userText)) es.brain = Math.min(93, es.brain + 16);
  if (/しんどい|つらい|イライラ|不安|ストレス|やる気|落ち込/.test(userText)) es.mental = Math.min(93, es.mental + 18);
  es.total = Math.max(18, Math.min(95, Math.round(100 - ((es.physical + es.brain + es.mental) / 3) * 0.88)));
  const ac = acousticFatigueProxy(acoustic || lastAcoustic);
  if (ac != null) { const bl = e => Math.round(e * 0.8 + ac * 0.2); es.physical = bl(es.physical); es.brain = bl(es.brain); es.mental = bl(es.mental); es.total = Math.max(18, Math.min(95, Math.round(100 - ((es.physical + es.brain + es.mental) / 3) * 0.88))); }
  return es;
}

async function scoreFromBackend(blob, text) {
  if (!blob) throw new Error("no audio"); const fd = new FormData(); const mime = blob.type || ""; let ext = "webm"; if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) ext = "m4a"; else if (mime.includes("wav")) ext = "wav"; fd.append("file", blob, `recording.${ext}`); fd.append("text", text || ""); if (window.lastEmbedRaw) { const er = window.lastEmbedRaw; if (er.body !== undefined) fd.append("sim_body", String(er.body)); if (er.brain !== undefined) fd.append("sim_brain", String(er.brain)); if (er.mental !== undefined) fd.append("sim_mental", String(er.mental)); if (er.healthy !== undefined) fd.append("sim_healthy", String(er.healthy)); }
  const res = await fetch(`${BACKEND_URL}/predict-fatigue`, { method: "POST", body: fd }); if (!res.ok) throw new Error(await res.text()); const data = await res.json(); if (data.final) return { physical: Math.round(data.final.physical), brain: Math.round(data.final.brain), mental: Math.round(data.final.mental), total: Math.round(data.final.total), raw: data, source: "ensemble" }; return { physical: Math.round(data.physical), brain: Math.round(data.brain), mental: Math.round(data.mental), total: Math.round(data.total), raw: data, source: "lightgbm" };
}

async function scoreWithFallback(userText, acoustic, blob) {
  window.lastEmbedRaw = null;
  try { if (isEmbedReady && extractor && defVectors) { const out = await extractor(userText || "特になし", { pooling: "mean", normalize: true }); const v = Array.from(out.data); window.lastEmbedRaw = { body: simToCategory(v, defVectors.body), brain: simToCategory(v, defVectors.brain), mental: simToCategory(v, defVectors.mental), healthy: simToCategory(v, defVectors.healthy) }; } } catch {}
  if (blob) { try { if (DOM.statusText) DOM.statusText.textContent = "分析中..."; return await scoreFromBackend(blob, userText); } catch (e) { console.warn("[backend fallback to local]", e); } }
  return await scoreFromText(userText, acoustic);
}

function pickRecovery(scores) { const entries = [["body", scores.physical], ["brain", scores.brain], ["mental", scores.mental]].sort((a, b) => b[1] - a[1]); const list = []; const [topKey] = entries[0]; const [secKey, secVal] = entries[1]; list.push(...RECOVERY[topKey].slice(0, 2)); if (secVal >= 55) list.push(RECOVERY[secKey][0]); list.push((scores.physical + scores.brain + scores.mental) / 3 >= 60 ? RECOVERY.general[1] : RECOVERY.general[0]); const seen = new Set(), uniq = []; for (const it of list) if (!seen.has(it.title)) { seen.add(it.title); uniq.push(it); } return { topKey, suggestions: uniq.slice(0, 4) }; }
function renderRecovery(sugs) { if (!DOM.recoveryList) return; DOM.recoveryList.innerHTML = sugs.map((s, i) => `<div class="bg-white rounded-2xl p-3 shadow-sm border border-slate-100 flex items-center gap-3 slide-up" style="animation-delay:${0.05 * i}s"><div class="w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center shrink-0"><span class="material-icons-outlined" style="color:${s.color}">${s.icon}</span></div><div class="min-w-0"><p class="text-xs font-bold text-slate-700">${s.title}</p><p class="text-[11px] text-slate-400">${s.desc}</p></div></div>`).join(""); }
function titleFromScores(scores) { const e = [["身体", scores.physical], ["脳", scores.brain], ["精神", scores.mental]].sort((a, b) => b[1] - a[1]); const [n, v] = e[0]; if (v >= 72) return `${n}の強い疲れ`; if (v >= 55) return `${n}寄りの疲れ`; if (scores.total >= 72) return "比較的すっきりした状態"; return "総合的な疲れ"; }
function applyScoreUI(scores) { const totalEl = document.getElementById("scoreTotalVal"); if (totalEl) totalEl.textContent = scores.total; const hintEl = document.getElementById("scoreHint"); if (hintEl) hintEl.textContent = scores.total >= 70 ? "比較的コンディションは良好です" : scores.total >= 50 ? "無理をせず、ペースを落として大丈夫です" : "休息を優先してあげてください"; const b = document.getElementById("scoreBrainVal"), m = document.getElementById("scoreMentalVal"), p = document.getElementById("scorePhysicalVal"); if (b) b.innerHTML = `${scores.brain}<span class="text-xs font-normal">%</span>`; if (m) m.innerHTML = `${scores.mental}<span class="text-xs font-normal">%</span>`; if (p) p.innerHTML = `${scores.physical}<span class="text-xs font-normal">%</span>`; requestAnimationFrame(() => { const bb = document.getElementById("barBrain"), mb = document.getElementById("barMental"), pb = document.getElementById("barPhysical"); if (bb) bb.style.width = scores.brain + "%"; if (mb) mb.style.width = scores.mental + "%"; if (pb) pb.style.width = scores.physical + "%"; }); }
function startLoadCopyRotation() { let i = 0; if (DOM.statusText) DOM.statusText.textContent = LOAD_COPIES[0]; loadCopyTimer = setInterval(() => { i = (i + 1) % LOAD_COPIES.length; if (DOM.statusText) DOM.statusText.textContent = LOAD_COPIES[i]; }, 2200); }
function stopLoadCopyRotation() { if (loadCopyTimer) { clearInterval(loadCopyTimer); loadCopyTimer = null; } }
function updateProgress(p, label) { const c = Math.max(0, Math.min(100, p)); if (DOM.progressBar) DOM.progressBar.style.width = c + "%"; if (DOM.progressText) DOM.progressText.textContent = label || `${c}%`; }
function setupIOSRecognition() { const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return null; const rec = new SR(); rec.lang = "ja-JP"; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1; rec.onstart = () => { iosRecognitionStarted = true; }; rec.onresult = e => { let finalText = ""; for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) finalText += e.results[i][0]?.transcript || ""; if (finalText.trim()) iosLastTranscript = (iosLastTranscript + " " + finalText).trim(); }; rec.onerror = e => { console.warn("[SR] error", e.error); }; rec.onend = () => { iosRecognitionStarted = false; if (iosStopResolver) { iosStopResolver(); iosStopResolver = null; } }; return rec; }
function stopIOSRecognitionAsync() { return new Promise(resolve => { if (!recognition || !iosRecognitionStarted) { resolve(); return; } iosStopResolver = resolve; try { recognition.stop(); } catch { resolve(); } setTimeout(() => { if (iosStopResolver) { iosStopResolver(); iosStopResolver = null; } resolve(); }, 800); }); }

async function loadModel() {
  try {
    bindDOM(); resetSessionState(); startLoadCopyRotation(); updateProgress(5, "5%");
    recognition = setupIOSRecognition();

    const { pipeline, env } = await importTransformersRobust();
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    if (env.backends?.onnx?.wasm) {
      try { env.backends.onnx.wasm.numThreads = 1; } catch {}
      try { env.backends.onnx.wasm.simd = true; } catch {}
      try { env.backends.onnx.wasm.proxy = false; } catch {}
    }

    updateProgress(15, "15%");

    let lastAsrError = null;
    for (const modelId of ASR_MODEL_CANDIDATES) {
      try {
        console.log(`[ASR] trying ${modelId}`);
        if (DOM.statusText) DOM.statusText.textContent = `モデル読込中… ${modelId.split('/').pop()}`;
        transcriber = await pipeline(
          "automatic-speech-recognition",
          modelId,
          {
            device: "wasm",
            progress_callback: (p) => {
              if (p.status === "progress" && p.progress) updateProgress(15 + (p.progress / 100) * 55, `${Math.round(15 + (p.progress / 100) * 55)}%`);
            }
          }
        );
        console.log(`[ASR] loaded ${modelId}`); break;
      } catch (e) {
        lastAsrError = e;
        console.error("[ASR] FAILED:", modelId, e);
        transcriber = null;
      }
    }

    if (!transcriber) {
      if (recognition) {
        console.warn("[ASR] fallback to Native SpeechRecognition");
        useNativeASR = true;
        isModelReady = true;
        iosNativeMode = !isMediaRecorderSupported();
      } else {
        throw lastAsrError || new Error("All ASR models failed and no SpeechRecognition");
      }
    } else {
      isModelReady = true;
      useNativeASR = false;
      iosNativeMode = false;
    }

    updateProgress(75, "75%");
    try {
      await loadEmbedder(pipeline, env);
    } catch (e) {
      console.warn("[Embedding] continue with heuristic", e);
      isEmbedReady = false;
    }

    updateProgress(100, "100%"); stopLoadCopyRotation();
    currentOpening = OPENINGS[Math.floor(Math.random() * OPENINGS.length)];
    if (DOM.aiPromptText) DOM.aiPromptText.innerHTML = currentOpening.replace(/。/g, "。<br>");
    conversationLog = [{ role: "assistant", content: currentOpening }];
    if (DOM.micBtn) { DOM.micBtn.disabled = false; DOM.micBtn.classList.remove("opacity-50"); }
    setMicUI(false);
    if (DOM.statusText) DOM.statusText.textContent = useNativeASR ? "軽量モードで開始（タップ）" : "タップして開始";
    if (DOM.micHint) DOM.micHint.textContent = "ここを押して会話をはじめる";
  } catch (e) {
    console.error("[loadModel] fatal", e);
    stopLoadCopyRotation();
    const shortMsg = (e?.message || String(e)).slice(0, 80);
    if (DOM.statusText) DOM.statusText.textContent = `読込失敗: ${shortMsg}`;
    if (DOM.aiPromptText) DOM.aiPromptText.innerHTML = `読込失敗: ${shortMsg}<br>タップで再試行`;
    if (DOM.micBtn) { DOM.micBtn.disabled = false; DOM.micBtn.classList.remove("opacity-50"); }
    if (recognition) { isModelReady = true; useNativeASR = true; iosNativeMode = !isMediaRecorderSupported(); if (DOM.statusText) DOM.statusText.textContent = "軽量モードで開始（タップ）"; currentOpening = OPENINGS[0]; conversationLog = [{ role: "assistant", content: currentOpening }]; if (DOM.aiPromptText) DOM.aiPromptText.innerHTML = currentOpening; }
  }
}

async function blobToFloat32(blob) {
  if (!blob?.size) return new Float32Array(0);
  try {
    const ab = await blob.arrayBuffer(); if (!ab.byteLength) return new Float32Array(0);
    const AC = window.AudioContext || window.webkitAudioContext;
    for (const opts of [{ sampleRate: 16000 }, {}]) {
      try { const ctx = new AC(opts); const buf = await ctx.decodeAudioData(ab.slice(0)); let data = buf.getChannelData(0); if (buf.sampleRate !== 16000 && buf.duration > 0) { const len = Math.max(1, Math.ceil(buf.duration * 16000)); const off = new OfflineAudioContext(1, len, 16000); const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start(); const rendered = await off.startRendering(); data = rendered.getChannelData(0); } try { await ctx.close(); } catch {} return new Float32Array(data); } catch (err) { console.warn("[decode try]", opts, err.message); }
    }
  } catch (e) { console.warn("[blobToFloat32]", e); }
  return new Float32Array(0);
}

// 【修正①】文字起こし関数のパラメータ修復
async function transcribe(float32) {
  const getFallback = () => { const t = preprocessText(iosLastTranscript); return t.length >= 2 ? t : ""; };
  if (!float32?.length) return getFallback() || "（聞き取れませんでした）";
  
  if (transcriber) {
    try {
      const out = await transcriber(float32, {
        sampling_rate: 16000,
        return_timestamps: false
      });
      if (out?.text?.trim()) return preprocessText(out.text);
    } catch (e) {
      console.warn("[Moonshine transcribe error]", e);
    }
  }
  return getFallback() || "（聞き取れませんでした）";
}

// 【修正②】LLM API呼び出しの完全保護（フォーマット不整合対策）
async function callLLM(messages) {
  try {
    const controller = new AbortController();
    const t = setTimeout(()=>controller.abort(), 15000);
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: controller.signal
    });
    clearTimeout(t);

    if (!res.ok) throw new Error(`LLM status: ${res.status}`);
    const data = await res.json();
    
    // 様々なバックエンドレスポンス形式を安全にフォールバックパース
    const resultText = data.text || data.reply || data.choices?.[0]?.message?.content || (typeof data === "string" ? data : "");
    if (!resultText) throw new Error("Empty response from LLM");
    return resultText;
  } catch (e) {
    console.error("[callLLM error]", e);
    return ""; // エラー時は空文字を返して後続でデフォルトフォールバックを効かせる
  }
}

async function getAcoustic(blob) {
  try {
    if (!blob?.size) return {}; const fd = new FormData(); const mime = blob.type || ""; let ext = "webm"; if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) ext = "m4a"; else if (mime.includes("wav")) ext = "wav"; fd.append("file", blob, `speech.${ext}`);
    const r = await fetch(`${BACKEND_URL}/extract-features`, { method: "POST", body: fd }); if (!r.ok) return {}; return await r.json();
  } catch (e) { console.warn("[OpenSMILE]", e); return {}; }
}

function parseDiagnosisJSON(raw, scores) { 
  const ft = titleFromScores(scores);
  const fd = "今日の話をありがとう。無理せず、できる範囲で休んでみてください。"; 
  if (!raw) return { title: ft, detail: fd }; 
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(); 
  const m = s.match(/\{[\s\S]*\}/); 
  if (m) s = m[0]; 
  try { 
    const o = JSON.parse(s); 
    return { title: (o.title || ft).toString().trim(), detail: (o.detail || fd).toString().trim() }; 
  } catch { 
    return { title: ft, detail: fd }; 
  } 
}

function setMicUI(rec) { if (!DOM.micBtn) return; if (rec) { DOM.micInnerIcon.textContent = "stop"; DOM.micInnerIcon.className = "material-icons stop-icon"; if (DOM.micHint) DOM.micHint.textContent = "タップして停止"; DOM.micBtn.classList.add("mic-pulse"); } else { DOM.micInnerIcon.textContent = "mic"; DOM.micInnerIcon.className = "material-icons mic-icon"; if (DOM.micHint) DOM.micHint.textContent = "タップして話す"; DOM.micBtn.classList.remove("mic-pulse"); } }
function updateWaveFromRms(rms) { const level = Math.min(1, Math.max(0, (rms - 0.004) / 0.08)); DOM.waveDots.forEach((dot, i) => { const center = (DOM.waveDots.length - 1) / 2; const dist = center === 0 ? 0 : Math.abs(i - center) / center; const h = 6 + level * (22 - dist * 10); dot.style.transform = `scaleY(${h / 6})`; dot.style.opacity = String(0.35 + level * 0.65); }); }
function stopWaveAnim() { if (waveRaf) { cancelAnimationFrame(waveRaf); waveRaf = null; } DOM.waveDots.forEach(d => { d.style.transform = "scaleY(1)"; d.style.opacity = "0.45"; }); }

async function startRecording() {
  if (!isModelReady || isRecording || isSpeaking) return;
  if (!isMediaRecorderSupported() && !recognition) { if (DOM.statusText) DOM.statusText.textContent = "この端末は録音に未対応です"; return; }
  await unlockAudioContext();

  if (!isMediaRecorderSupported() && recognition) {
    iosLastTranscript = ""; isRecording = true; DOM.waveContainer?.classList.remove("hidden"); if (DOM.statusText) DOM.statusText.textContent = "あなたのお話を聞いています..."; setMicUI(true);
    try { recognition.start(); } catch { isRecording = false; setMicUI(false); return; }
    recordingTimeoutId = setTimeout(() => { if (isRecording) stopRecording(); }, MAX_RECORDING_MS); return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mimeType = getSupportedMimeType(); audioChunks = []; iosLastTranscript = "";
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = e => { if (e.data?.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop()); stopWaveAnim();
      if (recordingTimeoutId) { clearTimeout(recordingTimeoutId); recordingTimeoutId = null; }
      if (analyserContext) { try { if (analyserContext.state !== "closed") await analyserContext.close(); } catch {} analyserContext = null; analyser = null; }
      await stopIOSRecognitionAsync();
      await processTurn();
    };
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { analyserContext = new AC(); if (analyserContext.state === "suspended") await analyserContext.resume(); const src = analyserContext.createMediaStreamSource(stream); analyser = analyserContext.createAnalyser(); analyser.fftSize = 512; src.connect(analyser); }
    mediaRecorder.start(200); isRecording = true; silenceStart = null;
    DOM.waveContainer?.classList.remove("hidden"); if (DOM.statusText) DOM.statusText.textContent = "あなたのお話を聞いています..."; setMicUI(true);
    if (useNativeASR && recognition) { try { recognition.start(); } catch {} }
    else if (!AVOID_CONCURRENCY && recognition && !transcriber) { try { recognition.start(); } catch {} }
    recordingTimeoutId = setTimeout(() => { if (isRecording) stopRecording(); }, MAX_RECORDING_MS); loopMonitor();
  } catch (e) { console.error(e); isRecording = false; if (DOM.statusText) DOM.statusText.textContent = "マイクの許可が必要です。設定を確認してください"; setMicUI(false); }
}

function stopRecording() {
  if (!isRecording) return;
  if (!isMediaRecorderSupported()) {
    isRecording = false; DOM.waveContainer?.classList.add("hidden"); if (DOM.statusText) DOM.statusText.textContent = "認識中..."; setMicUI(false);
    if (recordingTimeoutId) { clearTimeout(recordingTimeoutId); recordingTimeoutId = null; }
    (async () => { await stopIOSRecognitionAsync(); await processTurn(); })(); return;
  }
  if (!mediaRecorder) return; isRecording = false; DOM.waveContainer?.classList.add("hidden"); if (DOM.statusText) DOM.statusText.textContent = "認識中..."; setMicUI(false); try { mediaRecorder.stop(); } catch {}
}

function loopMonitor() {
  if (!isRecording || !analyser) return; const data = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data); let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; } const rms = Math.sqrt(sum / data.length); updateWaveFromRms(rms); const th = AVOID_CONCURRENCY ? SILENCE_THRESHOLD * 1.5 : SILENCE_THRESHOLD; const ms = AVOID_CONCURRENCY ? SILENCE_MS + 1000 : SILENCE_MS; if (rms < th) { if (!silenceStart) silenceStart = Date.now(); else if (Date.now() - silenceStart > ms) { stopRecording(); return; } } else silenceStart = null; waveRaf = requestAnimationFrame(loopMonitor);
}

function afterSpeakThenRecord() { setTimeout(() => { if (isModelReady && currentTurn < 2 && DOM.viewResultBtn?.classList.contains("hidden")) { if (DOM.statusText) DOM.statusText.textContent = "タップして話す"; if (DOM.micHint) DOM.micHint.textContent = "マイクを押してください"; if (DOM.micBtn) { DOM.micBtn.disabled = false; DOM.micBtn.classList.remove("opacity-50"); } setMicUI(false); } }, POST_TTS_GAP_MS); }

async function processTurn() {
  try {
    let blob = null;
    if (audioChunks.length > 0) {
      const mt = mediaRecorder?.mimeType || getSupportedMimeType() || "audio/webm";
      blob = new Blob(audioChunks, { type: mt });
      if (!blob.size) blob = null;
    }
    if (blob) lastAudioBlob = blob;

    if (DOM.statusText) DOM.statusText.textContent = "文字起こし中...";
    let float32 = new Float32Array(0);
    if (blob) float32 = await blobToFloat32(blob);

    let userText = "";
    if (transcriber) {
      userText = await transcribe(float32);
      if (userText.includes("聞き取れませんでした") && iosLastTranscript) {
        const t = preprocessText(iosLastTranscript);
        if (t.length >= 2) userText = t;
      }
    } else {
      userText = preprocessText(iosLastTranscript) || "（聞き取れませんでした）";
    }

    allUserTexts.push(userText); conversationLog.push({ role: "user", content: userText }); currentTurn++;

    if (currentTurn === 1) {
      if (DOM.statusText) DOM.statusText.textContent = "AIが考えています..."; updateProgress(35, "35%");
      if (blob) getAcoustic(blob).then(f => { lastAcoustic = f; }).catch(() => {});
      const messages = [{ role: "system", content: buildTurnSystem("followup", currentOpening) }, ...conversationLog];
      const rawReply = await callLLM(messages);
      const reply = rawReply.trim() || "そうなんですね。もう少し詳しく教えてもらえますか？";
      conversationLog.push({ role: "assistant", content: reply }); if (DOM.aiPromptText) DOM.aiPromptText.innerHTML = reply.replace(/\n/g, "<br>"); speakAI(reply, afterSpeakThenRecord); return;
    }
    if (currentTurn === 2) {
      if (DOM.statusText) DOM.statusText.textContent = "AIが考えています..."; updateProgress(65, "65%");
      const closeMessages = [{ role: "system", content: buildTurnSystem("close", currentOpening) }, ...conversationLog];
      const rawSummary = await callLLM(closeMessages);
      const summary = rawSummary.trim() || "話してくれてありがとう。";
      conversationLog.push({ role: "assistant", content: summary }); if (DOM.aiPromptText) DOM.aiPromptText.innerHTML = summary.replace(/\n/g, "<br>");
      if (!Object.keys(lastAcoustic).length && lastAudioBlob) lastAcoustic = await getAcoustic(lastAudioBlob);
      if (DOM.statusText) DOM.statusText.textContent = "内容を分析中..."; updateProgress(85, "85%");
      const scores = await scoreWithFallback(allUserTexts.join("。"), lastAcoustic, lastAudioBlob);
      const recovery = pickRecovery(scores);
      const diagMsgs = [{ role: "system", content: `あなたは優しいアドバイザーです。出力は必ず次のJSONのみ。{"title":"〇〇な疲れ","detail":"ユーザーに語りかける2〜3文。"}` }, { role: "user", content: `身体:${scores.physical} 脳:${scores.brain} 精神:${scores.mental} 総合:${scores.total}\n${conversationLog.map(m => (m.role === "user" ? "ユーザー" : "AI") + "：" + m.content).join("\n")}` }];
      const rawDiag = await callLLM(diagMsgs); const { title, detail } = parseDiagnosisJSON(rawDiag, scores);
      const te = document.getElementById("fatigueTitle"), de = document.getElementById("fatigueDetailText"); if (te) te.textContent = title; if (de) de.textContent = detail;
      applyScoreUI(scores); renderRecovery(recovery.suggestions);
      const saveData = { ...scores, fatigueTitle: title, fatigueDetail: detail, conversation: conversationLog, final: scores };
      if (window.ResteeApp?.saveScanResult) window.ResteeApp.saveScanResult(saveData); else localStorage.setItem("restee_last_scan", JSON.stringify({ ...saveData, timestamp: new Date().toISOString(), dateStr: new Date().toLocaleString("ja-JP") }));
      updateProgress(100, "100%"); if (DOM.statusText) DOM.statusText.textContent = "スキャン完了"; DOM.micBtn?.classList.add("hidden"); DOM.viewResultBtn?.classList.remove("hidden"); speakAI(`${summary}。結果をご覧ください。`);
    }
  } catch (e) { console.error(e); if (DOM.statusText) DOM.statusText.textContent = "エラーが発生しました。もう一度どうぞ"; setMicUI(false); isRecording = false; }
}

async function speakWithBackend(text) {
  if (!text?.trim()) return; await unlockAudioContext();
  const url = `${BACKEND_URL}/tts?text=${encodeURIComponent(text)}&voice=ja-JP-NanamiNeural`;
  const controller = new AbortController(); const tid = setTimeout(() => controller.abort(), 18000);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store" }); if (!res.ok) throw new Error(await res.text().catch(() => ""));
    const blob = await res.blob(); if (!blob.size) throw new Error("empty TTS"); const audio = createPlaybackAudio(); try { audio.pause(); } catch {} revokePlaybackURL(); playbackObjectURL = URL.createObjectURL(blob); audio.src = playbackObjectURL; audio.currentTime = 0;
    await new Promise((resolve, reject) => { let done = false; const cleanup = () => { audio.onended = null; audio.onerror = null; }; const ok = () => { if (done) return; done = true; cleanup(); revokePlaybackURL(); resolve(); }; const ng = (e) => { if (done) return; done = true; cleanup(); revokePlaybackURL(); reject(e); }; audio.onended = ok; audio.onerror = ng; const p = audio.play(); if (p?.then) p.catch(ng); });
  } finally { clearTimeout(tid); }
}

async function speakWithLocalMMS(text) {
  if (!isLocalTTSReady) await loadLocalTTS(); if (!localTTSPipeline) throw new Error("local TTS not ready"); const chunks = text.match(/.{1,120}(。|、|．|！|？|$)/g) || [text]; const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC(); if (ctx.state === "suspended") await ctx.resume();
  try { for (const ch of chunks) { if (!ch.trim()) continue; const out = await localTTSPipeline(ch); const buf = ctx.createBuffer(1, out.audio.length, out.sampling_rate); buf.getChannelData(0).set(out.audio); const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); await new Promise(r => { src.onended = r; src.start(); }); } } finally { try { await ctx.close(); } catch {} }
}

async function speakAI(text, onEnd, maxRetries = 1) {
  if (!text?.trim()) { onEnd?.(); return; }
  if (isSpeaking || isRecording) {
    if (isSpeaking) { onEnd?.(); return; }
    if (isRecording) { onEnd?.(); return; }
  }
  isSpeaking = true; let hasEnded = false;
  const safeEnd = () => { if (!hasEnded) { hasEnded = true; isSpeaking = false; try { onEnd?.(); } catch {} } };
  const prev = DOM.statusText?.textContent || "";
  if (DOM.statusText) DOM.statusText.textContent = "AIが話しています...";
  if (DOM.micBtn) { DOM.micBtn.disabled = true; DOM.micBtn.classList.add("opacity-50"); }
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { await speakWithBackend(text); lastErr = null; break; }
    catch (e) { lastErr = e; console.warn(`[TTS backend ${attempt}]`, e.message); }
    try {
      if (DOM.statusText) DOM.statusText.textContent = "音声を準備中...";
      await speakWithLocalMMS(text); lastErr = null; break;
    } catch (e) { lastErr = e; console.warn(`[TTS local ${attempt}]`, e.message); await new Promise(r => setTimeout(r, 600)); }
  }
  if (DOM.statusText) DOM.statusText.textContent = prev;
  if (isModelReady && DOM.viewResultBtn?.classList.contains("hidden") && DOM.micBtn) { DOM.micBtn.disabled = false; DOM.micBtn.classList.remove("opacity-50"); }
  if (lastErr && DOM.statusText) DOM.statusText.textContent = "音声を再生できませんでした。タップして続行";
  safeEnd();
}

function initScan() {
  bindDOM(); if (!DOM.micBtn) return; resetSessionState(); installAudioUnlock(); let handling = false;
  DOM.micBtn.addEventListener("click", async () => {
    console.log("[mic click]", {isModelReady, isSpeaking, isConversationStarted, isRecording});
    if (handling) return; handling = true;
    try {
      await unlockAudioContext(); 
      if (!isModelReady) { console.warn("not ready"); return; }
      if (isSpeaking) { console.warn("still speaking, skip"); return; }
      if (!isConversationStarted) { 
        isConversationStarted = true; 
        console.log("[first start] opening:", currentOpening);
        if (DOM.statusText) DOM.statusText.textContent = "タップして話す"; 
        if (DOM.micHint) DOM.micHint.textContent = "マイクを押して話してください";
        if (DOM.micBtn) { DOM.micBtn.disabled = false; DOM.micBtn.classList.remove("opacity-50"); }
        setMicUI(false);
        // 最初はTTS鳴らさず文字だけで開始。裏でこっそり鳴らす
        try { speakAI(currentOpening, ()=>{}); } catch(e){ console.warn(e); }
        return; 
      }
      if (isRecording) stopRecording(); else await startRecording();
    } finally { handling = false; }
  });
  DOM.viewResultBtn?.addEventListener("click", () => { DOM.scanScreen?.classList.add("hidden"); DOM.resultScreen?.classList.remove("hidden"); DOM.resultScreen?.classList.add("entering"); });
  loadModel();
}

document.addEventListener("DOMContentLoaded", initScan);