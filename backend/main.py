
import os
import tempfile
import json
import re
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import opensmile
import edge_tts
import lightgbm as lgb
from typing import Optional

app = FastAPI(title="Fatigue Ensemble: Voice + Embedding")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ OpenSmile ============
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

# ============ Text helpers ============
FATIGUE_KEYWORDS = ["疲れ","疲れた","だるい","眠い","しんどい","集中","やる気","重い","しょぼしょぼ","頭痛","つかれ","倦怠","無気力"]

def compute_fatigue_word_count(text: str) -> float:
    if not text: return 0.0
    return float(sum(text.count(kw) for kw in FATIGUE_KEYWORDS))

def compute_speech_rate(text: str, duration: Optional[float]) -> float:
    if not text: return 2.65
    import re
    words = re.findall(r'\w+', text)
    wc = len(words) if words else len(text)
    if duration and duration>0:
        return wc / duration
    return 2.65

def compute_sim_brain(text: str) -> float:
    if not text: return 0.813
    base=0.813
    return float(np.clip(base + compute_fatigue_word_count(text)*0.01, 0.7, 0.9))

def get_audio_duration_sec(path: str) -> Optional[float]:
    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_file(path)
        return len(audio)/1000.0
    except:
        return None

def extract_smile_features(wav_path: str):
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
            if fv!=fv or fv in (float('inf'), float('-inf')):
                fv=0.0
        except:
            fv=0.0
        vec.append(fv)
    return np.array(vec, dtype=np.float32)

def build_91_vector(smile_vec, text="", duration=None):
    sim_brain = compute_sim_brain(text)
    speech_rate = compute_speech_rate(text, duration)
    fatigue_wc = compute_fatigue_word_count(text)
    extra = np.array([sim_brain, speech_rate, fatigue_wc], dtype=np.float32)
    return np.concatenate([smile_vec, extra])

def standardize_91(v):
    return (v - scaler_means) / scaler_stds

def predict_voice_91(vec_std):
    results={}
    for name, model in models.items():
        pred = model.predict(np.array([vec_std]))[0]
        pred = float(np.clip(pred, 1.0, 5.0))
        results[name]=pred
    def to100(x): return float(np.clip((x-1.0)/4.0*100, 0, 100))
    return {
        "physical_raw": results.get("physical",3.0),
        "brain_raw": results.get("brain",3.0),
        "mental_raw": results.get("mental",3.0),
        "physical": to100(results.get("physical",3.0)),
        "brain": to100(results.get("brain",3.0)),
        "mental": to100(results.get("mental",3.0)),
    }

# ============ Ensemble Logic ============
# 最適化結果に基づく重み (調整可能)
ENSEMBLE_WEIGHTS = {
    "physical": {"embed": 0.60, "voice": 0.40},  # 身体: 言葉6割
    "brain":    {"embed": 0.30, "voice": 0.70},  # 脳: 声7割
    "mental":   {"embed": 0.75, "voice": 0.25},  # 精神: 言葉75%
}

def embedding_to_percent(sim_fatigue: float, sim_healthy: float) -> float:
    # フロントと同じロジック: toPct = 48 + (sim_fatigue - sim_healthy)*160
    c = sim_fatigue - sim_healthy
    pct = 48 + c * 160
    return float(np.clip(pct, 12, 93))

def ensemble_scores(voice_scores, embed_scores):
    # voice_scores: dict {physical,brain,mental} 0-100
    # embed_scores: dict {physical,brain,mental} 0-100
    final={}
    for key in ["physical","brain","mental"]:
        w = ENSEMBLE_WEIGHTS[key]
        final[key] = float(np.clip(
            embed_scores.get(key,50)*w["embed"] + voice_scores.get(key,50)*w["voice"],
            0, 100
        ))
    avg = (final["physical"]+final["brain"]+final["mental"])/3
    final["total"] = float(np.clip(100 - avg*0.88, 18, 95))  # Well-being
    return final

# ============ Endpoints ============

