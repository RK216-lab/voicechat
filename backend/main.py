import os
import tempfile
import json
import re
import threading
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
import opensmile
import edge_tts
import lightgbm as lgb
from typing import Optional, Dict
import httpx
from io import BytesIO

app = FastAPI(title="Fatigue Ensemble: Voice + Embedding")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

smile_lock = threading.Lock()
smile = opensmile.Smile(
    feature_set=opensmile.FeatureSet.eGeMAPSv02,
    feature_level=opensmile.FeatureLevel.Functionals,
)

SCALER_PATHS = ["./scaler_91.json", "../scaler_91.json", "./models/scaler_91.json", "../models/scaler_91.json"]
scaler_means = None
scaler_stds = None
feature_order_91 = None
smile_order = None
for p in SCALER_PATHS:
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
                scaler_means = np.array(data["means"], dtype=np.float32)
                scaler_stds = np.array(data["stds"], dtype=np.float32)
                feature_order_91 = data["feature_order"]
                smile_order = data.get("smile_order", feature_order_91[:88])
                break
        except Exception as e:
            print(f"[WARN] Scaler load failed {p}: {e}")

if scaler_means is None:
    scaler_means = np.zeros(91, dtype=np.float32)
    scaler_stds = np.ones(91, dtype=np.float32)
    smile_order = [
        "smile_F0semitoneFrom27.5Hz_sma3nz_amean","smile_F0semitoneFrom27.5Hz_sma3nz_stddevNorm","smile_F0semitoneFrom27.5Hz_sma3nz_percentile20.0","smile_F0semitoneFrom27.5Hz_sma3nz_percentile50.0","smile_F0semitoneFrom27.5Hz_sma3nz_percentile80.0","smile_F0semitoneFrom27.5Hz_sma3nz_pctlrange0-2","smile_F0semitoneFrom27.5Hz_sma3nz_meanRisingSlope","smile_F0semitoneFrom27.5Hz_sma3nz_stddevRisingSlope","smile_F0semitoneFrom27.5Hz_sma3nz_meanFallingSlope","smile_F0semitoneFrom27.5Hz_sma3nz_stddevFallingSlope","smile_loudness_sma3_amean","smile_loudness_sma3_stddevNorm","smile_loudness_sma3_percentile20.0","smile_loudness_sma3_percentile50.0","smile_loudness_sma3_percentile80.0","smile_loudness_sma3_pctlrange0-2","smile_loudness_sma3_meanRisingSlope","smile_loudness_sma3_stddevRisingSlope","smile_loudness_sma3_meanFallingSlope","smile_loudness_sma3_stddevFallingSlope","smile_spectralFlux_sma3_amean","smile_spectralFlux_sma3_stddevNorm","smile_mfcc1_sma3_amean","smile_mfcc1_sma3_stddevNorm","smile_mfcc2_sma3_amean","smile_mfcc2_sma3_stddevNorm","smile_mfcc3_sma3_amean","smile_mfcc3_sma3_stddevNorm","smile_mfcc4_sma3_amean","smile_mfcc4_sma3_stddevNorm","smile_jitterLocal_sma3nz_amean","smile_jitterLocal_sma3nz_stddevNorm","smile_shimmerLocaldB_sma3nz_amean","smile_shimmerLocaldB_sma3nz_stddevNorm","smile_HNRdBACF_sma3nz_amean","smile_HNRdBACF_sma3nz_stddevNorm","smile_logRelF0-H1-H2_sma3nz_amean","smile_logRelF0-H1-H2_sma3nz_stddevNorm","smile_logRelF0-H1-A3_sma3nz_amean","smile_logRelF0-H1-A3_sma3nz_stddevNorm","smile_F1frequency_sma3nz_amean","smile_F1frequency_sma3nz_stddevNorm","smile_F1bandwidth_sma3nz_amean","smile_F1bandwidth_sma3nz_stddevNorm","smile_F1amplitudeLogRelF0_sma3nz_amean","smile_F1amplitudeLogRelF0_sma3nz_stddevNorm","smile_F2frequency_sma3nz_amean","smile_F2frequency_sma3nz_stddevNorm","smile_F2bandwidth_sma3nz_amean","smile_F2bandwidth_sma3nz_stddevNorm","smile_F2amplitudeLogRelF0_sma3nz_amean","smile_F2amplitudeLogRelF0_sma3nz_stddevNorm","smile_F3frequency_sma3nz_amean","smile_F3frequency_sma3nz_stddevNorm","smile_F3bandwidth_sma3nz_amean","smile_F3bandwidth_sma3nz_stddevNorm","smile_F3amplitudeLogRelF0_sma3nz_amean","smile_F3amplitudeLogRelF0_sma3nz_stddevNorm","smile_alphaRatioV_sma3nz_amean","smile_alphaRatioV_sma3nz_stddevNorm","smile_hammarbergIndexV_sma3nz_amean","smile_hammarbergIndexV_sma3nz_stddevNorm","smile_slopeV0-500_sma3nz_amean","smile_slopeV0-500_sma3nz_stddevNorm","smile_slopeV500-1500_sma3nz_amean","smile_slopeV500-1500_sma3nz_stddevNorm","smile_spectralFluxV_sma3nz_amean","smile_spectralFluxV_sma3nz_stddevNorm","smile_mfcc1V_sma3nz_amean","smile_mfcc1V_sma3nz_stddevNorm","smile_mfcc2V_sma3nz_amean","smile_mfcc2V_sma3nz_stddevNorm","smile_mfcc3V_sma3nz_amean","smile_mfcc3V_sma3nz_stddevNorm","smile_mfcc4V_sma3nz_amean","smile_mfcc4V_sma3nz_stddevNorm","smile_alphaRatioUV_sma3nz_amean","smile_hammarbergIndexUV_sma3nz_amean","smile_slopeUV0-500_sma3nz_amean","smile_slopeUV500-1500_sma3nz_amean","smile_spectralFluxUV_sma3nz_amean","smile_loudnessPeaksPerSec","smile_VoicedSegmentsPerSec","smile_MeanVoicedSegmentLengthSec","smile_StddevVoicedSegmentLengthSec","smile_MeanUnvoicedSegmentLength","smile_StddevUnvoicedSegmentLength","smile_equivalentSoundLevel_dBp"
    ]
