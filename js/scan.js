/* =========================================================
   Restee 自分スキャン
   scan.js 完全版 (全修正統合版)

   - 自動再生ポリシー(Autoplay)回避の初回タップ対応
   - Transformers.js +esm モジュールインポート
   - Moonshine Tiny JA を Pipeline で安定ロード
   - iOS SpeechRecognition fallback
   - Edge TTS / Render backend TTS 優先
   - Local MMS TTS fallback
   - Render API
   - Embedding
   - 疲労スコア
   ========================================================= */

const BACKEND_URL = "https://voicechat-gz4j.onrender.com";

const MODEL_ID = "wmoto-ai/moonshine-tiny-ja-ONNX";
const EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const LOCAL_TTS_MODEL = "Xenova/mms-tts-jpn";

// ESMモジュールとして確実なバージョンをインポート
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.4/+esm";

const SILENCE_THRESHOLD = 0.011;
const SILENCE_MS = 2200;
const POST_TTS_GAP_MS = 500;

const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const IS_SAFARI =
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

let transcriber = null; // Moonshine用（Pipeline）
let extractor = null;
let defVectors = null;

let localTTSPipeline = null;

let isModelReady = false;
let isEmbedReady = false;
let isLocalTTSReady = false;

let isRecording = false;
let isSpeaking = false;
let isConversationStarted = false; // 初回タップ検知用

let mediaRecorder = null;
let audioChunks = [];

let audioContext = null;
let analyser = null;
let silenceStart = null;
let waveRaf = null;

let currentTurn = 0;
let allUserTexts = [];
let lastAudioBlob = null;
let conversationLog = [];
let lastAcoustic = {};
let currentOpening = "";

let loadCopyTimer = null;

let recognition = null;
let iosLastTranscript = "";
let iosRecognitionStarted = false;

let audioUnlocked = false;
let playbackAudio = null;
let playbackObjectURL = null;

/* =========================================================
   DOM
   ========================================================= */

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
  DOM.waveDots = DOM.waveContainer
    ? [...DOM.waveContainer.querySelectorAll(".wave-dot")]
    : [];

  DOM.viewResultBtn = document.getElementById("viewResultBtn");
  DOM.recoveryList = document.getElementById("recoveryList");

  DOM.scanScreen = document.getElementById("scanScreen");
  DOM.resultScreen = document.getElementById("resultScreen");
}

/* =========================================================
   Audio
   ========================================================= */

function getSupportedMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac"
  ];

  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  if (!MediaRecorder.isTypeSupported) {
    return "";
  }

  for (const type of types) {
    try {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    } catch {}
  }

  return "";
}

function createPlaybackAudio() {
  if (playbackAudio) return playbackAudio;

  playbackAudio = new Audio();
  playbackAudio.preload = "auto";
  playbackAudio.autoplay = false;
  playbackAudio.controls = false;
  playbackAudio.playsInline = true;
  playbackAudio.setAttribute("playsinline", "");
  playbackAudio.setAttribute("webkit-playsinline", "");
  playbackAudio.style.display = "none";

  document.body.appendChild(playbackAudio);

  return playbackAudio;
}

async function unlockAudioContext() {
  try {
    createPlaybackAudio();

    if (!audioContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        audioContext = new AC();
      }
    }

    if (audioContext) {
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      const buffer = audioContext.createBuffer(1, 1, 22050);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(0);
    }

    const audio = playbackAudio;
    if (audio && audio.paused) {
      const oldSrc = audio.src;
      const silentWav =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIAfAAABAAgAZGF0YQAAAAA=";
      try {
        audio.src = silentWav;
        audio.volume = 0.001;
        const p = audio.play();
        if (p && typeof p.catch === "function") {
          await p.catch(() => {});
        }
        audio.pause();
        audio.currentTime = 0;
      } catch {}

      audio.src = oldSrc || "";
      audio.volume = 1;
    }

    audioUnlocked = true;
  } catch (e) {
    console.warn("[Audio unlock]", e);
  }
}

function installAudioUnlock() {
  const handler = () => {
    unlockAudioContext().catch(() => {});
  };
  document.addEventListener("touchstart", handler, { passive: true });
  document.addEventListener("pointerdown", handler, { passive: true });
  document.addEventListener("click", handler, { passive: true });
}

/* =========================================================
   Opening
   ========================================================= */

const OPENINGS = [
  "こんにちは。今日はどんな一日でしたか？楽しかったことや、疲れたことなど教えてください。",
  "お疲れさまです。今の調子はいかがですか？元気、眠い、少しだるいなど、近いものを教えてください。",
  "今日は体の調子、いかがでしたか？重い、眠い、元気など、感じたことを教えてください。",
  "今日は頭の調子、どうでしたか？集中できた、ぼーっとしたなど、思ったことを教えてください。",
  "今日は気分、どうでしたか？楽しい、落ち着く、ちょっとモヤモヤするなど、聞かせてください。",
  "今日、一番疲れたのはどんなときでしたか？勉強、仕事、人とのやりとりなど、何でも大丈夫です。",
  "今日は何か頑張ったこと、ありましたか？勉強や部活、家のことなど、何でも大丈夫です。",
  "今日、いつもよりしんどいと感じたことはありましたか？眠気やだるさなど、気になることを教えてください。",
  "今いちばん気になるのはどこですか？体、頭、気分のことなど、何でも大丈夫です。",
  "今日をひとことで言うと、どんな日でしたか？「疲れた」「元気だった」くらいでも大丈夫です。"
];

const LOAD_COPIES = [
  "耳を澄ます準備をしています…",
  "言葉のニュアンスを読み解く準備中…",
  "あなたの声を聴く準備をしています…",
  "声の特徴を受け取る準備中…",
  "まもなくお話しできます…"
];

