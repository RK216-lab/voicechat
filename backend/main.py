import os
import tempfile
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import opensmile
import edge_tts

app = FastAPI(title="OpenSmile + Edge TTS")

# CORS（GitHub Pages / Vercelからのアクセスを許可）
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

@app.post("/extract-features")
async def extract_features(file: UploadFile = File(...)):
    # 一時ファイルとして保存
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        df = smile.process_file(tmp_path)
        features = df.iloc[0].to_dict()

        # NaN / Inf を除去
        cleaned = {}
        for k, v in features.items():
            try:
                val = float(v)
                if val != val or val == float("inf") or val == float("-inf"):
                    cleaned[k] = 0.0
                else:
                    cleaned[k] = val
            except Exception:
                cleaned[k] = 0.0

        return cleaned
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.get("/tts")
async def tts(
    text: str = Query(..., min_length=1, max_length=400),
    voice: str = Query("ja-JP-NanamiNeural")
):
    """
    無料の Microsoft Edge TTS
    おすすめボイス:
      ja-JP-NanamiNeural  ← 女性・自然（デフォルト）
      ja-JP-KeitaNeural   ← 男性
    """
    try:
        communicate = edge_tts.Communicate(text, voice)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            tmp_path = tmp.name

        await communicate.save(tmp_path)

        with open(tmp_path, "rb") as f:
            audio_data = f.read()

        os.remove(tmp_path)

        return Response(
            content=audio_data,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/")
def health_check():
    return {"status": "ok", "service": "OpenSmile + Edge TTS"}