scaler_stds = np.where(scaler_stds == 0, 1.0, scaler_stds)

MODEL_PATHS = {
    "physical": ["./fatigue_body_model.txt", "./models/fatigue_body_model.txt"],
    "brain": ["./fatigue_brain_model.txt", "./models/fatigue_brain_model.txt"],
    "mental": ["./fatigue_mental_model.txt", "./models/fatigue_mental_model.txt"],
}
models = {}
for k, paths in MODEL_PATHS.items():
    for p in paths:
        if os.path.exists(p):
            try:
                models[k] = lgb.Booster(model_file=p)
                print(f"[OK] Loaded {k} from {p}")
                break
            except Exception as e:
                print(f"Failed {p}: {e}")

FATIGUE_KEYWORDS = ["疲れ","疲れた","だるい","眠い","しんどい","集中","やる気","重い","しょぼしょぼ","頭痛","つかれ","倦怠","無気力"]
def compute_fatigue_word_count(text: str) -> float:
    if not text: return 0.0
    return float(sum(text.count(kw) for kw in FATIGUE_KEYWORDS))
def compute_speech_rate(text: str, duration: Optional[float]) -> float:
    if not text or not duration or duration <= 0: return 2.65
    has_ja = bool(re.search(r'[\u3040-\u30FF\u4E00-\u9FAF]', text))
    if has_ja: return len(text) / duration
    words = re.findall(r'\w+', text)
    wc = len(words) if words else len(text)
    return wc / duration
def compute_sim_brain(text: str) -> float:
    if not text: return 0.813
    return float(np.clip(0.813 + compute_fatigue_word_count(text)*0.01, 0.7, 0.9))
