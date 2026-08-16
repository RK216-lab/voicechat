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


# 修正#3 CORS ワイルドカード+credentials は禁止
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ OpenSmile (thread-safe に) ============
smile_lock = threading.Lock()
smile = opensmile.Smile(
    feature_set=opensmile.FeatureSet.eGeMAPSv02,
    feature_level=opensmile.FeatureLevel.Functionals,
)


# ============ Scaler 91D ============
SCALER_PATHS = ["./scaler_91.json", "../scaler_91.json", "./models/scaler_91.json", "../models/scaler_91.json", "/mnt/data/scaler_91.json"]
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
                print(f"[OK] Scaler loaded from {p}")
                break
        except Exception as e:
            print(f"[WARN] Scaler load failed {p}: {e}")


if scaler_means is None:
    scaler_means = np.zeros(91, dtype=np.float32)
    scaler_stds = np.ones(91, dtype=np.float32)
    smile_order = [
        "smile_F0semitoneFrom27.5Hz_sma3nz_amean","smile_F0semitoneFrom27.5Hz_sma3nz_stddevNorm","smile_F0semitoneFrom27.5Hz_sma3nz_percentile20.0","smile_F0semitoneFrom27.5Hz_sma3nz_percentile50.0","smile_F0semitoneFrom27.5Hz_sma3nz_percentile80.0","smile_F0semitoneFrom27.5Hz_sma3nz_pctlrange0-2","smile_F0semitoneFrom27.5Hz_sma3nz_meanRisingSlope","smile_F0semitoneFrom27.5Hz_sma3nz_stddevRisingSlope","smile_F0semitoneFrom27.5Hz_sma3nz_meanFallingSlope","smile_F0semitoneFrom27.5Hz_sma3nz_stddevFallingSlope","smile_loudness_sma3_amean","smile_loudness_sma3_stddevNorm","smile_loudness_sma3_percentile20.0","smile_loudness_sma3_percentile50.0","smile_loudness_sma3_percentile80.0","smile_loudness_sma3_pctlrange0-2","smile_loudness_sma3_meanRisingSlope","smile_loudness_sma3_stddevRisingSlope","smile_loudness_sma3_meanFallingSlope","smile_loudness_sma3_stddevFallingSlope","smile_spectralFlux_sma3_amean","smile_spectralFlux_sma3_stddevNorm","smile_mfcc1_sma3_amean","smile_mfcc1_sma3_stddevNorm","smile_mfcc2_sma3_amean","smile_mfcc2_sma3_stddevNorm","smile_mfcc3_sma3_amean","smile_mfcc3_sma3_stddevNorm","smile_mfcc4_sma3_amean","smile_mfcc4_sma3_stddevNorm","smile_jitterLocal_sma3nz_amean","smile_jitterLocal_sma3nz_stddevNorm","smile_shimmerLocaldB_sma3nz_amean","smile_shimmerLocaldB_sma3nz_stddevNorm","smile_HNRdBACF_sma3nz_amean","smile_HNRdBACF_sma3nz_stddevNorm","smile_logRelF0-H1-H2_sma3nz_amean","smile_logRelF0-H1-H2_sma3nz_stddevNorm","smile_logRelF0-H1-A3_sma3nz_amean","smile_logRelF0-H1-A3_sma3nz_stddevNorm","smile_F1frequency_sma3nz_amean","smile_F1frequency_sma3nz_stddevNorm","smile_F1bandwidth_sma3nz_amean","smile_F1bandwidth_sma3nz_stddevNorm","smile_F1amplitudeLogRelF0_sma3nz_amean","smile_F1amplitudeLogRelF0_sma3nz_stddevNorm","smile_F2frequency_sma3nz_amean","smile_F2frequency_sma3nz_stddevNorm","smile_F2bandwidth_sma3nz_amean","smile_F2bandwidth_sma3nz_stddevNorm","smile_F2amplitudeLogRelF0_sma3nz_amean","smile_F2amplitudeLogRelF0_sma3nz_stddevNorm","smile_F3frequency_sma3nz_amean","smile_F3frequency_sma3nz_stddevNorm","smile_F3bandwidth_sma3nz_amean","smile_F3bandwidth_sma3nz_stddevNorm","smile_F3amplitudeLogRelF0_sma3nz_amean","smile_F3amplitudeLogRelF0_sma3nz_stddevNorm","smile_alphaRatioV_sma3nz_amean","smile_alphaRatioV_sma3nz_stddevNorm","smile_hammarbergIndexV_sma3nz_amean","smile_hammarbergIndexV_sma3nz_stddevNorm","smile_slopeV0-500_sma3nz_amean","smile_slopeV0-500_sma3nz_stddevNorm","smile_slopeV500-1500_sma3nz_amean","smile_slopeV500-1500_sma3nz_stddevNorm","smile_spectralFluxV_sma3nz_amean","smile_spectralFluxV_sma3nz_stddevNorm","smile_mfcc1V_sma3nz_amean","smile_mfcc1V_sma3nz_stddevNorm","smile_mfcc2V_sma3nz_amean","smile_mfcc2V_sma3nz_stddevNorm","smile_mfcc3V_sma3nz_amean","smile_mfcc3V_sma3nz_stddevNorm","smile_mfcc4V_sma3nz_amean","smile_mfcc4V_sma3nz_stddevNorm","smile_alphaRatioUV_sma3nz_amean","smile_hammarbergIndexUV_sma3nz_amean","smile_slopeUV0-500_sma3nz_amean","smile_slopeUV500-1500_sma3nz_amean","smile_spectralFluxUV_sma3nz_amean","smile_loudnessPeaksPerSec","smile_VoicedSegmentsPerSec","smile_MeanVoicedSegmentLengthSec","smile_StddevVoicedSegmentLengthSec","smile_MeanUnvoicedSegmentLength","smile_StddevUnvoicedSegmentLength","smile_equivalentSoundLevel_dBp"
    ]