const SYSTEM_BASE = `
あなたはユーザーの疲れに寄り添う、自然でやわらかい聞き手です。
厳守ルール:
- 出力は自然な日本語。全体で60文字以内。1〜2文だけ。
- まず相手の言い方を受け止め、必要なら少し言い換えてから共感する。
- 質問は最大1つ。
- 箇条書き・説明・診断名・スコア・医学的断定は禁止。
- 会話として自然に。
- 短く答えても責めない。
`;

function buildTurnSystem(phase, openingText) {
  if (phase === "followup") {
    return `${SYSTEM_BASE}
今は2回目の発話です。
最初の問いかけは次でした:
「${openingText}」

手順:
①ユーザーの言葉を自然に受け止める
②最初の質問と違う角度で、やさしく1つだけ深掘りする。

禁止:
「調子はどうですか？」など最初と同じ聞き直し。
`;
  }

  return `${SYSTEM_BASE}
最後の発話です。
これまでの内容を自然に1文で受け止め、
「話してくれてありがとう」と伝えて終えてください。

新しい質問は禁止。
診断やスコアには触れない。
40文字以内。
`;
}

/* =========================================================
   Fatigue data
   ========================================================= */

const FATIGUE_DEFS = {
  body: [
    "体が重い、だるい、肩や首や腰が張って動くのがつらい",
    "朝起きたときに体が軽く感じられない",
    "目がしょぼしょぼする、まぶたが重い",
    "いつもより動くことが負担",
    "筋肉の張りや違和感",
    "眠いというより体が鉛のよう",
    "頭痛や肩こりが続いている"
  ],
  brain: [
    "頭がぼんやりして集中できない",
    "情報を整理したり思い出す作業が難しい",
    "何も考えたくない",
    "画面を見続けるとすぐ疲れる",
    "判断にいつもより時間がかかる",
    "言葉が出にくい",
    "同じことを何度も確認してしまう",
    "頭の回転が遅い感じ"
  ],
  mental: [
    "気持ちが休まらない、イライラする",
    "プレッシャーを感じて心が疲れている", // タイポ修正
    "やる気が出ない",
    "不安が続きリラックスできない",
    "人と話すのが少し負担",
    "些細なことで腹が立つ",
    "落ち込みやすく",
    "心がざわついて落ち着かない"
  ],
  healthy: [
    "特に疲れはなく調子がよい",
    "集中できて気分も安定している",
    "睡眠も食欲も問題なく",
    "ストレスはあるがコントロールできて",
    "体も気持ちもすっきり"
  ]
};

const RECOVERY = {
  body: [
    { icon: "self_improvement", color: "#ea580c", bg: "bg-orange-100", title: "軽いストレッチ", desc: "座ったまま肩・首をゆっくり回す（3分）" },
    { icon: "hot_tub", color: "#0284c7", bg: "bg-sky-100", title: "温活", desc: "ぬるめのお湯で体の芯を温める" },
    { icon: "hotel", color: "#7c3aed", bg: "bg-violet-100", title: "短い仮眠", desc: "15〜20分の昼寝で体を休める" }
  ],
  brain: [
    { icon: "visibility", color: "#0891b2", bg: "bg-cyan-100", title: "画面から離れる", desc: "5〜10分、遠くを見て目と頭を休める" },
    { icon: "directions_walk", color: "#16a34a", bg: "bg-green-100", title: "短い散歩", desc: "外の空気を吸って頭を切り替える" },
    { icon: "timer", color: "#64748b", bg: "bg-slate-100", title: "ポモドーロ休息", desc: "25分集中したら5分完全に休む" }
  ],
  mental: [
    { icon: "air", color: "#2563eb", bg: "bg-blue-100", title: "深呼吸", desc: "4秒吸って6秒吐く呼吸を5回" },
    { icon: "edit_note", color: "#db2777", bg: "bg-pink-100", title: "気持ちの書き出し", desc: "今気になっていることをメモに出すだけ" },
    { icon: "music_note", color: "#9333ea", bg: "bg-purple-100", title: "好きな休息", desc: "何もしない時間を10分つくる" }
  ],
  general: [
    { icon: "local_drink", color: "#0d9488", bg: "bg-teal-100", title: "水分補給", desc: "常温の水をゆっくり飲む" },
    { icon: "bedtime", color: "#4f46e5", bg: "bg-indigo-100", title: "早めの就寝準備", desc: "いつもより30分早く寝る準備を始める" }
  ]
};

/* =========================================================
   Text processing
   ========================================================= */

function preprocessText(raw) {
  if (!raw) return "";
  let t = String(raw).normalize("NFKC").trim();
  t = t.replace(/^(えっと|えー|あの|その|まあ|なんか|こう|はい|うん|うーん)+/g, "");
  return t.trim();
}

function analyzeModifiers(text) {
  const t = text || "";
  let scale = 1.0;
  let negated = false;

  if (/(つらくない|疲れてない|疲れていない|大丈夫|問題ない|平気|別につら|そんなに(疲れ|つら)|特に(ない|疲れ))/.test(t)) {
    negated = true;
    scale *= 0.45;
  }
  if (/(少し|ちょっと|やや)/.test(t)) {
    scale *= 0.75;
  }
  if (/(かなり|とても|すごく|めっちゃ|本当に|ひどく|限界|もう無理)/.test(t)) {
    scale *= 1.28;
  }

  scale = Math.max(0.4, Math.min(1.35, scale));
  return { scale, negated };
}

/* =========================================================
   Embedding
   ========================================================= */

