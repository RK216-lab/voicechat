# app.py
import os
import io
import asyncio
import tempfile
import hashlib
import traceback
from pathlib import Path
from typing import List, Tuple

import streamlit as st

# 外部サービス
from groq import Groq
import edge_tts

# マイク拡張（任意）
try:
    from streamlit_mic_recorder import mic_recorder
except Exception:
    mic_recorder = None


# -----------------------------
# UIとテーマ
# -----------------------------
st.set_page_config(page_title="音声AIアシスタント", page_icon="🎙️", layout="centered")
st.markdown("""
<style>
.stApp { max-width: 900px; margin: 0 auto; background: linear-gradient(180deg, #0f172a 0%, #111827 100%); color: white; }
.title-box { text-align: center; padding: 1rem 0 1.2rem 0; }
.card {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 20px;
    padding: 18px;
    backdrop-filter: blur(10px);
    box-shadow: 0 8px 30px rgba(0,0,0,0.18);
}
.user-msg {
    background: linear-gradient(135deg, #2563eb, #3b82f6);
    color: white; padding: 12px 14px; border-radius: 16px 16px 4px 16px;
    margin: 10px 0; max-width: 82%; margin-left: auto;
    white-space: pre-wrap;
}
.ai-msg {
    background: rgba(255,255,255,0.10);
    color: #f9fafb; padding: 12px 14px; border-radius: 16px 16px 16px 4px;
    margin: 10px 0; max-width: 82%;
    white-space: pre-wrap;
}
.small-note { color: #cbd5e1; font-size: 0.92rem; }
.section-title { color: white; font-size: 1.05rem; margin: 0.5rem 0; }
button[kind="primary"] { border-radius: 999px !important; }
</style>
""", unsafe_allow_html=True)

st.markdown(
    '<div class="title-box"><h1>🎙️ 音声AIアシスタント</h1><p class="small-note">ボイチャ風UI / 音声入力 / TTS読み上げ</p></div>',
    unsafe_allow_html=True
)


# -----------------------------
# セッション状態
# -----------------------------
if "messages" not in st.session_state:
    # List[Tuple[role, content]] 例: [("user","こんにちは"), ("ai","やあ")]
    st.session_state.messages: List[Tuple[str, str]] = []

if "turn_count" not in st.session_state:
    st.session_state.turn_count = 0

if "done" not in st.session_state:
    st.session_state.done = False

if "last_audio_bytes" not in st.session_state:
    st.session_state.last_audio_bytes: bytes | None = None

if "groq_api_key" not in st.session_state:
    st.session_state.groq_api_key = os.getenv("GROQ_API_KEY", "").strip()

if "voice" not in st.session_state:
    st.session_state.voice = "ja-JP-NanamiNeural"

if "last_processed_audio_id" not in st.session_state:
    st.session_state.last_processed_audio_id = None


# -----------------------------
# 定数
# -----------------------------
VOICES = ["ja-JP-NanamiNeural", "ja-JP-AoiNeural", "ja-JP-KeitaNeural", "ja-JP-TakumiNeural"]
TRANSCRIBE_MODELS = [
    "whisper-large-v3-turbo",
    "whisper-large-v3",
    "distil-whisper-large-v3",
]

# -----------------------------
# ヘルパー
# -----------------------------
def get_system_prompt(turn_count: int) -> str:
    if turn_count == 0:
        return "あなたは日本語で話すフレンドリーな音声AIです。会話は3ターンで終了する。1回目は『今日どんな感じ？』と自然に聞く。返答は短く、やさしく、1〜2文。"
    elif turn_count == 1:
        return "あなたは日本語で話すフレンドリーな音声AIです。会話は3ターンで終了する。2回目は相手の話に共感し、少しだけ深掘りする質問をする。返答は短く、やさしく、1〜2文。"
    else:
        return "あなたは日本語で話すフレンドリーな音声AIです。会話は3ターンで終了する。3回目は『そうだったんだね』のように共感し、『今日はここまでだよ、じゃあね』と自然に締める。返答は短く、やさしく、1〜2文。"

