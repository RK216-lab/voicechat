# 追加で必要なパッケージ
# requirements.txt に以下を追記
# edge-tts
# aiofiles

import os
import tempfile
import asyncio
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
import opensmile
import edge_tts

app = FastAPI(title="OpenSmile + Edge TTS")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

smile = opensmile.Smile(
    feature_set=opensmile.FeatureSet.eGeMAPSv02,
    feature_level=opensmile.FeatureLevel.Functionals,
)

# -------------------- 既存の /extract-features はそのまま --------------------
@app.post("/extract-features")
async def extract_features(file: UploadFile = File(...)):
    # ... 既存のコードのまま ...
    pass   # ← 実際は既存の実装を残す

# -------------------- 新規：TTSエンドポイント --------------------
@app.get("/tts")
async def tts(
    text: str = Query(..., min_length=1, max_length=300),
    voice: str = Query("ja-JP-NanamiNeural")  # 女性の自然な声
):
    """
    無料の Microsoft Edge TTS を使用
    対応日本語ボイス例:
      ja-JP-NanamiNeural (女性・おすすめ)
      ja-JP-KeitaNeural  (男性)
      ja-JP-AoiNeural
      ja-JP-DaichiNeural
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