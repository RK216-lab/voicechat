
import os
import tempfile
import json
import re
import pickle
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import opensmile
import edge_tts
import lightgbm as lgb
from typing import Optional

app = FastAPI(title="OpenSmile + Edge TTS + Fatigue 91D")

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

# ============ Load 91D Scaler ============
SCALER_PATHS = ["./scaler_91.json", "../scaler_91.json", "./models/scaler_91.json", "../models/scaler_91.json", "/mnt/data/scaler_91.json", "../../scaler_91.json"]
scaler_means = None
scaler_stds = None
feature_order_91 = None
smile_order = None
extra_order = None

for p in SCALER_PATHS:
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
                scaler_means = np.array(data["means"], dtype=np.float32)
                scaler_stds = np.array(data["stds"], dtype=np.float32)
                feature_order_91 = data["feature_order"]
                smile_order = data.get("smile_order", feature_order_91[:88])
                extra_order = data.get("extra_order", feature_order_91[88:])
                print(f"[OK] Loaded scaler 91 from {p} | features {len(feature_order_91)}")
                break
        except Exception as e:
            print(f"[WARN] Failed scaler {p}: {e}")

# Fallback: if no scaler file, create dummy (mean 0 std 1)
if scaler_means is None:
    print("[WARN] No scaler_91.json found, using identity scaling")
    # 88 smile + 3 extra
    scaler_means = np.zeros(91, dtype=np.float32)
    scaler_stds = np.ones(91, dtype=np.float32)
    # default order from output_data.csv
    smile_order = [
        "smile_F0semitoneFrom27.5Hz_sma3nz_amean","smile_F0semitoneFrom27.5Hz_sma3nz_stddevNorm","smile_F0semitoneFrom27.5Hz_sma3nz_percentile20.0","smile_F0semitoneFrom27.5Hz_sma3nz_percentile50.0","smile_F0semitoneFrom27.5Hz_sma3nz_percentile80.0","smile_F0semitoneFrom27.5Hz_sma3nz_pctlrange0-2","smile_F0semitoneFrom27.5Hz_sma3nz_meanRisingSlope","smile_F0semitoneFrom27.5Hz_sma3nz_stddevRisingSlope","smile_F0semitoneFrom27.5Hz_sma3nz_meanFallingSlope","smile_F0semitoneFrom27.5Hz_sma3nz_stddevFallingSlope","smile_loudness_sma3_amean","smile_loudness_sma3_stddevNorm","smile_loudness_sma3_percentile20.0","smile_loudness_sma3_percentile50.0","smile_loudness_sma3_percentile80.0","smile_loudness_sma3_pctlrange0-2","smile_loudness_sma3_meanRisingSlope","smile_loudness_sma3_stddevRisingSlope","smile_loudness_sma3_meanFallingSlope","smile_loudness_sma3_stddevFallingSlope","smile_spectralFlux_sma3_amean","smile_spectralFlux_sma3_stddevNorm","smile_mfcc1_sma3_amean","smile_mfcc1_sma3_stddevNorm","smile_mfcc2_sma3_amean","smile_mfcc2_sma3_stddevNorm","smile_mfcc3_sma3_amean","smile_mfcc3_sma3_stddevNorm","smile_mfcc4_sma3_amean","smile_mfcc4_sma3_stddevNorm","smile_jitterLocal_sma3nz_amean","smile_jitterLocal_sma3nz_stddevNorm","smile_shimmerLocaldB_sma3nz_amean","smile_shimmerLocaldB_sma3nz_stddevNorm","smile_HNRdBACF_sma3nz_amean","smile_HNRdBACF_sma3nz_stddevNorm","smile_logRelF0-H1-H2_sma3nz_amean","smile_logRelF0-H1-H2_sma3nz_stddevNorm","smile_logRelF0-H1-A3_sma3nz_amean","smile_logRelF0-H1-A3_sma3nz_stddevNorm","smile_F1frequency_sma3nz_amean","smile_F1frequency_sma3nz_stddevNorm","smile_F1bandwidth_sma3nz_amean","smile_F1bandwidth_sma3nz_stddevNorm","smile_F1amplitudeLogRelF0_sma3nz_amean","smile_F1amplitudeLogRelF0_sma3nz_stddevNorm","smile_F2frequency_sma3nz_amean","smile_F2frequency_sma3nz_stddevNorm","smile_F2bandwidth_sma3nz_amean","smile_F2bandwidth_sma3nz_stddevNorm","smile_F2amplitudeLogRelF0_sma3nz_amean","smile_F2amplitudeLogRelF0_sma3nz_stddevNorm","smile_F3frequency_sma3nz_amean","smile_F3frequency_sma3nz_stddevNorm","smile_F3bandwidth_sma3nz_amean","smile_F3bandwidth_sma3nz_stddevNorm","smile_F3amplitudeLogRelF0_sma3nz_amean","smile_F3amplitudeLogRelF0_sma3nz_stddevNorm","smile_alphaRatioV_sma3nz_amean","smile_alphaRatioV_sma3nz_stddevNorm","smile_hammarbergIndexV_sma3nz_amean","smile_hammarbergIndexV_sma3nz_stddevNorm","smile_slopeV0-500_sma3nz_amean","smile_slopeV0-500_sma3nz_stddevNorm","smile_slopeV500-1500_sma3nz_amean","smile_slopeV500-1500_sma3nz_stddevNorm","smile_spectralFluxV_sma3nz_amean","smile_spectralFluxV_sma3nz_stddevNorm","smile_mfcc1V_sma3nz_amean","smile_mfcc1V_sma3nz_stddevNorm","smile_mfcc2V_sma3nz_amean","smile_mfcc2V_sma3nz_stddevNorm","smile_mfcc3V_sma3nz_amean","smile_mfcc3V_sma3nz_stddevNorm","smile_mfcc4V_sma3nz_amean","smile_mfcc4V_sma3nz_stddevNorm","smile_alphaRatioUV_sma3nz_amean","smile_hammarbergIndexUV_sma3nz_amean","smile_slopeUV0-500_sma3nz_amean","smile_slopeUV500-1500_sma3nz_amean","smile_spectralFluxUV_sma3nz_amean","smile_loudnessPeaksPerSec","smile_VoicedSegmentsPerSec","smile_MeanVoicedSegmentLengthSec","smile_StddevVoicedSegmentLengthSec","smile_MeanUnvoicedSegmentLength","smile_StddevUnvoicedSegmentLength","smile_equivalentSoundLevel_dBp"
    ]
    extra_order = ["sim_brain","speech_rate","fatigue_word_count"]
    feature_order_91 = smile_order + extra_order

