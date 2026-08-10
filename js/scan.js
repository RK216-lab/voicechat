
/* =========================================================
   Restee 自分スキャン scan.js 完全版 vFinal
   - +esm 404対策: esm.sh優先の多重CDN
   - ort-wasm 404対策: wasmPathsを明示
   - iOS競合対策: MediaRecorderとSRの排他
   - onEnd二重呼び出し対策
   - m4a/mp4対応
   ========================================================= */

const BACKEND_URL = "https://voicechat-gz4j.onrender.com";

const ASR_MODEL_CANDIDATES = [
  { id: "wmoto-ai/moonshine-tiny-ja-ONNX", dtype: "q8" },
  { id: "onnx-community/moonshine-tiny-ja-ONNX", dtype: "q8" },
  { id: "onnx-community/moonshine-base-ONNX", dtype: "q8" },
  { id: "Xenova/whisper-tiny", dtype: "q8" }, // 最終フォールバック 軽量確実
];
const EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const LOCAL_TTS_MODEL = "Xenova/mms-tts-jpn";

const TRANSFORMERS_CANDIDATES = [
  "https://esm.sh/@huggingface/transformers@3.7.2",
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm",
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1/dist/transformers.js/+esm",
];

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
let loadCopyTimer = null, recognition = null, iosLastTranscript = "", iosRecognitionStarted = false, iosStopResolver = null, iosNativeMode = false;
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
  DOM.waveDots = DOM.waveContainer? [...DOM.waveContainer.querySelectorAll(".wave-dot")] : [];
  DOM.viewResultBtn = document.getElementById("viewResultBtn");
  DOM.recoveryList = document.getElementById("recoveryList");
  DOM.scanScreen = document.getElementById("scanScreen");
  DOM.resultScreen = document.getElementById("resultScreen");
}
function resetSessionState() {
  allUserTexts = []; conversationLog = []; lastAcoustic = {}; window.lastEmbedRaw = null; iosLastTranscript = ""; currentTurn = 0; lastAudioBlob = null; audioChunks = [];
}
function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined" ||!MediaRecorder.isTypeSupported) return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"]) try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {}
  return "";
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
      const cand = mod.pipeline? mod : mod.default || mod;
      if (cand?.pipeline) { transformersModule = cand; console.log("[Transformers] loaded", url); return cand; }
    } catch (e) { lastErr = e; console.warn("[Transformers] failed", url, e.message); }
  }
  throw lastErr || new Error("transformers import failed");
}
async function loadEmbedder(pipelineFn, envObj) {
  try {
    if (!pipelineFn) { const mod = await importTransformersRobust(); pipelineFn = mod.pipeline; envObj = mod.env; }
    extractor = await pipelineFn("feature-extraction", EMBED_MODEL, { dtype: "q8", device: "wasm" });
    defVectors = {}; const limit = IS_IOS? 3 : 999;
    for (const [k, texts] of Object.entries(FATIGUE_DEFS)) {
      const vecs = []; for (const t of texts.slice(0, limit)) { const out = await extractor(t, { pooling: "mean", normalize: true }); vecs.push(Array.from(out.data)); } defVectors[k] = vecs;
    } isEmbedReady = true;
  } catch (e) { console.warn("[Embedding]", e); isEmbedReady = false; }
}
async function loadLocalTTS() {
  if (isLocalTTSReady || window._localTTSLoading) return; window._localTTSLoading = true;
  try { const { pipeline } = await importTransformersRobust(); localTTSPipeline = await pipeline("text-to-speech", LOCAL_TTS_MODEL, { dtype: "q8", device: "wasm" }); isLocalTTSReady = true; } catch (e) { console.warn("[Local TTS]", e); } finally { window._localTTSLoading = false; }
}
function cosine(a, b) { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }
function simToCategory(v, p) { if (!p?.length) return 0.5; const sims = p.map(x => cosine(v, x)); return 0.7 * Math.max(...sims