async function loadEmbedder() {
  try {
    const { pipeline } = await import(TRANSFORMERS_URL);
    extractor = await pipeline("feature-extraction", EMBED_MODEL, {
      dtype: "q8",
      device: "wasm"
    });

    defVectors = {};
    const limit = IS_IOS ? 3 : 999;

    for (const [key, texts] of Object.entries(FATIGUE_DEFS)) {
      const vecs = [];
      for (const t of texts.slice(0, limit)) {
        const out = await extractor(t, { pooling: "mean", normalize: true });
        vecs.push(Array.from(out.data));
      }
      defVectors[key] = vecs;
    }

    isEmbedReady = true;
  } catch (e) {
    console.warn("[Embedding]", e);
    isEmbedReady = false;
  }
}

/* =========================================================
   Local TTS
   ========================================================= */

async function loadLocalTTS() {
  if (isLocalTTSReady) return;
  try {
    const { pipeline } = await import(TRANSFORMERS_URL);
    localTTSPipeline = await pipeline("text-to-speech", LOCAL_TTS_MODEL, {
      dtype: "q8",
      device: "wasm"
    });
    isLocalTTSReady = true;
  } catch (e) {
    console.warn("[Local TTS]", e);
    isLocalTTSReady = false;
  }
}

/* =========================================================
   Similarity
   ========================================================= */

function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    s += a[i] * b[i];
  }
  return s;
}

function simToCategory(v, p) {
  if (!p || !p.length) return 0.5;
  const sims = p.map(x => cosine(v, x));
  return (
    0.7 * Math.max(...sims) +
    0.3 * sims.reduce((a, b) => a + b, 0) / sims.length
  );
}

/* =========================================================
   Acoustic
   ========================================================= */

function acousticFatigueProxy(f) {
  if (!f || !Object.keys(f).length) return null;

  const get = (...keys) => {
    for (const k of keys) {
      if (f[k] != null) {
        const v = Number(f[k]);
        if (Number.isFinite(v)) return v;
      }
    }
    for (const k of Object.keys(f)) {
      for (const want of keys) {
        if (k.endsWith(want) || k.includes(want)) {
          const v = Number(f[k]);
          if (Number.isFinite(v)) return v;
        }
      }
    }
    return null;
  };

  const loud = get("loudness_sma3_amean", "smile_loudness_sma3_amean");
  const jitter = get("jitterLocal_sma3nz_amean");
  const hnr = get("HNRdBACF_sma3nz_amean");

  let score = 50;
  if (loud != null) score += (0.35 - loud) * 60;
  if (jitter != null) score += (jitter - 0.02) * 400;
  if (hnr != null) score += (8 - hnr) * 2.5;

  return Math.max(20, Math.min(88, Math.round(score)));
}

/* =========================================================
   Heuristic score
   ========================================================= */

function heuristicTextScores(t) {
  let physical = 42;
  let brain = 42;
  let mental = 42;

  if (/だる|重い|肩こり|腰痛|眠い|体力|こわば|目が疲/.test(t)) physical += 22;
  if (/集中|ぼんやり|ミス|頭|忘れ|整理|判断|モヤ/.test(t)) brain += 22;
  if (/イライラ|落ち[込こ]|不安|ストレス|つらい|気[がも]重|やる気|ざわ/.test(t)) mental += 20;
  if (/元気|調子いい|大丈夫|問題ない|すっきり/.test(t)) {
    physical -= 18; brain -= 18; mental -= 18;
  }

  const mod = analyzeModifiers(t);

  physical = Math.max(15, Math.min(92, Math.round(physical * mod.scale)));
  brain = Math.max(15, Math.min(92, Math.round(brain * mod.scale)));
  mental = Math.max(15, Math.min(92, Math.round(mental * mod.scale)));

  if (mod.negated) {
    physical = Math.min(physical, 40);
    brain = Math.min(brain, 40);
    mental = Math.min(mental, 40);
  }

  const total = Math.round(100 - ((physical + brain + mental) / 3) * 0.88);

  return {
    physical, brain, mental,
    total: Math.max(22, Math.min(92, total))
  };
}

/* =========================================================
   Score
   ========================================================= */

async function scoreFromText(userText, acoustic) {
  const cleaned = preprocessText(userText);
  const mod = analyzeModifiers(userText || cleaned);

  let embedScores;
  if (!isEmbedReady || !extractor || !defVectors) {
    embedScores = heuristicTextScores(cleaned);
  } else {
    try {
      const out = await extractor(cleaned || "特になし", { pooling: "mean", normalize: true });
      const v = Array.from(out.data);

      const raw = {
        body: simToCategory(v, defVectors.body),
        brain: simToCategory(v, defVectors.brain),
        mental: simToCategory(v, defVectors.mental),
        healthy: simToCategory(v, defVectors.healthy)
      };

      const toPct = c => Math.max(12, Math.min(93, Math.round(48 + c * 160)));

      let physical = toPct(raw.body - raw.healthy);
      let brain = toPct(raw.brain - raw.healthy);
      let mental = toPct(raw.mental - raw.healthy);

      physical = Math.max(12, Math.min(93, Math.round(physical * mod.scale)));
      brain = Math.max(12, Math.min(93, Math.round(brain * mod.scale)));
      mental = Math.max(12, Math.min(93, Math.round(mental * mod.scale)));

      if (mod.negated) {
        physical = Math.min(physical, 38);
        brain = Math.min(brain, 38);
        mental = Math.min(mental, 38);
      }

      const avg = (physical + brain + mental) / 3;
      embedScores = {
        physical, brain, mental,
        total: Math.max(18, Math.min(95, Math.round(100 - avg * 0.88))),
        raw
      };
    } catch (e) {
      console.warn("[score embedding]", e);
      embedScores = heuristicTextScores(cleaned);
    }
  }

  if (["疲れ", "だるい", "眠い", "しんどい", "重い", "肩", "首"].some(kw => (userText || "").includes(kw))) {
    embedScores.physical = Math.min(93, embedScores.physical + 18);
    embedScores.brain = Math.min(93, embedScores.brain + 14);
    embedScores.mental = Math.min(93, embedScores.mental + 16);
    const avg = (embedScores.physical + embedScores.brain + embedScores.mental) / 3;
    embedScores.total = Math.max(18, Math.min(95, Math.round(100 - avg * 0.88)));
  }

  const ac = acousticFatigueProxy(acoustic || lastAcoustic);
  if (ac != null) {
    const blend = e => Math.round(e * 0.8 + ac * 0.2);
    embedScores.physical = blend(embedScores.physical);
    embedScores.brain = blend(embedScores.brain);
    embedScores.mental = blend(embedScores.mental);
    const avg = (embedScores.physical + embedScores.brain + embedScores.mental) / 3;
    embedScores.total = Math.max(18, Math.min(95, Math.round(100 - avg * 0.88)));
  }

  return embedScores;
}

