import os
import tempfile
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import opensmile
import edge_tts
import lightgbm as lgb

app = FastAPI(title="OpenSmile + Edge TTS + Fatigue Models")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenSmile eGeMAPSv02
smile = opensmile.Smile(
    feature_set=opensmile.FeatureSet.eGeMAPSv02,
    feature_level=opensmile.FeatureLevel.Functionals,
)

MODEL_PATHS = {
    "physical": ["./fatigue_body_model.txt", "./models/fatigue_body_model.txt"],
    "brain": ["./fatigue_brain_model.txt", "./models/fatigue_brain_model.txt"],
    "mental": ["./fatigue_mental_model.txt", "./models/fatigue_mental_model.txt"],
}

models = {}
feature_order_cache = None

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

scaler = None
try:
    import pickle
    for sp in ["./scaler.pkl", "./models/scaler.pkl"]:
        if os.path.exists(sp):
            with open(sp, "rb") as f:
                scaler = pickle.load(f)
            print(f"[OK] Loaded scaler {sp}")
            break
except Exception as e:
    print(f"No scaler: {e}")

def extract_features_ordered(wav_path: str):
    global feature_order_cache
    df = smile.process_file(wav_path)
    if df is None or df.empty:
        raise ValueError("OpenSmile empty")
    row = df.iloc[0].to_dict()
    if feature_order_cache is None:
        feature_order_cache = sorted(row.keys())
        print(f"[INFO] feature count {len(feature_order_cache)}")
    vec = []
    for k in feature_order_cache:
        v = row.get(k, 0.0)
        try:
            fv = float(v)
            if fv != fv or fv in (float("inf"), float("-inf")):
                fv = 0.0
        except:
            fv = 0.0
        vec.append(fv)
    return np.array(vec, dtype=np.float32), feature_order_cache

def adapt_vector_to_model(vec, model):
    expected = model.num_feature()
    cur = len(vec)
    if cur == expected:
        return vec
    elif cur < expected:
        print(f"[WARN] {cur} < {expected}, padding")
        padded = np.zeros(expected, dtype=np.float32)
        padded[:cur] = vec
        return padded
    else:
        return vec[:expected]

def predict_fatigue_from_vec(vec):
    results = {}
    for name, model in models.items():
        adapted = adapt_vector_to_model(vec, model)
        if scaler is not None:
            try:
                adapted = scaler.transform([adapted])[0]
            except:
                pass
        pred = model.predict(np.array([adapted]))[0]
        pred = float(np.clip(pred, 1.0, 5.0))
        results[name] = pred
    if not results:
        raise HTTPException(status_code=500, detail="No models loaded")
    avg_fatigue = float(np.mean(list(results.values())))
    wellbeing = 100 - (avg_fatigue - 1.0) / 4.0 * 100
    wellbeing = float(np.clip(wellbeing, 0, 100))
    def to100(x):
        return float(np.clip((x - 1.0) / 4.0 * 100, 0, 100))
    return {
        "physical_raw": results.get("physical", 3.0),
        "brain_raw": results.get("brain", 3.0),
        "mental_raw": results.get("mental", 3.0),
        "physical": to100(results.get("physical", 3.0)),
        "brain": to100(results.get("brain", 3.0)),
        "mental": to100(results.get("mental", 3.0)),
        "avg_fatigue": avg_fatigue,
        "total": wellbeing,
    }

@app.post("/extract-features")
async def extract_features(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    try:
        vec, keys = extract_features_ordered(tmp_path)
        cleaned = {k: float(v) for k, v in zip(keys, vec)}
        return {"features": cleaned, "vector": vec.tolist(), "count": len(vec)}
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.post("/predict-fatigue")
async def predict_fatigue(file: UploadFile = File(...)):
    if not models:
        raise HTTPException(status_code=500, detail="Models not loaded")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    try:
        vec, _ = extract_features_ordered(tmp_path)
        return predict_fatigue_from_vec(vec)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.post("/predict-from-vector")
async def predict_from_vector(vector: list[float]):
    vec = np.array(vector, dtype=np.float32)
    return predict_fatigue_from_vec(vec)

@app.get("/tts")
async def tts(text: str = Query(..., min_length=1, max_length=400), voice: str = Query("ja-JP-NanamiNeural")):
    if voice.startswith("jf_") or voice == "female":
        voice = "ja-JP-NanamiNeural"
    elif voice.startswith("jm_") or voice == "male":
        voice = "ja-JP-KeitaNeural"
    communicate = edge_tts.Communicate(text, voice)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
        tmp_path = tmp.name
    await communicate.save(tmp_path)
    with open(tmp_path, "rb") as f:
        audio_data = f.read()
    os.remove(tmp_path)
    return Response(content=audio_data, media_type="audio/mpeg", headers={"Cache-Control": "no-cache"})

@app.get("/")
def health_check():
    return {"status": "ok", "models_loaded": list(models.keys()), "scaler": scaler is not None, "feature_count": len(feature_order_cache) if feature_order_cache else None}