def build_messages(user_text: str):
    msgs = [{"role": "system", "content": get_system_prompt(st.session_state.turn_count)}]
    for role, content in st.session_state.messages:
        role_name = "assistant" if role in ["ai", "assistant"] else "user"
        msgs.append({"role": role_name, "content": content})
    msgs.append({"role": "user", "content": user_text})
    return msgs

def get_client() -> Groq:
    key = st.session_state.groq_api_key.strip()
    if not key:
        raise ValueError("Groq APIキーを入力してください。")
    return Groq(api_key=key)

def ask_groq(user_text: str) -> str:
    client = get_client()
    try:
        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=build_messages(user_text),
            temperature=0.7,
            max_tokens=256,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception as e:
        raise RuntimeError(f"Groq呼び出しに失敗: {e}")

def guess_audio_suffix(b: bytes) -> str:
    # RIFF....WAVE = wav, 1A 45 DF A3 = webm/mkv, 4F 67 67 53 = ogg
    if len(b) >= 12 and b[0:4] == b"RIFF" and b[8:12] == b"WAVE":
        return ".wav"
    if len(b) >= 4 and b[0:4] == bytes([0x1A, 0x45, 0xDF, 0xA3]):
        return ".webm"
    if len(b) >= 4 and b[0:4] == b"OggS":
        return ".ogg"
    # デフォルトはwebm想定
    return ".webm"

def transcribe_audio(audio_bytes: bytes) -> str:
    if not audio_bytes:
        return ""
    client = get_client()
    suffix = guess_audio_suffix(audio_bytes)
    # 一時ファイルに書き出して送信
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        last_err = None
        for model_name in TRANSCRIBE_MODELS:
            try:
                with open(tmp_path, "rb") as f:
                    result = client.audio.transcriptions.create(
                        model=model_name,
                        file=f,
                        language="ja",
                        response_format="json",
                    )
                text = getattr(result, "text", "")
                if text:
                    return text.strip()
            except Exception as e:
                last_err = e
                continue
        if last_err:
            raise RuntimeError(f"音声認識に失敗しました: {last_err}")
        return ""
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

async def edge_tts_to_file(text: str, voice: str, out_path: str):
    communicate = edge_tts.Communicate(text=text, voice=voice)
    await communicate.save(out_path)

def synthesize_tts_bytes(text: str, voice: str) -> bytes:
    # 一時ファイルに保存 → 読み出して削除 → bytesを返す
    out_path = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3").name

    async def _run():
        await edge_tts_to_file(text, voice, out_path)

    # まずは専用ループで実行（Streamlitで安定）
    try:
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_run())
        finally:
            loop.close()
    except Exception:
        # フォールバック：現在のループで実行
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # 走行中ループ → 新規ループでスレッド実行
                import threading
                err: list[Exception] = []
                def worker():
                    try:
                        asyncio.run(_run())
                    except Exception as e:
                        err.append(e)
                t = threading.Thread(target=worker, daemon=True)
                t.start()
                t.join()
                if err:
                    raise RuntimeError(f"TTS生成に失敗しました: {err[0]}")
            else:
                loop.run_until_complete(_run())
        except Exception as e:
            raise RuntimeError(f"TTS生成に失敗しました: {e}")

    try:
        with open(out_path, "rb") as f:
            data = f.read()
        return data
    finally:
        try:
            os.remove(out_path)
        except Exception:
            pass


