/**
 * Restee v6 - Moonshine日本語版 確実読み込み版
 */
const BACKEND_URL = "https://voicechat-gz4j.onrender.com";
const MODEL_ID = "wmoto-ai/moonshine-tiny-ja-ONNX";
const MODEL_ID_FALLBACK = "Xenova/moonshine-tiny-ONNX";
const EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const TRANSFORMERS_CDNS = [
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0",
  "https://unpkg.com/@huggingface/transformers@3.5.0",
  "https://esm.sh/@huggingface/transformers@3.5.0",
];
const ORT_WASM_CDNS = [
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/",
  "https://unpkg.com/onnxruntime-web@1.19.2/dist/",
];
let transformersAPI = null;
let model = null,
  processor = null,
  tokenizer = null,
  extractor = null,
  defVectors = null;
let isModelReady = false,
  isEmbedReady = false,
  isRecording = false,
  isSpeaking = false;
let mediaRecorder = null,
  audioChunks = [],
  audioContext = null,
  analyser = null,
  silenceStart = null,
  waveRaf = null;
let currentTurn = 0,
  allUserTexts = [],
  lastAudioBlob = null,
  conversationLog = [],
  currentOpening = "",
  loadCopyTimer = null;
let audioUnlocked = false,
  openingSpoken = false,
  firstInteractionDone = false,
  fakeWaveTimer = null;
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
  DOM.recognizedBox = document.getElementById("recognizedBox");
  DOM.recognizedText = document.getElementById("recognizedText");
  DOM.textFallback = document.getElementById("textFallback");
  DOM.textInput = document.getElementById("textInput");
  DOM.textSendBtn = document.getElementById("textSendBtn");
}
function getSupportedMimeType() {
  const iosTypes = ["audio/mp4", "audio/aac", "audio/wav"];
  const otherTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const list = IS_IOS
    ? iosTypes.concat(otherTypes)
    : otherTypes.concat(iosTypes);
  for (const t of list) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported &&
      MediaRecorder.isTypeSupported(t)
    )
      return t;
  }
  return "";
}
function unlockAudioContext() {
  if (audioUnlocked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    if (ctx.state === "suspended") ctx.resume();
    audioUnlocked = true;
    setTimeout(() => {
      try {
        ctx.close();
      } catch {}
    }, 800);
  } catch (e) {}
}
const OPENINGS = [
  "こんにちは。今日はどんな一日でしたか？楽しかったことや、疲れたことなど教えてください。",
  "お疲れさまです。今の調子はいかがですか？元気、眠い、少しだるいなど、近いものを教えてください。",
  "今日は体の調子、いかがでしたか？重い、眠い、元気など、感じたことを教えてください。",
];
const SYSTEM_BASE =
  "あなたはユーザーの疲れに寄り添う聞き手です。60文字以内、質問1つ。";