/* =========================================================
   Backend fatigue
   ========================================================= */

async function scoreFromBackend(blob, text) {
  if (!blob) throw new Error("no audio");
  const form = new FormData();
  const mime = blob.type || "";
  let ext = "webm";

  if (mime.includes("mp4") || mime.includes("m4a")) ext = "m4a";
  else if (mime.includes("wav")) ext = "wav";

  form.append("file", blob, `recording.${ext}`);
  form.append("text", text || "");

  if (window.lastEmbedRaw) {
    const er = window.lastEmbedRaw;
    if (er.body !== undefined) form.append("sim_body", String(er.body));
    if (er.brain !== undefined) form.append("sim_brain", String(er.brain));
    if (er.mental !== undefined) form.append("sim_mental", String(er.mental));
    if (er.healthy !== undefined) form.append("sim_healthy", String(er.healthy));
  }

  const res = await fetch(`${BACKEND_URL}/predict-fatigue`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();
  if (data.final) {
    return {
      physical: Math.round(data.final.physical),
      brain: Math.round(data.final.brain),
      mental: Math.round(data.final.mental),
      total: Math.round(data.final.total),
      raw: data,
      source: "ensemble"
    };
  }

  return {
    physical: Math.round(data.physical),
    brain: Math.round(data.brain),
    mental: Math.round(data.mental),
    total: Math.round(data.total),
    raw: data,
    source: "lightgbm"
  };
}

async function scoreWithFallback(userText, acoustic, blob) {
  try {
    if (isEmbedReady && extractor && defVectors) {
      const out = await extractor(userText || "特になし", { pooling: "mean", normalize: true });
      const v = Array.from(out.data);
      window.lastEmbedRaw = {
        body: simToCategory(v, defVectors.body),
        brain: simToCategory(v, defVectors.brain),
        mental: simToCategory(v, defVectors.mental),
        healthy: simToCategory(v, defVectors.healthy)
      };
    }
  } catch {}

  if (blob) {
    try {
      DOM.statusText.textContent = "分析中...";
      return await scoreFromBackend(blob, userText);
    } catch (e) {
      console.warn("[backend fallback]", e);
    }
  }
  return await scoreFromText(userText, acoustic);
}

/* =========================================================
   Recovery
   ========================================================= */

function pickRecovery(scores) {
  const entries = [
    ["body", scores.physical],
    ["brain", scores.brain],
    ["mental", scores.mental]
  ].sort((a, b) => b[1] - a[1]);

  const list = [];
  const [topKey] = entries[0];
  const [secKey, secVal] = entries[1];

  list.push(...RECOVERY[topKey].slice(0, 2));
  if (secVal >= 55) list.push(RECOVERY[secKey][0]);

  const avg = (scores.physical + scores.brain + scores.mental) / 3;
  list.push(avg >= 60 ? RECOVERY.general[1] : RECOVERY.general[0]);

  const seen = new Set();
  const uniq = [];
  for (const it of list) {
    if (!seen.has(it.title)) {
      seen.add(it.title);
      uniq.push(it);
    }
  }
  return { topKey, suggestions: uniq.slice(0, 4) };
}

function renderRecovery(sugs) {
  if (!DOM.recoveryList) return;
  DOM.recoveryList.innerHTML = sugs.map((s, i) => `
    <div class="bg-white rounded-2xl p-3 shadow-sm border border-slate-100 flex items-center gap-3 slide-up" style="animation-delay:${0.05 * i}s">
      <div class="w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center shrink-0">
        <span class="material-icons-outlined" style="color:${s.color}">${s.icon}</span>
      </div>
      <div class="min-w-0">
        <p class="text-xs font-bold text-slate-700">${s.title}</p>
        <p class="text-[11px] text-slate-400">${s.desc}</p>
      </div>
    </div>
  `).join("");
}

/* =========================================================
   Score UI
   ========================================================= */

function titleFromScores(scores) {
  const entries = [
    ["身体", scores.physical],
    ["脳", scores.brain],
    ["精神", scores.mental]
  ].sort((a, b) => b[1] - a[1]);

  const [name, val] = entries[0];
  if (val >= 72) return `${name}の強い疲れ`;
  if (val >= 55) return `${name}寄りの疲れ`;
  if (scores.total >= 72) return "比較的すっきりした状態";
  return "総合的な疲れ";
}

function applyScoreUI(scores) {
  const totalEl = document.getElementById("scoreTotalVal");
  if (totalEl) totalEl.textContent = scores.total;

  const hintEl = document.getElementById("scoreHint");
  if (hintEl) {
    hintEl.textContent = scores.total >= 70
      ? "比較的コンディションは良好です"
      : scores.total >= 50
      ? "無理をせず、ペースを落として大丈夫です"
      : "休息を優先してあげてください";
  }

  const b = document.getElementById("scoreBrainVal");
  const m = document.getElementById("scoreMentalVal");
  const p = document.getElementById("scorePhysicalVal");

  if (b) b.innerHTML = `${scores.brain}<span class="text-xs font-normal">%</span>`;
  if (m) m.innerHTML = `${scores.mental}<span class="text-xs font-normal">%</span>`;
  if (p) p.innerHTML = `${scores.physical}<span class="text-xs font-normal">%</span>`;

  requestAnimationFrame(() => {
    const bb = document.getElementById("barBrain");
    const mb = document.getElementById("barMental");
    const pb = document.getElementById("barPhysical");
    if (bb) bb.style.width = scores.brain + "%";
    if (mb) mb.style.width = scores.mental + "%";
    if (pb) pb.style.width = scores.physical + "%";
  });
}

/* =========================================================
   Loading UI
   ========================================================= */

function startLoadCopyRotation() {
  let i = 0;
  if (DOM.statusText) DOM.statusText.textContent = LOAD_COPIES[0];
  loadCopyTimer = setInterval(() => {
    i = (i + 1) % LOAD_COPIES.length;
    if (DOM.statusText) DOM.statusText.textContent = LOAD_COPIES[i];
  }, 2200);
}

function stopLoadCopyRotation() {
  if (loadCopyTimer) {
    clearInterval(loadCopyTimer);
    loadCopyTimer = null;
  }
}

function updateProgress(p, label) {
  const c = Math.max(0, Math.min(100, p));
  if (DOM.progressBar) DOM.progressBar.style.width = c + "%";
  if (DOM.progressText) DOM.progressText.textContent = label || `${c}%`;
}

/* =========================================================
   iOS Speech Recognition (Fallback)
   ========================================================= */

function setupIOSRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn("[SpeechRecognition] unavailable");
    return null;
  }
  const rec = new SR();
  rec.lang = "ja-JP";
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 3;

  rec.onstart = () => { iosRecognitionStarted = true; };
  rec.onresult = e => {
    let finalText = "";
    let interimText = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const text = result[0]?.transcript || "";
      if (result.isFinal) finalText += text;
      else interimText += text;
    }
    if (finalText.trim()) iosLastTranscript = (iosLastTranscript + " " + finalText).trim();
    if (interimText.trim() && DOM.statusText) DOM.statusText.textContent = "聞き取っています…";
  };
  rec.onerror = e => { console.warn("[SpeechRecognition]", e.error); };
  rec.onend = () => { iosRecognitionStarted = false; };
  return rec;
}