def get_ext_from_upload(file: UploadFile) -> str:
    name = (file.filename or "").lower()
    ctype = (file.content_type or "").lower()
    if "mp4" in ctype or name.endswith(".mp4"): return ".mp4"
    if "m4a" in ctype or name.endswith(".m4a"): return ".m4a"
    if "wav" in ctype or name.endswith(".wav"): return ".wav"
    if "webm" in ctype or name.endswith(".webm"): return ".webm"
    if "ogg" in ctype: return ".ogg"
    if "mpeg" in ctype or name.endswith(".mp3"): return ".mp3"
    return ".webm"
def get_mime_for_ext(ext: str) -> str:
    return {".webm":"audio/webm",".wav":"audio/wav",".mp4":"audio/mp4",".m4a":"audio/m4a",".mp3":"audio/mpeg",".ogg":"audio/ogg",".aac":"audio/aac"}.get(ext,"audio/webm")
def convert_to_wav_16k(src_path: str) -> str:
    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_file(src_path)
        audio = audio.set_channels(1).set_frame_rate(16000)
        fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        audio.export(wav_path, format="wav")
        return wav_path
    except Exception as e:
        print(f"[WARN] convert_to_wav failed {e}")
        return src_path
def get_audio_duration_sec(wav_path: str) -> Optional[float]:
    try:
        from pydub import AudioSegment
        return len(AudioSegment.from_file(wav_path))/1000.0
    except: return None
def extract_smile_features(wav_path: str) -> np.ndarray:
    with smile_lock:
        df = smile.process_file(wav_path)
    if df is None or df.empty: raise ValueError("OpenSmile empty")
    row = df.iloc[0].to_dict()
    vec=[]
    for key in smile_order:
        val=row.get(key)
        if val is None:
            alt=key.replace("smile_","")
            val=row.get(alt, 0.0)
        try:
            fv=float(val)
            if not np.isfinite(fv): fv=0.0
        except: fv=0.0
        vec.append(fv)
    return np.array(vec, dtype=np.float32)
def extract_smile_features_dict(wav_path: str) -> Dict[str, float]:
    with smile_lock:
        df = smile.process_file(wav_path)
    if df is None or df.empty: raise ValueError("OpenSmile empty")
    row = df.iloc[0].to_dict()
    return {k: float(v) if isinstance(v,(int,float)) else 0.0 for k,v in row.items()}
def build_91_vector(smile_vec, text="", duration=None):
    sim_brain = compute_sim_brain(text)
    speech_rate = compute_speech_rate(text, duration)
    fatigue_wc = compute_fatigue_word_count(text)
    extra = np.array([sim_brain, speech_rate, fatigue_wc], dtype=np.float32)
    return np.concatenate([smile_vec, extra])
def standardize_91(v): return (v - scaler_means) / scaler_stds
def predict_voice_91(vec_std):
    results={}
    for name, model in models.items():
        pred = model.predict(np.array([vec_std]))[0]
        results[name]=float(np.clip(pred, 1.0, 5.0))
    def to100(x): return float(np.clip((x-1.0)/4.0*100, 0, 100))
    return {"physical_raw":results.get("physical",3.0),"brain_raw":results.get("brain",3.0),"mental_raw":results.get("mental",3.0),"physical":to100(results.get("physical",3.0)),"brain":to100(results.get("brain",3.0)),"mental":to100(results.get("mental",3.0))}
ENSEMBLE_WEIGHTS = {"physical":{"embed":0.60,"voice":0.40},"brain":{"embed":0.30,"voice":0.70},"mental":{"embed":0.75,"voice":0.25}}
def embedding_to_percent(sim_fatigue: float, sim_healthy: float) -> float:
    return float(np.clip(48 + (sim_fatigue - sim_healthy)*160, 12, 93))
def ensemble_scores(voice_scores, embed_scores):
    final={}
    for key in ["physical","brain","mental"]:
        w = ENSEMBLE_WEIGHTS[key]
        final[key] = float(np.clip(embed_scores.get(key,50)*w["embed"] + voice_scores.get(key,50)*w["voice"], 0, 100))
    avg = (final["physical"]+final["brain"]+final["mental"])/3
    final["total"] = float(np.clip(100 - avg*0.88, 18, 95))
    return final