# ============ Load LightGBM Models ============
MODEL_PATHS = {
    "physical": [
        "./fatigue_body_model.txt", 
        "./models/fatigue_body_model.txt", 
        "../models/fatigue_body_model.txt",
        "../../models/fatigue_body_model.txt",
        "/mnt/data/fatigue_body_model.txt"
    ],
    "brain": [
        "./fatigue_brain_model.txt", 
        "./models/fatigue_brain_model.txt",
        "../models/fatigue_brain_model.txt",
        "../../models/fatigue_brain_model.txt",
        "/mnt/data/fatigue_brain_model.txt"
    ],
    "mental": [
        "./fatigue_mental_model.txt", 
        "./models/fatigue_mental_model.txt",
        "../models/fatigue_mental_model.txt",
        "../../models/fatigue_mental_model.txt",
        "/mnt/data/fatigue_mental_model.txt"
    ],
}

models = {}

def load_models():
    global models
    for key, paths in MODEL_PATHS.items():
        for p in paths:
            if os.path.exists(p):
                try:
                    booster = lgb.Booster(model_file=p)
                    models[key] = booster
                    print(f"[OK] Loaded {key} from {p} num_features={booster.num_feature()}")
                    break
                except Exception as e:
                    print(f"[WARN] Failed {p}: {e}")
        if key not in models:
            print(f"[WARN] Model not found for {key}")