function stopIOSRecognition() {
  if (!recognition) return;
  try { recognition.stop(); } catch {}
  iosRecognitionStarted = false;
}

/* =========================================================
   Load Moonshine
   ========================================================= */

async function loadModel() {
  try {
    bindDOM();
    startLoadCopyRotation();
    updateProgress(5, "5%");

    if (IS_IOS) {
      recognition = setupIOSRecognition();
    }

    let transformers = null;
    try {
      transformers = await import(TRANSFORMERS_URL);
    } catch (e) {
      console.warn("[Transformers]", e);
    }

    if (!transformers) {
      throw new Error("Transformers.jsを読み込めませんでした");
    }

    const { pipeline, env } = transformers;
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    updateProgress(20, "20%");

    const embedPromise = loadEmbedder().catch(e => {
      console.warn("[Embedding]", e);
    });

    try {
      // Pipeline化による安定化
      transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
        dtype: "q8",
        device: "wasm"
      });
      console.log("[Moonshine] ready");
    } catch (e) {
      console.warn("[Moonshine failed]", e);
      transcriber = null;
    }

    updateProgress(70, "70%");
    await embedPromise;
    updateProgress(100, "100%");
    stopLoadCopyRotation();

    isModelReady = true;

    currentOpening = OPENINGS[Math.floor(Math.random() * OPENINGS.length)];
    if (DOM.aiPromptText) DOM.aiPromptText.innerHTML = currentOpening.replace(/。/g, "。<br>");

    conversationLog = [{ role: "assistant", content: currentOpening }];

    if (DOM.micBtn) {
      DOM.micBtn.disabled = false;
      DOM.micBtn.classList.remove("opacity-50");
    }
    setMicUI(false);

    // 自動再生ブロック回避のため、ここではspeakAIを呼ばずにタップを促す
    if (DOM.statusText) DOM.statusText.textContent = "タップして開始";
    if (DOM.micHint) DOM.micHint.textContent = "ここを押して会話をはじめる";

  } catch (e) {
    console.error("[loadModel]", e);
    stopLoadCopyRotation();
    if (DOM.statusText) DOM.statusText.textContent = "タップで再試行";
    if (DOM.aiPromptText) DOM.aiPromptText.innerHTML = "読み込みに失敗しました。<br>タップで再試行してください。";
    if (DOM.micBtn) {
      DOM.micBtn.disabled = false;
      DOM.micBtn.classList.remove("opacity-50");
      DOM.micBtn.onclick = () => { loadModel(); };
    }
  }
}

/* =========================================================
   Audio decode
   ========================================================= */

async function blobToFloat32(blob) {
  try {
    if (!blob || !blob.size) throw new Error("empty audio");
    const ab = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    let data = buf.getChannelData(0);

    if (buf.sampleRate !== 16000) {
      const offline = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
      const src = offline.createBufferSource();
      src.buffer = buf;
      src.connect(offline.destination);
      src.start();
      const rendered = await offline.startRendering();
      data = rendered.getChannelData(0);
    }

    try { await ctx.close(); } catch {}
    return new Float32Array(data);
  } catch (e) {
    console.warn("[decodeAudio]", e);
    return new Float32Array(0);
  }
}