# ============ Endpoints ============

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Groq Whisper Turbo - 最軽量モデル"""
    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        raise HTTPException(500, "GROQ_API_KEY not set on Render")
    ext = get_ext_from_upload(file)
    content = await file.read()
    print(f"[Transcribe] {len(content)} bytes ext={ext} ctype={file.content_type}")
    if len(content) < 1000:
        raise HTTPException(400, "audio too short - 1秒以上話してください")

    # 最軽量: whisper-large-v3-turbo (日本語対応で一番軽い)
    # 日本語特化で高速
    mime = get_mime_for_ext(ext)
    files = {"file": (f"recording{ext}", content, mime)}
    data = {
        "model": "whisper-large-v3-turbo",  # 軽量版
        "language": "ja",
        "response_format": "json",
        "temperature": "0.0",
    }
    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {groq_key.strip()}"},
                files=files,
                data=data
            )
            print(f"[Groq STT] {resp.status_code}")
            if resp.status_code != 200:
                print(f"[Groq STT error] {resp.text[:800]}")
                raise HTTPException(500, f"Groq STT error {resp.status_code}: {resp.text}")
            j = resp.json()
            text = j.get("text","").strip()
            print(f"[STT OK] {text}")
            return {"text": text, "language":"ja", "source":"groq-whisper-turbo"}
    except Exception as e:
        print(f"[Transcribe error] {e}")
        import traceback; traceback.print_exc()
        raise HTTPException(500, f"Transcribe failed: {e}")

@app.post("/chat")
@app.post("/api/chat")
async def chat_proxy(request: Request):
    try: body = await request.json()
    except: body = {}
    messages = body.get("messages", [])
    if not messages:
        return JSONResponse({"text":"そうなんだね。もう少し詳しく聞かせて？"}, status_code=200)
    try:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            last_user = next((m.get("content","") for m in reversed(messages) if m.get("role")=="user"), "")
            fb = "そっか、疲れを感じてるんだね。" if any(k in last_user for k in ["疲","だる","眠"]) else "そうなんだね。もう少しだけ詳しく聞かせてくれる？"
            return JSONResponse({"text": fb, "fallback": True})

        # ★GPT-OSS-20B 固定 - 推論モデルなのでトークン多めに確保
        # reasoning_effort=low で最軽量推論
        requested = int(body.get("max_tokens") or body.get("max_completion_tokens") or 400)
        max_comp = min(max(requested, 300), 800)  # 300未満だと空返事になるので下限300

        payload = {
            "model": "openai/gpt-oss-20b",  # ユーザー指定固定
            "messages": messages,
            "reasoning_effort": "low",  # 最軽量推論
            "temperature": 0.75,
            "max_completion_tokens": max_comp,
        }
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key.strip()}", "Content-Type":"application/json"}
            )
            if resp.status_code != 200:
                print(f"[Groq gpt-oss error] {resp.status_code} {resp.text[:800]}")
                last_user = next((m.get("content","") for m in reversed(messages) if m.get("role")=="user"), "")
                return JSONResponse({"text": f"なるほど、{last_user[:30]}なんだね。もう少し教えてくれる？", "fallback": True, "groq_error": resp.text[:500]})
            data = resp.json()
            text_out = data["choices"][0]["message"]["content"]
            return JSONResponse({"text": text_out})
    except Exception as e:
        print(f"[chat_proxy error] {e}")
        import traceback; traceback.print_exc()
        return JSONResponse({"text":"そうなんだね、もう少しだけ詳しく教えてくれる？", "error": str(e)})

@app.get("/")
def health():
    return {"status":"ok","models":list(models.keys()),"scaler":scaler_means is not None,"groq_key_set": bool(os.getenv("GROQ_API_KEY")),"chat_model":"openai/gpt-oss-20b","stt_model":"whisper-large-v3-turbo"}