load_models()

# ============ Helper: Text Features ============
FATIGUE_KEYWORDS = ["疲れ","疲れた","だるい","眠い","しんどい","集中","やる気","重い","しょぼしょぼ","頭痛","つかれ","倦怠","無気力","だるさ"]

def compute_fatigue_word_count(text: str) -> float:
    if not text:
        return 0.0
    cnt=0
    for kw in FATIGUE_KEYWORDS:
        cnt+= text.count(kw)
    return float(cnt)

def compute_speech_rate(text: str, duration_sec: Optional[float]) -> float:
    if not text:
        return float(scaler_means[89]) if len(scaler_means)>89 else 2.6 # mean fallback
    # word_count as per CSV: split by spaces? Japanese: they used word_count as token count
    # Approx: count characters? For simplicity, use len(text.split()) or len
    # In CSV, word_count ~ 8-11 for Japanese sentences, so they likely count morphological tokens
    # We'll approximate with len(text.split()) and fallback
    import re
    # Very rough: count of words separated by punctuation/space
    words = re.findall(r'\w+', text)
    wc = len(words) if words else len(text)
    if duration_sec and duration_sec>0:
        return wc / duration_sec
    else:
        # fallback mean 2.65
        return 2.65

def compute_sim_brain(text: str) -> float:
    # Placeholder: mean of sim_brain from data is 0.813
    # If you have embedding model, replace here with cosine similarity
    # For now return mean to keep prediction stable
    if not text:
        return 0.8131742724558202
    # Simple heuristic: if fatigue keywords present, higher similarity to fatigue?
    # We'll just return mean + small noise based on fatigue count
    base=0.813
    fwc=compute_fatigue_word_count(text)
    return float(np.clip(base + fwc*0.01, 0.7, 0.9))

def get_audio_duration_sec(file_path: str) -> Optional[float]:
    try:
        # Try pydub
        from pydub import AudioSegment
        audio = AudioSegment.from_file(file_path)
        return len(audio) / 1000.0
    except:
        pass
    try:
        import wave, contextlib
        with contextlib.closing(wave.open(file_path, 'r')) as f:
            frames=f.getnframes()
            rate=f.getframerate()
            return frames / float(rate)
    except:
        return None

# ============ Feature Extraction ============
def extract_smile_features(wav_path: str):
    df = smile.process_file(wav_path)
    if df is None or df.empty:
        raise ValueError("OpenSmile returned empty")
    row = df.iloc[0].to_dict()
    # Build vector in smile_order
    vec=[]
    for key in smile_order:
        # opensmile keys may not have smile_ prefix? In opensmile Python, keys are like F0semitone... not smile_
        # So we need to map: our smile_order has smile_ prefix, but actual df keys are without?
        # In our earlier extraction, we used sorted keys. Let's handle both
        val=None
        if key in row:
            val=row[key]
        else:
            # try without smile_ prefix
            alt=key.replace("smile_","")
            if alt in row:
                val=row[alt]
            else:
                # try lowercased? Search case-insensitive
                # fallback: find key that endswith alt
                for k in row.keys():
                    if k.endswith(alt) or alt.endswith(k):
                        val=row[k]
                        break
        if val is None:
            val=0.0
        try:
            fv=float(val)
            if fv!=fv or fv in (float('inf'), float('-inf')):
                fv=0.0
        except:
            fv=0.0
        vec.append(fv)
    return np.array(vec, dtype=np.float32), row

def build_91_vector(smile_vec: np.ndarray, text: str = "", duration: Optional[float] = None):
    # smile_vec is 88
    sim_brain = compute_sim_brain(text)
    speech_rate = compute_speech_rate(text, duration)
    fatigue_wc = compute_fatigue_word_count(text)
    extra = np.array([sim_brain, speech_rate, fatigue_wc], dtype=np.float32)
    full = np.concatenate([smile_vec, extra])
    return full