/* =========================================================
   Moonshine transcription (Pipeline ver)
   ========================================================= */

async function transcribe(float32) {
  const getFallbackTranscript = () => {
    if (IS_IOS && iosLastTranscript) {
      const text = preprocessText(iosLastTranscript);
      if (text && text.length >= 2) return text;
    }
    return "（聞き取れませんでした）";
  };

  if (!float32?.length) {
    return getFallbackTranscript();
  }

  if (transcriber) {
    try {
      const out = await transcriber(float32);
      if (out && out.text) {
        const text = out.text.trim();
        if (text && text.length > 0) {
          return preprocessText(text);
        }
      }
    } catch (e) {
      console.warn("[Moonshine 推論エラー]", e);
    }
  }

  return getFallbackTranscript();
}

/* =========================================================
   LLM
   ========================================================= */

async function callLLM(messages) {
  const urls = ["/api/chat", `${BACKEND_URL}/api/chat`];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.text || data.choices?.[0]?.message?.content || "";
      if (text) return text;
    } catch (e) {
      console.warn("[LLM]", url, e);
    }
  }
  // 固定文マシーン回避のためのフォールバック
  return "ごめんなさい、ちょっと考えがまとまらなくて……。もう一度教えてもらえますか？";
}

/* =========================================================
   OpenSMILE
   ========================================================= */

async function getAcoustic(blob) {
  try {
    if (!blob || !blob.size) return {};
    const fd = new FormData();
    const mime = blob.type || "";
    let ext = "webm";
    if (mime.includes("mp4") || mime.includes("m4a")) ext = "m4a";
    else if (mime.includes("wav")) ext = "wav";

    fd.append("file", blob, `speech.${ext}`);
    const res = await fetch(`${BACKEND_URL}/extract-features`, { method: "POST", body: fd });
    if (!res.ok) return {};
    return await res.json();
  } catch (e) {
    console.warn("[OpenSMILE]", e);
    return {};
  }
}

/* =========================================================
   Diagnosis
   ========================================================= */

function parseDiagnosisJSON(raw, scores) {
  const fallbackTitle = titleFromScores(scores);
  const fallbackDetail = "今日の話をありがとう。無理せず、できる範囲で休んでみてください。";

  if (!raw) return { title: fallbackTitle, detail: fallbackDetail };
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];

  try {
    const obj = JSON.parse(s);
    return {
      title: (obj.title || fallbackTitle).toString().trim(),
      detail: (obj.detail || fallbackDetail).toString().trim()
    };
  } catch {
    return { title: fallbackTitle, detail: fallbackDetail };
  }
}

/* =========================================================
   Mic UI
   ========================================================= */

function setMicUI(rec) {
  if (!DOM.micBtn) return;
  if (rec) {
    DOM.micInnerIcon.textContent = "stop";
    DOM.micInnerIcon.className = "material-icons stop-icon";
    DOM.micHint.textContent = "タップして停止";
    DOM.micBtn.classList.add("mic-pulse");
  } else {
    DOM.micInnerIcon.textContent = "mic";
    DOM.micInnerIcon.className = "material-icons mic-icon";
    DOM.micHint.textContent = "タップして話す";
    DOM.micBtn.classList.remove("mic-pulse");
  }
}

/* =========================================================
   Wave
   ========================================================= */

function updateWaveFromRms(rms) {
  const level = Math.min(1, Math.max(0, (rms - 0.004) / 0.08));
  DOM.waveDots.forEach((dot, i) => {
    const center = (DOM.waveDots.length - 1) / 2;
    const dist = Math.abs(i - center) / center;
    const h = 6 + level * (22 - dist * 10);
    const op = 0.35 + level * 0.65;
    dot.style.transform = `scaleY(${h / 6})`;
    dot.style.opacity = String(op);
  });
}

function stopWaveAnim() {
  if (waveRaf) {
    cancelAnimationFrame(waveRaf);
    waveRaf = null;
  }
  DOM.waveDots.forEach(d => {
    d.style.transform = "scaleY(1)";
    d.style.opacity = "0.45";
  });
}

/* =========================================================
   Recording
   ========================================================= */

async function startRecording() {
  if (!isModelReady || isRecording || isSpeaking) return;
  await unlockAudioContext();

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("getUserMedia unavailable");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const mimeType = getSupportedMimeType();
    audioChunks = [];
    iosLastTranscript = "";

    const options = mimeType ? { mimeType } : {};
    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onerror = e => { console.error("[MediaRecorder]", e); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      stopWaveAnim();

      if (audioContext && audioContext !== playbackAudio) {
        try {
          if (audioContext.state !== "closed") await audioContext.close();
        } catch {}
        audioContext = null;
      }

      stopIOSRecognition();
      await processTurn();
    };

    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      audioContext = new AC();
      if (audioContext.state === "suspended") await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
    }

    mediaRecorder.start(200);
    isRecording = true;
    silenceStart = null;

    DOM.waveContainer.classList.remove("hidden");
    DOM.statusText.textContent = "あなたのお話を聞いています...";
    setMicUI(true);

    if (IS_IOS && recognition) {
      try { recognition.start(); } catch (e) { console.warn("[SR start]", e); }
    }

    loopMonitor();
  } catch (e) {
    console.error("[startRecording]", e);
    isRecording = false;
    DOM.statusText.textContent = "マイクの許可が必要です。設定を確認してください";
    setMicUI(false);
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;
  DOM.waveContainer.classList.add("hidden");
  DOM.statusText.textContent = "認識中...";
  setMicUI(false);
  try { mediaRecorder.stop(); } catch (e) { console.warn("[stopRecording]", e); }
}

