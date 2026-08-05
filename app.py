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
.stApp { max-width: 900px; margin: 0 auto; }
.title-box { text-align: center; padding: 0.5rem 0 1rem 0; }
.user-msg { background: #2563eb; color: white; padding: 12px 14px; border-radius: 14px 14px 4px 14px; margin: 10px 0; max-width: 80%; margin-left: auto; }
.ai-msg { background: #f3f4f6; color: #111827; padding: 12px 14px; border-radius: 14px 14px 14px 4px; margin: 10px 0; max-width: 80%; }
.small-note { color: #6b7280; font-size: 0.9rem; }
</style>
""", unsafe_allow_html=True)

st.markdown('<div class="title-box"><h1>🎙️ 音声AIアシスタント</h1><p class="small-note">3ターンで自然に終わる会話 + edge-tts 読み上げ</p></div>', unsafe_allow_html=True)

# セッション状態
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

def get_system_prompt(turn_count: int) -> str:
    if turn_count == 0:
        return "あなたは日本語で話すフレンドリーな音声AIです。会話は3ターンで終了する。1回目は『今日どんな感じ？』と自然に聞く。返答は短く、やさしく、1〜2文。"
    elif turn_count == 1:
        return "あなたは日本語で話すフレンドリーな音声AIです。会話は3ターンで終了する。2回目は相手の話に共感し、少しだけ深掘りする質問をする。返答は短く、やさしく、1〜2文。"
    else:
        return "あなたは日本語で話すフレンドリーな音声AIです。会話は3ターンで終了する。3回目は『そうだったんだね』のように共感し、『今日はここまでだよ、じゃあね』と自然に締める。返答は短く、やさしく、1〜2文。"

def build_messages(user_text: str):
    return [
        {"role": "system", "content": get_system_prompt(st.session_state.turn_count)},
        {"role": "user", "content": user_text},
    ]

def ask_groq(user_text: str) -> str:
    if not st.session_state.groq_api_key:
        raise ValueError("GROQ APIキーを入力してください。")
    client = Groq(api_key=st.session_state.groq_api_key)
    resp = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=build_messages(user_text),
        temperature=0.7,
    )
    return resp.choices[0].message.content.strip()

# edge-tts（Streamlit安全版）
async def edge_tts_to_file(text: str, voice: str, out_path: str):
    communicate = edge_tts.Communicate(text=text, voice=voice)
    await communicate.save(out_path)

def synthesize_tts(text: str, voice: str):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
    tmp.close()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(edge_tts_to_file(text, voice, tmp.name))

    return tmp.name

with st.sidebar:
    st.header("設定")
    st.text_input("Groq API Key", type="password", key="groq_api_key")
    st.selectbox("TTS Voice", ["ja-JP-NanamiNeural", "ja-JP-AoiNeural", "ja-JP-KeitaNeural", "ja-JP-TakumiNeural"], key="voice")
    if st.button("会話をリセット"):
        st.session_state.messages = []
        st.session_state.turn_count = 0
        st.session_state.done = False
        st.session_state.last_audio_path = None
        st.rerun()

st.markdown("### 会話ログ")
if not st.session_state.messages:
    st.info("マイクを押して話しかけてください。")
for role, content in st.session_state.messages:
    if role == "user":
        st.markdown(f'<div class="user-msg">{content}</div>', unsafe_allow_html=True)
    else:
        st.markdown(f'<div class="ai-msg">{content}</div>', unsafe_allow_html=True)

st.markdown("### 入力")
if mic_recorder is not None and not st.session_state.done:
    audio = mic_recorder(start_prompt="🎙️ 録音開始", stop_prompt="⏹️ 録音停止", just_once=False, use_container_width=True, key="mic")
else:
    st.warning("音声録音コンポーネントが使えないため、下のテキスト入力で試せます。")
    audio = None

text_input = st.text_input("またはテキストで入力", key="manual_text")
send = st.button("送信")

def process_user_text(user_text: str):
    if not user_text.strip() or st.session_state.done:
        return
    st.session_state.messages.append(("user", user_text))
    st.session_state.turn_count += 1
    try:
        ai_text = ask_groq(user_text)
    except Exception as e:
        st.error(f"AI応答エラー: {e}")
        return
    st.session_state.messages.append(("ai", ai_text))
    try:
        audio_path = synthesize_tts(ai_text, st.session_state.voice)
        st.session_state.last_audio_path = audio_path
    except Exception as e:
        st.warning(f"TTS生成に失敗しました: {e}")
        st.session_state.last_audio_path = None
    if st.session_state.turn_count >= 3:
        st.session_state.done = True
    st.rerun()

if send and text_input.strip():
    process_user_text(text_input.strip())

if audio and not st.session_state.done:
    try:
        user_text = str(audio.get("text", "")).strip()
        if user_text:
            process_user_text(user_text)
    except Exception as e:
        st.error(f"音声入力の処理に失敗しました: {e}")

if st.session_state.last_audio_path and Path(st.session_state.last_audio_path).exists():
    st.audio(st.session_state.last_audio_path, format="audio/mp3")
    if st.session_state.done:
        st.success("今日はここまでだよ、じゃあね。")