function buildTurnSystem(phase, opening) {
  if (phase === "followup")
    return `${SYSTEM_BASE}\n今は2回目。最初の問い:「${opening}」違う角度で1つ深掘り。`;
  return `${SYSTEM_BASE}\n最後。「話してくれてありがとう」。`;
}
const FATIGUE_DEFS = {
  body: ["体が重い、だるい"],
  brain: ["頭がぼんやり"],
  mental: ["やる気が出ない"],
  healthy: ["調子がよい"],
};
const RECOVERY = {
  body: [
    {
      icon: "self_improvement",
      color: "#ea580c",
      bg: "bg-orange-100",
      title: "軽いストレッチ",
      desc: "肩首を回す",
    },
  ],
  brain: [
    {
      icon: "visibility",
      color: "#0891b2",
      bg: "bg-cyan-100",
      title: "画面から離れる",
      desc: "遠くを見る",
    },
  ],
  mental: [
    {
      icon: "air",
      color: "#2563eb",
      bg: "bg-blue-100",
      title: "深呼吸",
      desc: "4秒吸って6秒吐く",
    },
  ],
  general: [
    {
      icon: "local_drink",
      color: "#0d9488",
      bg: "bg-teal-100",
      title: "水分補給",
      desc: "水を飲む",
    },
  ],
};
function heuristicScores(t) {
  let p = 42,
    b = 42,
    m = 42;
  if (/だる|重い|眠い/.test(t)) p += 22;
  if (/集中|ぼんやり|頭/.test(t)) b += 22;
  if (/イライラ|不安|つらい/.test(t)) m += 22;
  const total = Math.round(100 - ((p + b + m) / 3) * 0.88);
  return {
    physical: p,
    brain: b,
    mental: m,
    total: Math.max(22, Math.min(92, total)),
  };
}
function pickRecovery(scores) {
  const e = [
    ["body", scores.physical],
    ["brain", scores.brain],
    ["mental", scores.mental],
  ].sort((a, b) => b[1] - a[1]);
  return { suggestions: [RECOVERY[e[0][0]][0], RECOVERY.general[0]] };
}
function renderRecovery(sugs) {
  DOM.recoveryList.innerHTML = sugs
    .map(
      (s) =>
        `<div class="bg-white rounded-2xl p-3 flex gap-3"><div class="w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center"><span class="material-icons-outlined" style="color:${s.color}">${s.icon}</span></div><div><p class="text-xs font-bold">${s.title}</p><p class="text-[11px] text-slate-400">${s.desc}</p></div></div>`,
    )
    .join("");
}
function titleFromScores(s) {
  const e = [
    ["身体", s.physical],
    ["脳", s.brain],
    ["精神", s.mental],
  ].sort((a, b) => b[1] - a[1]);
  return e[0][1] >= 55 ? `${e[0][0]}寄りの疲れ` : "総合的な疲れ";
}
function applyScoreUI(s) {
  document.getElementById("scoreTotalVal").textContent = s.total;
  document.getElementById("scoreBrainVal").textContent = s.brain + "%";
  document.getElementById("scoreMentalVal").textContent = s.mental + "%";
  document.getElementById("scorePhysicalVal").textContent = s.physical + "%";
  document.getElementById("barBrain").style.width = s.brain + "%";
  document.getElementById("barMental").style.width = s.mental + "%";
  document.getElementById("barPhysical").style.width = s.physical + "%";
}
function updateProgress(p, l) {
  if (DOM.progressBar) DOM.progressBar.style.width = p + "%";
  if (DOM.progressText) DOM.progressText.textContent = l || p + "%";
}
async function importTransformersWithFallback() {
  for (let i = 0; i < TRANSFORMERS_CDNS.length; i++) {
    const url = TRANSFORMERS_CDNS[i];
    try {
      console.log(`[Transformers] trying ${url}`);
      if (DOM.statusText)
        DOM.statusText.textContent = `ライブラリ読込中... (${i + 1}/${TRANSFORMERS_CDNS.length})`;
      const mod = await import(url);
      console.log(`[Transformers] loaded from ${url}`);
      return mod;
    } catch (e) {
      console.warn(`[Transformers] failed ${url}:`, e.message);
    }
  }
  throw new Error("transformers.js all CDN failed");
}
async function loadMoonshineJapanese() {
  const api = transformersAPI;
  if (!api) throw new Error("transformersAPI not loaded");
  const {
    env,
    MoonshineForConditionalGeneration,
    AutoProcessor,
    AutoTokenizer,
  } = api;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  try {
    env.backends.onnx.wasm.wasmPaths = ORT_WASM_CDNS[0];
  } catch {}
  const attempts = IS_IOS
    ? [
        { id: MODEL_ID, dtype: "q8", device: "wasm", label: "iOS用 軽量 q8" },
        { id: MODEL_ID, dtype: "q4", device: "wasm", label: "iOS用 超軽量 q4" },
        { id: MODEL_ID, dtype: "fp32", device: "wasm", label: "iOS用 fp32" },
      ]
    : [
        { id: MODEL_ID, dtype: "q8", device: "wasm", label: "日本語 q8" },
        { id: MODEL_ID, dtype: "fp32", device: "wasm", label: "日本語 fp32" },
        {
          id: MODEL_ID_FALLBACK,
          dtype: "q8",
          device: "wasm",
          label: "Fallback 英語 q8",
        },
      ];
  for (const at of attempts) {
    try {
      console.log(`[Moonshine] try ${at.label} id=${at.id} dtype=${at.dtype}`);
      if (DOM.statusText)
        DOM.statusText.textContent = `Moonshine日本語モデル読込中... ${at.label}`;
      updateProgress(20 + Math.random() * 10, `${at.label}取得中...`);
      const [proc, tok] = await Promise.all([
        AutoProcessor.from_pretrained(at.id),
        AutoTokenizer.from_pretrained(at.id),
      ]);
      const m = await MoonshineForConditionalGeneration.from_pretrained(at.id, {
        dtype: at.dtype,
        device: at.device,
      });
      console.log(`[Moonshine] SUCCESS ${at.label}`);
      return { model: m, processor: proc, tokenizer: tok, attempt: at };
    } catch (e) {
      console.warn(`[Moonshine] FAILED ${at.label}:`, e);
      continue;
    }
  }
  throw new Error("Moonshine all attempts failed");
}
async function loadEmbedder() {
  if (!transformersAPI) return;
  try {
    const { pipeline } = transformersAPI;
    const pipe = await pipeline(
      "feature-extraction",
      "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
      { dtype: "q8", device: "wasm" },
    );
    defVectors = {};
    for (const [k, texts] of Object.entries(FATIGUE_DEFS)) {
      const vecs = [];
      for (const t of texts.slice(0, 2)) {
        const out = await pipe(t, { pooling: "mean", normalize: true });
        vecs.push(Array.from(out.data));
      }
      defVectors[k] = vecs;
    }
    extractor = pipe;
    isEmbedReady = true;
  } catch (e) {
    isEmbedReady = false;
  }
}
function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
function simToCat(v, p) {
  if (!p || !p.length) return 0.5;
  return Math.max(...p.map((x) => cosine(v, x)));
}
async function scoreFromText(t) {
  if (!isEmbedReady || !extractor) return heuristicScores(t);
  try {
    const out = await extractor(t || "特になし", {
      pooling: "mean",
      normalize: true,
    });
    const v = Array.from(out.data);
    const toPct = (c) => Math.max(12, Math.min(93, Math.round(48 + c * 160)));
    let p = toPct(
      simToCat(v, defVectors.body) - simToCat(v, defVectors.healthy),
    );
    let b = toPct(
      simToCat(v, defVectors.brain) - simToCat(v, defVectors.healthy),
    );
    let m = toPct(
      simToCat(v, defVectors.mental) - simToCat(v, defVectors.healthy),
    );
    const total = Math.max(
      18,
      Math.min(95, Math.round(100 - ((p + b + m) / 3) * 0.88)),
    );
    return { physical: p, brain: b, mental: m, total };
  } catch {
    return heuristicScores(t);
  }
}
async function scoreFromBackend(blob, text) {
  if (!blob) return null;
  const form = new FormData();
  form.append("file", blob, `recording.${IS_IOS ? "m4a" : "webm"}`);
  form.append("text", text || "");
  try {
    const res = await fetch(`${BACKEND_URL}/predict-fatigue`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error("fail");
    const data = await res.json();
    if (data.final)
      return {
        physical: Math.round(data.final.physical),
        brain: Math.round(data.final.brain),
        mental: Math.round(data.final.mental),
        total: Math.round(data.final.total),
        raw: data,
      };
    return {
      physical: Math.round(data.physical),
      brain: Math.round(data.brain),
      mental: Math.round(data.mental),
      total: Math.round(data.total),
    };
  } catch (e) {
    return null;
  }
}
async function scoreWithFallback(text, blob) {
  if (blob) {
    const s = await scoreFromBackend(blob, text);
    if (s) return s;
  }
  return await scoreFromText(text);
}
async function blobToFloat32(blob) {
  try {
    const ab = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });
    const buf = await ctx.decodeAudioData(ab);
    let data = buf.getChannelData(0);
    if (buf.sampleRate !== 16000) {
      const offline = new OfflineAudioContext(
        1,
        Math.ceil(buf.duration * 16000),
        16000,
      );
      const tmpBuf = offline.createBuffer(1, buf.length, buf.sampleRate);
      tmpBuf.getChannelData(0).set(buf.getChannelData(0));
      const src = offline.createBufferSource();
      src.buffer = tmpBuf;
      src.connect(offline.destination);
      src.start();
      const rendered = await offline.startRendering();
      data = rendered.getChannelData(0);
    }
    return data;
  } catch (e) {
    console.error("blobToFloat32 failed", e);
    return new Float32Array(0);
  }
}
async function transcribeWithMoonshine(blob) {
  if (!model || !processor || !tokenizer) {
    console.warn("Moonshine not ready");
    return "";
  }
  try {
    const f32 = await blobToFloat32(blob);
    if (f32.length === 0) return "";
    console.log("[Moonshine] transcribing", f32.length);
    if (DOM.statusText)
      DOM.statusText.textContent = "Moonshine日本語で文字起こし中...";
    const inputs = await processor(f32);
    const outputs = await model.generate({ ...inputs, max_new_tokens: 128 });
    const text = tokenizer
      .decode(outputs[0], { skip_special_tokens: true })
      .trim();
    console.log("[Moonshine] result:", text);
    return text;
  } catch (e) {
    console.error("[Moonshine] error", e);
    return "";
  }
}
async function transcribeWithBackendFallback(blob) {
  const ext = IS_IOS ? "m4a" : "webm";
  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("language", "ja");
  try {
    const res = await fetch(`${BACKEND_URL}/transcribe`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) return "";
    const data = await res.json();
    return (data.text || "").trim();
  } catch {
    return "";
  }
}
function startFakeWave() {
  stopFakeWave();
  let t = 0;
  fakeWaveTimer = setInterval(() => {
    t++;
    DOM.waveDots.forEach((d, i) => {
      const v = Math.sin(t * 0.3 + i) * 0.5 + 0.5;
      d.style.transform = `scaleY(${1 + v * 1.5})`;
    });
  }, 80);
}
function stopFakeWave() {
  if (fakeWaveTimer) {
    clearInterval(fakeWaveTimer);
    fakeWaveTimer = null;
  }
}
function updateWaveFromRms(rms) {
  const level = Math.min(1, Math.max(0, (rms - 0.004) / 0.08));
  DOM.waveDots.forEach((dot) => {
    dot.style.transform = `scaleY(${6 + (level * 22) / 6})`;
  });
}
function setMicUI(rec) {
  if (!DOM.micBtn) return;
  if (rec) {
    DOM.micInnerIcon.textContent = "stop";
    DOM.micHint.textContent = "タップして停止";
    DOM.micBtn.classList.add("mic-pulse");
  } else {
    DOM.micInnerIcon.textContent = "mic";
    DOM.micHint.textContent = firstInteractionDone
      ? "タップして話す"
      : "タップして音声を開始";
    DOM.micBtn.classList.remove("mic-pulse");
  }
}
function showTextFallback(msg) {
  DOM.textFallback.classList.remove("hidden");
  if (msg) DOM.textFallback.querySelector("p").textContent = msg;
}
function startWaveLoop() {
  stopWaveLoop();
  if (IS_IOS) {
    startFakeWave();
  } else {
    const loop = () => {
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
      if (rms < 0.011) {
        if (!silenceStart) silenceStart = Date.now();
        else if (Date.now() - silenceStart > 2200) {
          stopRecording();
          return;
        }
      } else {
        silenceStart = null;
      }
      waveRaf = requestAnimationFrame(loop);
    };
    waveRaf = requestAnimationFrame(loop);
  }
}
function stopWaveLoop() {
  if (waveRaf) {
    cancelAnimationFrame(waveRaf);
    waveRaf = null;
  }
  stopFakeWave();
}
function stopWave() {
  stopWaveLoop();
  if (audioContext) {
    try {
      audioContext.close();
    } catch {}
    audioContext = null;
  }
  DOM.waveDots.forEach((d) => {
    d.style.transform = "scaleY(1)";
  });
}
function getSupportedMimeType() {
  const iosTypes = ["audio/mp4", "audio/aac", "audio/wav"];
  const otherTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const list = IS_IOS
    ? iosTypes.concat(otherTypes)
    : otherTypes.concat(iosTypes);
  for (const t of list) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported &&
      MediaRecorder.isTypeSupported(t)
    )
      return t;
  }
  return "";
}
async function loadModel() {
  bindDOM();
  if (DOM.textSendBtn) {
    DOM.textSendBtn.addEventListener("click", async () => {
      const txt = DOM.textInput.value.trim();
      if (!txt) return;
      DOM.textFallback.classList.add("hidden");
      DOM.recognizedBox.classList.remove("hidden");
      DOM.recognizedText.textContent = txt;
      await processCommon(txt, lastAudioBlob);
    });
  }
  updateProgress(5, "ライブラリ読込中...");
  try {
    transformersAPI = await importTransformersWithFallback();
    updateProgress(30, "Moonshine日本語モデル取得中...");
    try {
      const result = await loadMoonshineJapanese();
      model = result.model;
      processor = result.processor;
      tokenizer = result.tokenizer;
      DOM.statusText.textContent = `Moonshine ${result.attempt.label} 準備完了`;
    } catch (e) {
      console.error("Moonshine all failed", e);
      DOM.statusText.textContent = "Moonshine読込失敗、Whisperに切替";
      model = null;
    }
    updateProgress(85, "感情解析モデル読込中...");
    await loadEmbedder().catch(() => {});
    updateProgress(100, "100%");
    isModelReady = true;
    DOM.statusText.textContent = model
      ? "Moonshine日本語 準備完了！"
      : "準備完了（Whisperフォールバック）";
    currentOpening = OPENINGS[Math.floor(Math.random() * OPENINGS.length)];
    DOM.aiPromptText.innerHTML = currentOpening;
    conversationLog = [{ role: "assistant", content: currentOpening }];
    DOM.micBtn.disabled = false;
    DOM.micBtn.classList.remove("opacity-50");
    updateProgress(5, "5%");
    if (IS_IOS) {
      DOM.statusText.textContent = model
        ? "タップしてMoonshine日本語で会話開始"
        : "タップして会話を開始";
      DOM.micHint.textContent = "タップして音声を開始";
    } else {
      speakAI(currentOpening, () => {
        openingSpoken = true;
        firstInteractionDone = true;
        DOM.statusText.textContent = "タップして話す（Moonshine日本語）";
      });
    }
  } catch (e) {
    console.error("loadModel fatal", e);
    DOM.statusText.textContent = "読込失敗、タップで再試行";
    DOM.micBtn.disabled = false;
    DOM.micBtn.onclick = () => location.reload();
  }
}
async function startRecording() {
  unlockAudioContext();
  if (IS_IOS && !firstInteractionDone) {
    firstInteractionDone = true;
    if (!openingSpoken) {
      openingSpoken = true;
      speakAI(currentOpening, () => {
        DOM.statusText.textContent = "タップして話す（Moonshine日本語）";
        DOM.micHint.textContent = "マイクを押して話してください";
        setMicUI(false);
      });
      return;
    }
  }
  try {
    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      showTextFallback("録音非対応");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      stopWave();
      const blob = new Blob(audioChunks, { type: mimeType });
      lastAudioBlob = blob;
      await processAfterRecord(blob);
    };
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
    } catch {
      analyser = null;
    }
    mediaRecorder.start(200);
    isRecording = true;
    silenceStart = null;
    DOM.waveContainer.classList.remove("hidden");
    DOM.recognizedBox.classList.add("hidden");
    DOM.textFallback.classList.add("hidden");
    DOM.statusText.textContent = "聞いています... (Moonshine日本語)";
    setMicUI(true);
    startWaveLoop();
    if (IS_IOS)
      setTimeout(() => {
        if (isRecording) stopRecording();
      }, 8000);
  } catch (e) {
    showTextFallback("マイク許可が必要です");
  }
}
function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;
  DOM.waveContainer.classList.add("hidden");
  DOM.statusText.textContent = "Moonshine日本語で認識中...";
  setMicUI(false);
  try {
    mediaRecorder.stop();
  } catch {}
}
async function processAfterRecord(blob) {
  let userText = await transcribeWithMoonshine(blob);
  if (!userText) {
    console.log("Moonshine empty, try backend Whisper fallback");
    userText = await transcribeWithBackendFallback(blob);
  }
  if (!userText) {
    showTextFallback("聞き取れませんでした。テキストで入力してください");
    DOM.statusText.textContent = "タップして話す";
    return;
  }
  if (DOM.recognizedText) {
    DOM.recognizedText.textContent = userText;
    DOM.recognizedBox.classList.remove("hidden");
  }
  await processCommon(userText, blob);
}
async function processCommon(userText, audioBlob) {
  if (!userText) return;
  allUserTexts.push(userText);
  conversationLog.push({ role: "user", content: userText });
  currentTurn++;
  if (currentTurn === 1) {
    DOM.statusText.textContent = "AIが考えています...";
    updateProgress(35, "35%");
    const reply = await callLLM([
      { role: "system", content: buildTurnSystem("followup", currentOpening) },
      ...conversationLog,
    ]);
    conversationLog.push({ role: "assistant", content: reply });
    DOM.aiPromptText.innerHTML = reply.replace(/\n/g, "<br>");
    speakAI(reply, () => {
      DOM.statusText.textContent = "タップして話す";
      DOM.micBtn.disabled = false;
      setMicUI(false);
    });
  } else if (currentTurn === 2) {
    DOM.statusText.textContent = "AIが考えています...";
    updateProgress(65, "65%");
    const summary = await callLLM([
      { role: "system", content: buildTurnSystem("close", currentOpening) },
      ...conversationLog,
    ]);
    conversationLog.push({ role: "assistant", content: summary });
    DOM.aiPromptText.innerHTML = summary.replace(/\n/g, "<br>");
    DOM.statusText.textContent = "声と内容を分析中...";
    updateProgress(85, "85%");
    const joined = allUserTexts.join("。");
    const scores = await scoreWithFallback(joined, audioBlob);
    const recovery = pickRecovery(scores);
    const raw = await callLLM([
      {
        role: "system",
        content: '{"title":"〇〇な疲れ","detail":"2文アドバイス"}のJSONのみ',
      },
      {
        role: "user",
        content: `スコア 身体:${scores.physical} 脳:${scores.brain} 精神:${scores.mental} 会話:${joined}`,
      },
    ]);
    const { title, detail } = parseDiagnosisJSON(raw, scores);
    document.getElementById("fatigueTitle").textContent = title;
    document.getElementById("fatigueDetailText").textContent = detail;
    applyScoreUI(scores);
    renderRecovery(recovery.suggestions);
    const saveData = {
      ...scores,
      fatigueTitle: title,
      fatigueDetail: detail,
      conversation: conversationLog,
    };
    localStorage.setItem(
      "restee_last_scan",
      JSON.stringify({ ...saveData, timestamp: new Date().toISOString() }),
    );
    if (window.ResteeApp) window.ResteeApp.saveScanResult(saveData);
    updateProgress(100, "100%");
    DOM.statusText.textContent = "スキャン完了";
    DOM.micBtn.classList.add("hidden");
    DOM.viewResultBtn.classList.remove("hidden");
    speakAI(summary + "。結果をご覧ください。");
  }
}
async function callLLM(messages) {
  const endpoints = [
    "/api/chat",
    `${BACKEND_URL}/api/chat`,
    `${BACKEND_URL}/chat`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.text) return data.text.trim();
    } catch {}
  }
  const last = messages.filter((m) => m.role === "user").pop()?.content || "";
  return /疲|だる|眠/.test(last)
    ? "そっか、疲れてるんだね。どんな時に一番そう感じる？"
    : "そうなんだね。もう少し詳しく教えてくれる？";
}
function parseDiagnosisJSON(raw, scores) {
  const fbT = titleFromScores(scores),
    fbD = "少し疲れが溜まっているようです。無理せず休んでみてください。";
  if (!raw) return { title: fbT, detail: fbD };
  let s = String(raw)
    .trim()
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      return { title: o.title || fbT, detail: o.detail || fbD };
    } catch {}
  }
  if (s.length > 10 && !s.startsWith("{"))
    return { title: fbT, detail: s.slice(0, 200) };
  return { title: fbT, detail: fbD };
}
async function speakWithBackend(text) {
  const url = `${BACKEND_URL}/tts?text=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("tts");
  const blob = await res.blob();
  const au = URL.createObjectURL(blob);
  const a = new Audio(au);
  a.playsInline = true;
  return new Promise((resol, rej) => {
    a.onended = () => {
      URL.revokeObjectURL(au);
      resol();
    };
    a.onerror = rej;
    a.play().catch(rej);
  });
}
async function speakAI(text, onEnd) {
  if (!text) {
    if (onEnd) onEnd();
    return;
  }
  isSpeaking = true;
  const prev = DOM.statusText.textContent;
  DOM.statusText.textContent = "AIが話しています...";
  DOM.micBtn.disabled = true;
  try {
    await speakWithBackend(text);
  } catch {}
  isSpeaking = false;
  DOM.statusText.textContent = prev;
  DOM.micBtn.disabled = false;
  if (onEnd) onEnd();
}
function initScan() {
  bindDOM();
  if (!DOM.micBtn) return;
  DOM.micBtn.addEventListener("touchstart", unlockAudioContext, { once: true });
  DOM.micBtn.addEventListener("click", () => {
    unlockAudioContext();
    if (!isModelReady || isSpeaking) return;
    if (isRecording) stopRecording();
    else startRecording();
  });
  if (DOM.viewResultBtn)
    DOM.viewResultBtn.addEventListener("click", () => {
      DOM.scanScreen.classList.add("hidden");
      DOM.resultScreen.classList.remove("hidden");
    });
  loadModel();
}
document.addEventListener("DOMContentLoaded", initScan);