/* =========================================================
   Recording monitor
   ========================================================= */

function loopMonitor() {
  if (!isRecording || !analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);

  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / data.length);
  updateWaveFromRms(rms);

  if (!IS_IOS) {
    if (rms < SILENCE_THRESHOLD) {
      if (!silenceStart) silenceStart = Date.now();
      else if (Date.now() - silenceStart > SILENCE_MS) {
        stopRecording();
        return;
      }
    } else {
      silenceStart = null;
    }
  }

  waveRaf = requestAnimationFrame(loopMonitor);
}

/* =========================================================
   After TTS
   ========================================================= */

function afterSpeakThenRecord() {
  setTimeout(() => {
    if (isModelReady && currentTurn < 2 && DOM.viewResultBtn.classList.contains("hidden")) {
      DOM.statusText.textContent = "タップして話す";
      DOM.micHint.textContent = "マイクを押してください";
      DOM.micBtn.disabled = false;
      DOM.micBtn.classList.remove("opacity-50");
      setMicUI(false);
    }
  }, POST_TTS_GAP_MS);
}

/* =========================================================
   Process turn
   ========================================================= */

async function processTurn() {
  try {
    const actualMime = mediaRecorder?.mimeType || getSupportedMimeType() || "audio/webm";
    const blob = new Blob(audioChunks, { type: actualMime });
    if (!blob.size) throw new Error("録音データが空です");

    lastAudioBlob = blob;
    DOM.statusText.textContent = "文字起こし中...";

    const float32 = await blobToFloat32(blob);
    let userText = await transcribe(float32);

    if (IS_IOS && (!userText || userText.length < 2)) {
       userText = "今日は少し疲れました";
    }

    console.log("[認識結果]", userText);
    allUserTexts.push(userText);
    conversationLog.push({ role: "user", content: userText });

    const acousticPromise = getAcoustic(blob);
    currentTurn++;

    /* -----------------------------------------------------
       TURN 1
       ----------------------------------------------------- */
    if (currentTurn === 1) {
      DOM.statusText.textContent = "AIが考えています...";
      updateProgress(35, "35%");
      const messages = [
        { role: "system", content: buildTurnSystem("followup", currentOpening) },
        ...conversationLog
      ];
      const reply = (await callLLM(messages)).trim() || "そうなんですね。もう少し詳しく教えてもらえますか？";

      conversationLog.push({ role: "assistant", content: reply });
      DOM.aiPromptText.innerHTML = reply.replace(/\n/g, "<br>");
      speakAI(reply, afterSpeakThenRecord);
      return;
    }

    /* -----------------------------------------------------
       TURN 2
       ----------------------------------------------------- */
    if (currentTurn === 2) {
      DOM.statusText.textContent = "AIが考えています...";
      updateProgress(65, "65%");
      const closeMessages = [
        { role: "system", content: buildTurnSystem("close", currentOpening) },
        ...conversationLog
      ];
      const summary = (await callLLM(closeMessages)).trim() || "話してくれてありがとう。";

      conversationLog.push({ role: "assistant", content: summary });
      DOM.aiPromptText.innerHTML = summary.replace(/\n/g, "<br>");
      lastAcoustic = await acousticPromise;

      DOM.statusText.textContent = "内容を分析中...";
      updateProgress(85, "85%");

      const joined = allUserTexts.join("。");
      const scores = await scoreWithFallback(joined, lastAcoustic, lastAudioBlob);
      const recovery = pickRecovery(scores);

      const diagnosisMessages = [
        {
          role: "system",
          content: `
あなたは優しいアドバイザーです。
発言と疲労スコアに一貫した短いアドバイスを出してください。
出力は必ず次のJSONのみ。
前置き・後書き・コードフェンスは禁止。
{"title":"〇〇な疲れ","detail":"ユーザーに語りかける2〜3文。〜かもしれません／〜してみてください を使う"}
titleはスコアの一番高い軸と矛盾しないこと。
`
        },
        {
          role: "user",
          content: `【疲労スコア】\n身体:${scores.physical}\n脳:${scores.brain}\n精神:${scores.mental}\n総合ウェルビーイング:${scores.total}\n\n【会話】\n${conversationLog.map(m => (m.role === "user" ? "ユーザー" : "AI") + "：" + m.content).join("\n")}`
        }
      ];

      const diagnosisRaw = await callLLM(diagnosisMessages);
      const { title, detail } = parseDiagnosisJSON(diagnosisRaw, scores);

      const titleEl = document.getElementById("fatigueTitle");
      const detailEl = document.getElementById("fatigueDetailText");
      if (titleEl) titleEl.textContent = title;
      if (detailEl) detailEl.textContent = detail;

      applyScoreUI(scores);
      renderRecovery(recovery.suggestions);

      const saveData = {
        ...scores,
        fatigueTitle: title,
        fatigueDetail: detail,
        conversation: conversationLog,
        final: scores
      };

      if (window.ResteeApp && window.ResteeApp.saveScanResult) {
        window.ResteeApp.saveScanResult(saveData);
      } else {
        localStorage.setItem(
          "restee_last_scan",
          JSON.stringify({
            ...saveData,
            timestamp: new Date().toISOString(),
            dateStr: new Date().toLocaleString("ja-JP")
          })
        );
      }

      updateProgress(100, "100%");
      DOM.statusText.textContent = "スキャン完了";
      DOM.micBtn.classList.add("hidden");
      DOM.viewResultBtn.classList.remove("hidden");

      speakAI(`${summary}。結果をご覧ください。`);
    }
  } catch (e) {
    console.error("[processTurn]", e);
    DOM.statusText.textContent = "エラーが発生しました。もう一度どうぞ";
    setMicUI(false);
    isRecording = false;
  }
}

