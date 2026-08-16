# Restee 統合アプリ構成

## フォルダ構成
```
restee-app/
├── index.html          # エントリ (home.htmlへリダイレクト)
├── home.html           # ホーム - 最新スコア表示 / おすすめケア
├── scan.html           # スキャン - 旧index.htmlのAI疲労診断を統合
├── learn.html          # 知る - 記事検索・フィルタ
├── care.html           # ケア - 疲労タイプに応じたおすすめソート
├── profile.html        # 私 - 履歴・プロフィール
├── style.css           # 共通スタイル (旧style.css + スキャン用wave-dot等統合)
├── js/
│   ├── app.js          # ★全体連携ロジック (localStorageで画面間データ共有)
│   ├── scan.js         # スキャン機能 (Moonshine ASR + embedding + LightGBMアンサンブル)
│   └── script.js       # モーダル・ケアカード共通
└── backend/
    ├── main.py         # FastAPI (predict-fatigue / extract-features / tts)
    ├── scaler_91.json
    ├── fatigue_*.txt   # LightGBMモデル3種
    ├── requirements.txt
    └── chat.js         # Groq LLMプロキシ (/api/chat)
```

## 相互動作の仕組み
1. **スキャン → 保存**: scan.htmlで会話終了後、`scoreWithFallback()`がバックエンド `/predict-fatigue` に音声+テキストを送信。結果を `ResteeApp.saveScanResult()` で `localStorage: restee_last_scan / restee_history` に保存
2. **ホーム**: `app.js`の`updateHomeUI()`がlocalStorageを読み、円グラフ・メッセージ・ステータスバッジを更新
3. **ケア**: `getDominantType()`で最も高い疲労軸を判定し、バッジ表示とカードの並び替えを実行
4. **プロフィール**: 履歴をリスト表示、最新スコアカードも表示。リセットボタン付き
5. **知る**: 検索入力とタグフィルタで記事を絞り込み。ケアモーダルは共通script.jsで動作

## バックエンド連携
- `BACKEND_URL` は `js/scan.js` 内で定義。現在 `https://voicechat-9w4o.onrender.com`
- ローカルで動かす場合: `uvicorn backend.main:app --reload` し、scan.jsのURLを `http://localhost:8000` に変更
- フロントは静的ファイルなので、Vercel/Renderで `restee-app` フォルダをデプロイすればOK。 `/api/chat` は `backend/chat.js` を `api/chat.js` として配置

## まだダミーの部分
- learn/careの記事データは静的。今後API化可能
- careの評価(rate)はローカル完結。バックエンドに送るなら `/api/rate` を追加

## 起動方法
```bash
# バックエンド
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# フロント (Live Serverやpython -m http.server)
cd restee-app
python -m http.server 5500
# http://localhost:5500/home.html を開く
```