# 0 除算防止
scaler_stds = np.where(scaler_stds == 0, 1.0, scaler_stds)


# ============ Models ============
MODEL_PATHS = {
    "physical": ["./fatigue_body_model.txt", "./models/fatigue_body_model.txt", "../models/fatigue_body_model.txt", "/mnt/data/fatigue_body_model.txt"],
    "brain": ["./fatigue_brain_model.txt", "./models/fatigue_brain_model.txt", "../models/fatigue_brain_model.txt", "/mnt/data/fatigue_brain_model.txt"],
    "mental": ["./fatigue_mental_model.txt", "./models/fatigue_mental_model.txt", "../models/fatigue_mental_model.txt", "/mnt/data/fatigue_mental_model.txt"],
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


# ============ Helpers ============
FATIGUE_KEYWORDS = ["疲れ","疲れた","だるい","眠い","しんどい","集中","やる気","重い","しょぼしょぼ","頭痛","つかれ","倦怠","無気力"]


def compute_fatigue_word_count(text: str) -> float:
    if not text: return 0.0
    return float(sum(text.count(kw) for kw in FATIGUE_KEYWORDS))


def compute_speech_rate(text: str, duration: Optional[float]) -> float:
    if not text or not duration or duration <= 0:
        return 2.65
    # 修正#7 日本語は文字数ベース
    has_ja = bool(re.search(r'[\u3040-\u30FF\u4E00-\u9FAF]', text))
    if has_ja:
        return len(text) / duration  # 文字/秒
    words = re.findall(r'\w+', text)
    wc = len(words) if words else len(text)
    return wc / duration


def compute_sim_brain(text: str) -> float:
    if not text: return 0.813
    return float(np.clip(0.813 + compute_fatigue_word_count(text)*0.01, 0.7, 0.9))


def get_ext_from_upload(file: UploadFile) -> str:
    # content-type とファイル名から拡張子判定（修正#2 iOS 対応）
    name = (file.filename or "").lower()
    ctype = (file.content_type or "").lower()
    if "mp4" in ctype or name.endswith(".mp4"): return ".mp4"
    if "m4a" in ctype or name.endswith(".m4a"): return ".m4a"
    if "aac" in ctype or name.endswith(".aac"): return ".aac"
    if "wav" in ctype or name.endswith(".wav"): return ".wav"
    if "webm" in ctype or name.endswith(".webm"): return ".webm"
    if "ogg" in ctype: return ".ogg"
    if "mpeg" in ctype or name.endswith(".mp3"): return ".mp3"
    return ".webm"


def convert_to_wav_16k(src_path: str) -> str:
    """任意形式を wav 16k mono に変換、失敗時は元パスを返す"""
    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_file(src_path)
        audio = audio.set_channels(1).set_frame_rate(16000)
        fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        audio.export(wav_path, format="wav")
        return wav_path
    except Exception as e:
        print(f"[WARN] convert_to_wav failed {e}, using original {src_path}")
        return src_path


def get_audio_duration_sec(wav_path: str) -> Optional[float]:
    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_file(wav_path)
        return len(audio)/1000.0
    except:
        return None


def extract_smile_features(wav_path: str) -> np.ndarray:
    # 修正#6 thread-safe
    with smile_lock:
        df = smile.process_file(wav_path)
    if df is None or df.empty:
        raise ValueError("OpenSmile empty")
    row = df.iloc[0].to_dict()
    vec=[]
    for key in smile_order:
        val=row.get(key)
        if val is None:
            alt=key.replace("smile_","")
            val=row.get(alt, 0.0)
            if val==0.0:
                for k in row.keys():
                    if k.endswith(alt) or alt.endswith(k):
                        val=row[k]
                        break
        try:
            fv=float(val)
            if not np.isfinite(fv): fv=0.0
        except: fv=0.0
        vec.append(fv)
    return np.array(vec, dtype=np.float32)


def extract_smile_features_dict(wav_path: str) -> Dict[str, float]:
    with smile_lock:
        df = smile.process_file(wav_path)
    if df is None or df.empty:
        raise ValueError("OpenSmile empty")
    row = df.iloc[0].to_dict()
    # float 化して返す
    out = {}
    for k,v in row.items():
        try: out[k]=float(v)
        except: out[k]=0.0
    return out


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
    return {
        "physical_raw": results.get("physical",3.0),
        "brain_raw": results.get("brain",3.0),
        "mental_raw": results.get("mental",3.0),
        "physical": to100(results.get("physical",3.0)),
        "brain": to100(results.get("brain",3.0)),
        "mental": to100(results.get("mental",3.0)),
    }


ENSEMBLE_WEIGHTS = {
    "physical": {"embed": 0.60, "voice": 0.40},
    "brain": {"embed": 0.30, "voice": 0.70},
    "mental": {"embed": 0.75, "voice": 0.25},
}
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
    """Groq Whisper で文字起こし"""
    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        raise HTTPException(500, "GROQ_API_KEY not set")
    
    ext = get_ext_from_upload(file)
    content = await file.read()
    
    # Groq API に送信
    fd = httpx.FormData()
    fd.append("file", BytesIO(content), f"recording.{ext}")
    fd.append("model", "whisper-large-v3-turbo")
    fd.append("language", "ja")
    fd.append("response_format", "json")
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {groq_key}"},
                data=fd
            )
            
            if resp.status_code != 200:
                print(f"[Groq transcribe error] {resp.status_code}: {resp.text}")
                raise HTTPException(500, f"Groq error: {resp.text}")
            
            data = resp.json()
            text = data.get("text", "").strip()
            
            return {
                "text": text,
                "language": "ja",
                "source": "groq-whisper"
            }
    except httpx.HTTPError as e:
        print(f"[Groq HTTP error] {e}")
        raise HTTPException(500, f"Groq HTTP error: {str(e)}")
    except Exception as e:
        print(f"[Transcribe error] {e}")
        raise HTTPException(500, f"Transcribe failed: {str(e)}")