/* =========================================================
   EDGE TTS
   ========================================================= */

async function speakWithBackend(text) {
  if (!text?.trim()) return;
  await unlockAudioContext();
  const url = `${BACKEND_URL}/tts?text=${encodeURIComponent(text)}&voice=ja-JP-NanamiNeural`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 18000);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store"
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`TTS ${res.status}: ${msg}`);
    }
    const blob = await res.blob();
    if (!blob || !blob.size) throw new Error("TTS audio is empty");

    const audio = createPlaybackAudio();
    try { audio.pause(); } catch {}

    if (playbackObjectURL) {
      try { URL.revokeObjectURL(playbackObjectURL); } catch {}
      playbackObjectURL = null;
    }

    playbackObjectURL = URL.createObjectURL(blob);
    audio.src = playbackObjectURL;
    audio.volume = 1;
    audio.currentTime = 0;
    audio.load();

    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { audio.onended = null; audio.onerror = null; };
      const done = () => {
        if (settled) return;
        settled = true; cleanup();
        if (playbackObjectURL) {
          try { URL.revokeObjectURL(playbackObjectURL); } catch {}
          playbackObjectURL = null;
        }
        resolve();
      };
      const fail = e => {
        if (settled) return;
        settled = true; cleanup();
        reject(e);
      };
      audio.onended = done;
      audio.onerror = fail;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch(fail);
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/* =========================================================
   Local MMS TTS fallback
   ========================================================= */

async function speakWithLocalMMS(text) {
  if (!isLocalTTSReady) await loadLocalTTS();
  if (!localTTSPipeline) throw new Error("local TTS not ready");

  const chunks = text.match(/.{1,120}(。|、|．|！|？|$)/g) || [text];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const out = await localTTSPipeline(chunk);
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("AudioContext unavailable");

    const ctx = new AC({ sampleRate: out.sampling_rate });
    if (ctx.state === "suspended") await ctx.resume();

    const buffer = ctx.createBuffer(1, out.audio.length, out.sampling_rate);
    buffer.getChannelData(0).set(out.audio);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    await new Promise(resolve => {
      source.onended = () => {
        try { ctx.close(); } catch {}
        resolve();
      };
      source.start();
    });
  }
}

/* =========================================================
   AI Speech
   ========================================================= */

async function speakAI(text, onEnd, retries = 1) {
  if (!text || !String(text).trim()) {
    if (onEnd) onEnd();
    return;
  }

  isSpeaking = true;
  const prevStatus = DOM.statusText?.textContent || "";
  if (DOM.statusText) DOM.statusText.textContent = "AIが話しています...";
  if (DOM.micBtn) {
    DOM.micBtn.disabled = true;
    DOM.micBtn.classList.add("opacity-50");
  }

  try {
    try {
      await speakWithBackend(text);
      finishSpeech();
      return;
    } catch (edgeError) {
      console.warn("[Edge TTS failed]", edgeError);
    }

    if (DOM.statusText) DOM.statusText.textContent = "音声を準備中...";
    await speakWithLocalMMS(text);
    finishSpeech();
  } catch (e) {
    console.warn("[TTS all failed]", e);
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 700));
      return speakAI(text, onEnd, retries - 1);
    }

    isSpeaking = false;
    if (DOM.statusText) DOM.statusText.textContent = "音声を再生できませんでした。タップして続行";
    if (DOM.micBtn && isModelReady) {
      DOM.micBtn.disabled = false;
      DOM.micBtn.classList.remove("opacity-50");
    }
    if (onEnd) setTimeout(onEnd, 300);
  }

  function finishSpeech() {
    if (DOM.statusText) DOM.statusText.textContent = prevStatus;
    isSpeaking = false;
    if (isModelReady && DOM.viewResultBtn && DOM.viewResultBtn.classList.contains("hidden")) {
      if (DOM.micBtn) {
        DOM.micBtn.disabled = false;
        DOM.micBtn.classList.remove("opacity-50");
      }
    }
    if (onEnd) onEnd();
  }
}

/* =========================================================
   Init
   ========================================================= */

function initScan() {
  bindDOM();
  if (!DOM.micBtn) {
    console.error("micBtn not found");
    return;
  }

  installAudioUnlock();

  // イベントリスナー内で isConversationStarted を判定
  DOM.micBtn.addEventListener("click", async () => {
    await unlockAudioContext();
    if (!isModelReady || isSpeaking) return;

    if (!isConversationStarted) {
      isConversationStarted = true;
      
      DOM.micBtn.disabled = true;
      DOM.micBtn.classList.add("opacity-50");
      if (DOM.statusText) DOM.statusText.textContent = "準備中...";
      if (DOM.micHint) DOM.micHint.textContent = "AIが話します...";

      speakAI(currentOpening, () => {
        if (DOM.statusText) DOM.statusText.textContent = "タップして話す";
        if (DOM.micHint) DOM.micHint.textContent = "マイクを押して話し始めてください";
        if (DOM.micBtn) {
          DOM.micBtn.disabled = false;
          DOM.micBtn.classList.remove("opacity-50");
        }
      });
      return; // 初回は録音を開始せず会話スタートのみ
    }

    if (isRecording) stopRecording();
    else await startRecording();
  });

  if (DOM.viewResultBtn) {
    DOM.viewResultBtn.addEventListener("click", () => {
      DOM.scanScreen.classList.add("hidden");
      DOM.resultScreen.classList.remove("hidden");
      DOM.resultScreen.classList.add("entering");
    });
  }

  loadModel();
}

document.addEventListener("DOMContentLoaded", initScan);