@app.post("/extract-features")
async def extract_features(file: UploadFile = File(...)):
    import tempfile, os
    # iOS対応: m4a/mp4でも受け取る
    suffix = ".webm"
    if file.filename:
        if file.filename.lower().endswith(".m4a"): suffix=".m4a"
        elif file.filename.lower().endswith(".mp4"): suffix=".mp4"
        elif file.filename.lower().endswith(".mp3"): suffix=".mp3"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path=tmp.name
    try:
        # mp4/m4aはwavに変換してからopenSMILEに渡す (iOS対策)
        if suffix in [".m4a", ".mp4"]:
            try:
                from pydub import AudioSegment
                audio = AudioSegment.from_file(tmp_path)
                wav_path = tmp_path + ".wav"
                audio.export(wav_path, format="wav")
                vec = extract_smile_features(wav_path)
                os.remove(wav_path)
            except Exception as e:
                print(f"[WARN] convert {suffix} to wav failed: {e}, trying direct")
                vec = extract_smile_features(tmp_path)
        else:
            vec = extract_smile_features(tmp_path)
        # 簡易特徴量も返す (フロントのフォールバック用)
        try:
            df = None
            # vecはndarrayなので適当に返す
            return {"count": len(vec), "ok": True}
        except:
            return {"count": len(vec)}
    except Exception as e:
        print(f"[ERROR] extract_features failed: {e}")
        return {"count": 0, "error": str(e)}
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.post("/predict-fatigue")
async def predict_fatigue(
    file: UploadFile = File(...),
    text: str = Form(default=""),
    sim_body: float = Form(default=None),
    sim_brain: float = Form(default=None),
    sim_mental: float = Form(default=None),
    sim_healthy: float = Form(default=None),
):
    if not models:
        raise HTTPException(status_code=500, detail="Models not loaded")
    suffix = ".webm"
    if file.filename:
        fn = file.filename.lower()
        if fn.endswith(".m4a"): suffix=".m4a"
        elif fn.endswith(".mp4"): suffix=".mp4"
        elif fn.endswith(".mp3"): suffix=".mp3"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path=tmp.name
    wav_converted_path = None
    try:
        # iOS: m4a/mp4 -> wav変換
        if suffix in [".m4a", ".mp4"]:
            try:
                from pydub import AudioSegment
                audio = AudioSegment.from_file(tmp_path)
                wav_converted_path = tmp_path + ".wav"
                audio.export(wav_converted_path, format="wav")
                use_path = wav_converted_path
            except Exception as e:
                print(f"[WARN] convert to wav failed: {e}")
                use_path = tmp_path
        else:
            use_path = tmp_path
        duration = get_audio_duration_sec(use_path if use_path else tmp_path)
        smile_vec = extract_smile_features(use_path)
        vec91 = build_91_vector(smile_vec, text=text, duration=duration)
        vec91_std = standardize_91(vec91)
        voice_scores = predict_voice_91(vec91_std)

        # Embedding scores: フロントからsimが来ればそれを使う、無ければ簡易計算
        if sim_body is not None and sim_healthy is not None:
            embed_scores = {
                "physical": embedding_to_percent(sim_body, sim_healthy),
                "brain": embedding_to_percent(sim_brain if sim_brain is not None else sim_body, sim_healthy),
                "mental": embedding_to_percent(sim_mental if sim_mental is not None else sim_body, sim_healthy),
            }
            embed_source="frontend"
        else:
            # テキストが無い場合やsimが無い場合は、疲労語数から簡易推定
            fwc = compute_fatigue_word_count(text)
            base = 35 + fwc*12  # 適当なヒューリスティック
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
            # 後方互換: 旧フロントが期待する形式
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
            }
        }
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        if wav_converted_path and os.path.exists(wav_converted_path):
            try:
                os.remove(wav_converted_path)
            except:
                pass

@app.get("/tts")
async def tts(text: str = Query(..., min_length=1, max_length=400), voice: str = Query("ja-JP-NanamiNeural")):
    if voice.startswith("jf_") or voice=="female":
        voice="ja-JP-NanamiNeural"
    elif voice.startswith("jm_") or voice=="male":
        voice="ja-JP-KeitaNeural"
    communicate=edge_tts.Communicate(text, voice)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
        tmp_path=tmp.name
    await communicate.save(tmp_path)
    with open(tmp_path, "rb") as f:
        audio_data=f.read()
    os.remove(tmp_path)
    return Response(content=audio_data, media_type="audio/mpeg")

@app.get("/")
def health():
    return {"status":"ok","models":list(models.keys()),"scaler":scaler_means is not None,"ensemble_weights":ENSEMBLE_WEIGHTS}