@app.post("/extract-features")
async def extract_features(file: UploadFile = File(...)):
    ext = get_ext_from_upload(file)
    content = await file.read()
    if len(content) > 15*1024*1024: raise HTTPException(400, "file too large")
    tmp_raw = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    wav_path = None
    try:
        tmp_raw.write(content); tmp_raw.close()
        wav_path = convert_to_wav_16k(tmp_raw.name)
        # 修正#1 フル辞書を返す
        feat_dict = extract_smile_features_dict(wav_path)
        feat_dict["count"] = len(feat_dict)
        return feat_dict
    except Exception as e:
        raise HTTPException(500, f"extract failed: {e}")
    finally:
        for p in [tmp_raw.name, wav_path]:
            if p and os.path.exists(p) and p!= tmp_raw.name: # converted path
                try: os.remove(p)
                except: pass
        try: os.remove(tmp_raw.name)
        except: pass


@app.post("/predict-fatigue")
async def predict_fatigue(
    file: UploadFile = File(...),
    text: str = Form(default=""),
    sim_body: Optional[float] = Form(None),
    sim_brain: Optional[float] = Form(None),
    sim_mental: Optional[float] = Form(None),
    sim_healthy: Optional[float] = Form(None),
):
    if not models: raise HTTPException(500, "Models not loaded")
    ext = get_ext_from_upload(file)
    content = await file.read()
    if len(content) > 15*1024*1024: raise HTTPException(400, "file too large")
    tmp_raw = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    wav_path = None
    try:
        tmp_raw.write(content); tmp_raw.close()
        wav_path = convert_to_wav_16k(tmp_raw.name)
        duration = get_audio_duration_sec(wav_path)
        smile_vec = extract_smile_features(wav_path)
        vec91 = build_91_vector(smile_vec, text=text, duration=duration)
        vec91_std = standardize_91(vec91)
        voice_scores = predict_voice_91(vec91_std)


        if sim_body is not None and sim_healthy is not None:
            embed_scores = {
                "physical": embedding_to_percent(sim_body, sim_healthy),
                "brain": embedding_to_percent(sim_brain if sim_brain is not None else sim_body, sim_healthy),
                "mental": embedding_to_percent(sim_mental if sim_mental is not None else sim_body, sim_healthy),
            }
            embed_source="frontend"
        else:
            fwc = compute_fatigue_word_count(text)
            base = 35 + fwc*12
            embed_scores = {
                "physical": float(np.clip(base, 12, 93)),
                "brain": float(np.clip(base+5, 12, 93)),
                "mental": float(np.clip(base+8, 12, 93)),
            }
            embed_source="heuristic"


        final = ensemble_scores(voice_scores, embed_scores)


        return {
            "voice": voice_scores,
            "embedding": embed_scores,
            "final": final,
            "physical": final["physical"],
            "brain": final["brain"],
            "mental": final["mental"],
            "total": final["total"],
            "physical_raw": voice_scores["physical_raw"],
            "brain_raw": voice_scores["brain_raw"],
            "mental_raw": voice_scores["mental_raw"],
            "debug": {
                "duration": duration,
                "speech_rate": float(vec91[89]),
                "fatigue_word_count": float(vec91[90]),
                "sim_brain": float(vec91[88]),
                "embed_source": embed_source,
                "weights": ENSEMBLE_WEIGHTS,
                "original_ext": ext,
            }
        }
    except Exception as e:
        print(f"[predict error] {e}")
        raise HTTPException(500, f"predict failed: {e}")
    finally:
        for p in [wav_path]:
            if p and os.path.exists(p):
                try: os.remove(p)
                except: pass
        try: os.remove(tmp_raw.name)
        except: pass