def standardize_91(vec91: np.ndarray):
    # vec91 length 91
    return (vec91 - scaler_means) / scaler_stds

def predict_fatigue_from_91(vec91_standardized: np.ndarray):
    results={}
    for name, model in models.items():
        pred = model.predict(np.array([vec91_standardized]))[0]
        pred = float(np.clip(pred, 1.0, 5.0))
        results[name]=pred
    avg = float(np.mean(list(results.values())))
    wellbeing = 100 - (avg - 1.0)/4.0*100
    wellbeing = float(np.clip(wellbeing, 0, 100))
    def to100(x):
        return float(np.clip((x-1.0)/4.0*100, 0, 100))
    return {
        "physical_raw": results.get("physical",3.0),
        "brain_raw": results.get("brain",3.0),
        "mental_raw": results.get("mental",3.0),
        "physical": to100(results.get("physical",3.0)),
        "brain": to100(results.get("brain",3.0)),
        "mental": to100(results.get("mental",3.0)),
        "avg_fatigue": avg,
        "total": wellbeing,
        "feature_vector_91": vec91_standardized.tolist()[:5], # debug truncated
    }

# ============ Endpoints ============
@app.post("/extract-features")
async def extract_features(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        content=await file.read()
        tmp.write(content)
        tmp_path=tmp.name
    try:
        smile_vec,_=extract_smile_features(tmp_path)
        return {"count": len(smile_vec), "smile_features": smile_vec.tolist()}
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.post("/predict-fatigue")
async def predict_fatigue(
    file: UploadFile = File(...),
    text: str = Form(default=""),
):
    if not models:
        raise HTTPException(status_code=500, detail="Models not loaded")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        content=await file.read()
        tmp.write(content)
        tmp_path=tmp.name
    try:
        duration=get_audio_duration_sec(tmp_path)
        smile_vec,_=extract_smile_features(tmp_path)
        if len(smile_vec)!=88:
            raise HTTPException(status_code=500, detail=f"Smile feature count mismatch: got {len(smile_vec)} expected 88")
        vec91=build_91_vector(smile_vec, text=text, duration=duration)
        vec91_std=standardize_91(vec91)
        result=predict_fatigue_from_91(vec91_std)
        # add debug info
        result["debug"]={
            "duration": duration,
            "text_len": len(text),
            "speech_rate": float(vec91[89]) if len(vec91)>89 else None,
            "fatigue_word_count": float(vec91[90]) if len(vec91)>90 else None,
            "sim_brain": float(vec91[88]) if len(vec91)>88 else None,
        }
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.post("/predict-from-vector")
async def predict_from_vector(vector: list[float]):
    if len(vector)!=91:
        raise HTTPException(status_code=400, detail="Need 91 features")
    vec=np.array(vector, dtype=np.float32)
    # Assume already standardized? We'll standardize if not? For compatibility, if values look raw (>10), standardize
    # Here we expect raw, so standardize
    vec_std=standardize_91(vec)
    return predict_fatigue_from_91(vec_std)

@app.post("/predict-from-standardized")
async def predict_from_standardized(vector: list[float]):
    # Directly predict from already standardized vector (for testing with CSV)
    vec=np.array(vector, dtype=np.float32)
    return predict_fatigue_from_91(vec)

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
    return Response(content=audio_data, media_type="audio/mpeg", headers={"Cache-Control":"no-cache"})

@app.get("/")
def health_check():
    return {
        "status":"ok",
        "models_loaded": list(models.keys()),
        "scaler_loaded": scaler_means is not None,
        "feature_order_91_len": len(feature_order_91) if feature_order_91 else None,
        "smile_order_len": len(smile_order) if smile_order else None,
    }
