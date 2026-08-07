import os
import tempfile
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import opensmile

app = FastAPI(title="OpenSmile eGeMAPS Feature Extractor")

# CORS設定（GitHub Pagesからのアクセスを許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenSmile eGeMAPSv02 エクストラクタの初期化
smile = opensmile.Smile(
    feature_set=opensmile.FeatureSet.eGeMAPSv02,
    feature_level=opensmile.FeatureLevel.Functionals,
)

@app.post("/extract-features")
async def extract_features(file: UploadFile = File(...)):
    if not file.filename.endswith(('.wav', '.webm', '.ogg', '.mp4', '.m4a')):
        # オーディオ形式のチェック
        pass

    # 一時ファイルとして保存
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # OpenSmileによる特徴量抽出
        df = smile.process_file(tmp_path)
        features = df.iloc[0].to_dict()

        # NaNやInfを0.0に置換してJSON互換にする
        cleaned_features = {}
        for k, v in features.items():
            val = float(v)
            if val != val or val == float('inf') or val == float('-inf'):
                cleaned_features[k] = 0.0
            else:
                cleaned_features[k] = val

        return cleaned_features
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.get("/")
def health_check():
    return {"status": "ok", "service": "OpenSmile Extractor"}