@app.get("/tts")
async def tts(text: str = Query(..., min_length=1, max_length=400), voice: str = Query("ja-JP-NanamiNeural")):
    if voice.startswith("jf_") or voice=="female": voice="ja-JP-NanamiNeural"
    elif voice.startswith("jm_") or voice=="male": voice="ja-JP-KeitaNeural"
    tmp_path = None
    try:
        communicate=edge_tts.Communicate(text, voice)
        fd, tmp_path = tempfile.mkstemp(suffix=".mp3")
        os.close(fd)
        await communicate.save(tmp_path)
        with open(tmp_path, "rb") as f: audio_data=f.read()
        return Response(content=audio_data, media_type="audio/mpeg")
    except Exception as e:
        print(f"[TTS error] {e}")
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try: os.remove(tmp_path)
            except: pass


@app.post("/chat")
@app.post("/api/chat")
async def chat_proxy(request: Request):
    # 修正#10 body を 1 回だけ読む
    try: body = await request.json()
    except: body = {}
    messages = body.get("messages", [])
    try:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            last_user = next((m.get("content","") for m in reversed(messages) if m.get("role")=="user"), "")
            if len([m for m in messages if m.get("role")=="user"]) <= 1:
                if any(k in last_user for k in ["疲","だる","眠"]): fb="そっか、疲れを感じてるんだね。どんな時に一番つらいと感じる？"
                elif any(k in last_user for k in ["元気","大丈夫"]): fb="元気そうでよかった。今日はどんなことがあったのか教えてくれる？"
                else: fb="そうなんだね。もう少しだけ詳しく聞かせてくれる？"
            else: fb="話してくれてありがとう。少しゆっくり休んでみてもいいかもね。"
            return JSONResponse({"text": fb, "fallback": True})
        payload = {"model": "openai/gpt-oss-20b","messages": messages,"temperature": 0.75,"max_completion_tokens": body.get("max_tokens") or 120}
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
            if resp.status_code!= 200:
                print(f"[Groq error] {resp.status_code} {resp.text}")
                last_user = next((m.get("content","") for m in reversed(messages) if m.get("role")=="user"), "")
                return JSONResponse({"text": f"なるほど、{last_user[:20]}なんだね。もう少しだけ教えてくれる？", "groq_error": resp.text})
            return JSONResponse({"text": resp.json()["choices"][0]["message"]["content"]})
    except Exception as e:
        print(f"[chat_proxy error] {e}")
        last_user = next((m.get("content","") for m in reversed(messages) if m.get("role")=="user"), "")
        fb = "そうなんだね、もう少しだけ詳しく教えてくれる？" if len([m for m in messages if m.get("role")=="user"]) <=1 else "話してくれてありがとう。少し休んでみてもいいかもしれないね。"
        return JSONResponse({"text": fb, "error": str(e)})


@app.get("/")
def health():
    return {"status":"ok","models":list(models.keys()),"scaler":scaler_means is not None,"ensemble_weights":ENSEMBLE_WEIGHTS}