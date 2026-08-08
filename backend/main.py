import os
import tempfile
import io
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import opensmile

app = FastAPI(title="OpenSmile + Kokoro TTS")

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

# Kokoro TTS pipeline (lazy load)
_kokoro_pipeline = None

def get_kokoro():
    global _kokoro_pipeline
    if _kokoro_pipeline is None:
        try:
            from kokoro import KPipeline
            # 'j' = Japanese
            _kokoro_pipeline = KPipeline(lang_code='j')
        except Exception as e:
            print(f"Kokoro load failed: {e}")
            _kokoro_pipeline = False
    return _kokoro_pipeline


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
    voice: str = Query("jf_alpha")  # Kokoro Japanese female default
):
    """
    Kokoro TTS (軽量82M・高品質日本語)
    おすすめボイス:
      jf_alpha       ← 女性・自然（デフォルト）
      jf_tebukuro
      jf_gongitsune
      jm_kumo        ← 男性
    フォールバック: Edge TTS (ja-JP-NanamiNeural)
    """
    # 1. Try Kokoro first
    pipeline = get_kokoro()
    if pipeline:
        try:
            # voice must match Japanese (jf_ / jm_)
            gen = pipeline(text, voice=voice if voice.startswith(("jf_", "jm_")) else "jf_alpha")
            audio_chunks = []
            for gs, ps, audio in gen:
                audio_chunks.append(audio)
            if audio_chunks:
                full_audio = np.concatenate(audio_chunks)
                # 24kHz float32 → int16 WAV in memory
                import soundfile as sf
                buf = io.BytesIO()
                sf.write(buf, full_audio, 24000, format="WAV", subtype="PCM_16")
                buf.seek(0)
                return Response(
                    content=buf.read(),
                    media_type="audio/wav",
                    headers={"Cache-Control": "no-cache", "X-TTS-Engine": "kokoro"}
                )
        except Exception as e:
            print(f"Kokoro TTS error: {e}")

    # 2. Fallback to Edge TTS
    try:
        import edge_tts
        edge_voice = "ja-JP-NanamiNeural"
        if voice in ("jm_kumo", "male"):
            edge_voice = "ja-JP-KeitaNeural"
        communicate = edge_tts.Communicate(text, edge_voice)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            tmp_path = tmp.name
        await communicate.save(tmp_path)
        with open(tmp_path, "rb") as f:
            audio_data = f.read()
        os.remove(tmp_path)
        return Response(
            content=audio_data,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache", "X-TTS-Engine": "edge"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/")
def health_check():
    engine = "kokoro" if get_kokoro() else "edge (fallback)"
    return {"status": "ok", "service": "OpenSmile + Kokoro TTS", "tts_engine": engine}