# -----------------------------
# サイドバー（設定とテスト）
# -----------------------------
with st.sidebar:
    st.header("設定")
    st.session_state.groq_api_key = st.text_input("Groq API Key", type="password", value=st.session_state.groq_api_key)
    st.session_state.voice = st.selectbox(
        "TTS Voice",
        VOICES,
        index=VOICES.index(st.session_state.voice) if st.session_state.voice in VOICES else 0,
    )

    col1, col2 = st.columns(2)
    with col1:
        if st.button("TTSテスト（こんにちは）", use_container_width=True):
            try:
                data = synthesize_tts_bytes("こんにちは。テストです。", st.session_state.voice)
                st.audio(data, format="audio/mp3")
            except Exception as e:
                st.error("TTSテスト失敗")
                st.exception(e)
                st.code(traceback.format_exc(), language="python")
    with col2:
        if st.button("Groqテスト（ping）", use_container_width=True):
            try:
                st.write(ask_groq("テスト。1行で返して。"))
            except Exception as e:
                st.error("Groqテスト失敗")
                st.exception(e)
                st.code(traceback.format_exc(), language="python")

    if st.button("会話をリセット", use_container_width=True):
        st.session_state.messages = []
        st.session_state.turn_count = 0
        st.session_state.done = False
        st.session_state.last_audio_bytes = None
        st.session_state.last_processed_audio_id = None
        st.rerun()


# -----------------------------
# 会話ログ
# -----------------------------
st.markdown('<div class="card">', unsafe_allow_html=True)
st.markdown("### 会話ログ")
if not st.session_state.messages:
    st.info("マイクを押して話しかけるか、テキストで送ってください。")

for role, content in st.session_state.messages:
    if role == "user":
        st.markdown(f'<div class="user-msg">🧑 {content}</div>', unsafe_allow_html=True)
    else:
        st.markdown(f'<div class="ai-msg">🤖 {content}</div>', unsafe_allow_html=True)

if st.session_state.last_audio_bytes:
    st.audio(st.session_state.last_audio_bytes, format="audio/mp3")
    if st.session_state.done:
        st.success("今日はここまでだよ、じゃあね。")
st.markdown('</div>', unsafe_allow_html=True)


# -----------------------------
# 入力UI
# -----------------------------
st.markdown('<div class="card" style="margin-top: 16px;">', unsafe_allow_html=True)
st.markdown("### 入力")

# マイク（ある場合のみ）
if mic_recorder is not None and not st.session_state.done:
    audio = mic_recorder(
        start_prompt="🎙️ 録音開始",
        stop_prompt="⏹️ 録音停止",
        just_once=False,
        use_container_width=True,
        key="mic",
    )
else:
    if mic_recorder is None:
        st.warning("`streamlit-mic-recorder` が入っていないため、テキスト入力のみ使えます。")
    audio = None

# テキストフォーム
with st.form(key="text_form", clear_on_submit=True):
    text_input = st.text_input("テキストで送る", key="manual_text", disabled=st.session_state.done)
    send = st.form_submit_button("送信", disabled=st.session_state.done)
st.markdown('</div>', unsafe_allow_html=True)


# -----------------------------
# メイン処理
# -----------------------------
def process_user_text(user_text: str):
    if not user_text.strip() or st.session_state.done:
        return
    st.session_state.messages.append(("user", user_text))
    try:
        with st.spinner("AIが返信中..."):
            ai_text = ask_groq(user_text)
        st.session_state.messages.append(("ai", ai_text))
        st.session_state.turn_count += 1

        with st.spinner("音声生成中..."):
            data = synthesize_tts_bytes(ai_text, st.session_state.voice)
            st.session_state.last_audio_bytes = data
    except Exception as e:
        st.error("エラーが発生しました")
        st.exception(e)
        st.code(traceback.format_exc(), language="python")
        return

    if st.session_state.turn_count >= 3:
        st.session_state.done = True
    st.rerun()


# テキスト送信
if send and text_input.strip():
    process_user_text(text_input.strip())

# 音声送信
if audio and not st.session_state.done:
    audio_bytes = audio.get("bytes") if isinstance(audio, dict) else None
    if audio_bytes:
        # 重複処理を避けるためハッシュで判定
        audio_hash = hashlib.sha1(audio_bytes).hexdigest()
        if audio_hash != st.session_state.last_processed_audio_id:
            st.session_state.last_processed_audio_id = audio_hash
            try:
                with st.spinner("音声認識中..."):
                    user_text = transcribe_audio(audio_bytes)
                if user_text:
                    process_user_text(user_text)
            except Exception as e:
                st.error("音声認識エラー")
                st.exception(e)
                st.code(traceback.format_exc(), language="python")
