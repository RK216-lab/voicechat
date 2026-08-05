import os
import tempfile
import asyncio
from pathlib import Path

import streamlit as st
from groq import Groq
import edge_tts

try:
    from streamlit_mic_recorder import mic_recorder
except Exception:
    mic_recorder = None

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
}
.ai-msg {
    background: rgba(255,255,255,0.10);
    color: #f9fafb; padding: 12px 14px; border-radius: 16px 16px 16px 4px;
    margin: 10px 0; max-width: 82%;
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

if "messages" not in st.session_state:
    st.session_state.messages = []
if "turn_count" not in st.session_state:
    st.session_state.turn_count = 0
if "done" not in st.session_state:
    st.session_state.done = False
if "last_audio_path" not in st.session_state:
    st.session_state.last_audio_path = None
if "groq_api_key" not in st.session_state:
    st.session_state.groq_api_key = os.getenv("GROQ_API_KEY", "")
if "voice" not in st.session_state:
    st.session_state.voice = "ja-JP-NanamiNeural"
if "last_processed_audio_id" not in st.session_state:
    st.session_state.last_processed_audio_id = None

def get_system_prompt(turn_count: int) -> str:
    if turn_count == 0:
        return "あなたは日本語で話すフレンドリーな音声AIです。会話は3ターンで終了する。1回目は『今日どんな感じ？』と自然に聞く。返答は短く、やさしく、1〜2文。"
    elif turn_count == 1:
        return "あなたは日本語で話すフレンドリーな音声AIです。会話は3ターンで終了する。2回目は相手の話に共感し、少しだけ深掘りする質問をする。返答は短く、やさしく、1〜2文。"
    else:
        return "あなたは日本語で話すフレンドリーな音声AIです。会話は3ターンで終了する。3回目は『そうだったんだね』のように共感し、『今日はここまでだよ、じゃあね』と自然に締める。返答は短く、やさしく、1〜2文。"

def build_messages(user_text: str):
    messages = [{"role": "system", "content": get_system_prompt(st.session_state.turn_count)}]
    for role, content in st.session_state.messages:
        role_name = "assistant" if role in ["ai", "assistant"] else "user"
        messages.append({"role": role_name, "content": content})
    messages.append({"role": "user", "content": user_text})
    return messages

def get_client():
    key = st.session_state.groq_api_key.strip()
    if not key:
        raise ValueError("Groq APIキーを入力してください。")
    return Groq(api_key=key)

def ask_groq(user_text: str) -> str:
    client = get_client()
    resp = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=build_messages(user_text),
        temperature=0.7,
    )
    return resp.choices[0].message.content.strip()

def transcribe_audio(audio_bytes: bytes) -> str:
    client = get_client()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        with open(tmp_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-large-v3-turbo",
                file=audio_file,
                language="ja"
            )
        return transcription.text.strip()
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

async def edge_tts_to_file(text: str, voice: str, out_path: str):
    communicate = edge_tts.Communicate(text=text, voice=voice)
    await communicate.save(out_path)

def synthesize_tts(text: str, voice: str):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
    tmp.close()
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(edge_tts_to_file(text, voice, tmp.name))
        loop.close()
    except Exception:
        try:
            loop = asyncio.get_event_loop()
            loop.run_until_complete(edge_tts_to_file(text, voice, tmp.name))
        except Exception as e:
            raise RuntimeError(f"TTS生成に失敗しました: {e}")
    return tmp.name

with st.sidebar:
    st.header("設定")
    st.session_state.groq_api_key = st.text_input("Groq API Key", type="password", value=st.session_state.groq_api_key)
    st.session_state.voice = st.selectbox(
        "TTS Voice",
        ["ja-JP-NanamiNeural", "ja-JP-AoiNeural", "ja-JP-KeitaNeural", "ja-JP-TakumiNeural"],
        index=["ja-JP-NanamiNeural", "ja-JP-AoiNeural", "ja-JP-KeitaNeural", "ja-JP-TakumiNeural"].index(st.session_state.voice) if st.session_state.voice in ["ja-JP-NanamiNeural", "ja-JP-AoiNeural", "ja-JP-KeitaNeural", "ja-JP-TakumiNeural"] else 0
    )
    if st.button("会話をリセット"):
        st.session_state.messages = []
        st.session_state.turn_count = 0
        st.session_state.done = False
        st.session_state.last_audio_path = None
        st.session_state.last_processed_audio_id = None
        st.rerun()

st.markdown('<div class="card">', unsafe_allow_html=True)
st.markdown("### 会話ログ")
if not st.session_state.messages:
    st.info("マイクを押して話しかけてください。")
for role, content in st.session_state.messages:
    if role == "user":
        st.markdown(f'<div class="user-msg">🧑 {content}</div>', unsafe_allow_html=True)
    else:
        st.markdown(f'<div class="ai-msg">🤖 {content}</div>', unsafe_allow_html=True)

if st.session_state.last_audio_path and Path(st.session_state.last_audio_path).exists():
    st.audio(st.session_state.last_audio_path, format="audio/mp3")
    if st.session_state.done:
        st.success("今日はここまでだよ、じゃあね。")
st.markdown('</div>', unsafe_allow_html=True)

st.markdown('<div class="card" style="margin-top: 16px;">', unsafe_allow_html=True)
st.markdown("### 入力")
if mic_recorder is not None and not st.session_state.done:
    audio = mic_recorder(start_prompt="🎙️ 録音開始", stop_prompt="⏹️ 録音停止", just_once=False, use_container_width=True, key="mic")
else:
    if mic_recorder is None:
        st.warning("`streamlit-mic-recorder` が入っていないため、テキスト入力のみ使えます。")
    audio = None

with st.form(key="text_form", clear_on_submit=True):
    text_input = st.text_input("テキストで送る", key="manual_text", disabled=st.session_state.done)
    send = st.form_submit_button("送信", disabled=st.session_state.done)
st.markdown('</div>', unsafe_allow_html=True)

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
            audio_path = synthesize_tts(ai_text, st.session_state.voice)
            st.session_state.last_audio_path = audio_path
    except Exception as e:
        st.error(f"エラーが発生しました: {e}")
        return
    if st.session_state.turn_count >= 3:
        st.session_state.done = True
    st.rerun()

if send and text_input.strip():
    process_user_text(text_input.strip())

if audio and not st.session_state.done:
    audio_id = id(audio.get("bytes"))
    if audio_id != st.session_state.last_processed_audio_id:
        st.session_state.last_processed_audio_id = audio_id
        try:
            with st.spinner("音声認識中..."):
                user_text = transcribe_audio(audio["bytes"])
            if user_text:
                process_user_text(user_text)
        except Exception as e:
            st.error(f"音声認識エラー: {e}")
