# app.py
import streamlit as st
import tempfile
import os
import asyncio
import traceback
import edge_tts

st.set_page_config(page_title="Streamlit TTS Demo", layout="centered")

st.title("🎙️ Streamlit TTS（edge-tts）デモ")
st.write("テキストを入力して「合成」ボタンを押すと、サーバー側で MP3 を生成して再生します。")

voice = st.selectbox("Voice", ["ja-JP-NanamiNeural", "ja-JP-AoiNeural", "en-US-AriaNeural"], index=0)
text = st.text_area("読み上げるテキスト", value="こんにちは。これは Streamlit と edge-tts のデモです。", height=120)

def synthesize_to_file(text: str, voice: str, out_path: str):
    """
    edge-tts を使って out_path に mp3 を保存する（同期的に呼べるように asyncio.run を使う）
    """
    async def _run():
        communicate = edge_tts.Communicate(text=text, voice=voice)
        await communicate.save(out_path)

    # 既にイベントループが動いている環境では asyncio.run が RuntimeError を出すことがある。
    # まず asyncio.run を試し、失敗したら新しいループを作って実行する。
    try:
        asyncio.run(_run())
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            loop.run_until_complete(_run())
        finally:
            try:
                loop.close()
            except Exception:
                pass

def synthesize_tts_bytes(text: str, voice: str) -> bytes:
    tmp = tempfile.mktemp(suffix=".mp3")
    try:
        synthesize_to_file(text, voice, tmp)
        with open(tmp, "rb") as f:
            data = f.read()
        return data
    finally:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass

if st.button("合成して再生"):
    if not text.strip():
        st.warning("テキストを入力してください。")
    else:
        try:
            with st.spinner("音声合成中..."):
                audio_bytes = synthesize_tts_bytes(text, voice)
            st.success("合成完了")
            st.audio(audio_bytes, format="audio/mp3")
            # 任意でダウンロードリンクを表示
            st.download_button("MP3をダウンロード", data=audio_bytes, file_name="tts.mp3", mime="audio/mpeg")
        except Exception as e:
            st.error("TTS合成に失敗しました。ログを確認してください。")
            st.exception(e)
            st.code(traceback.format_exc(), language="python")
