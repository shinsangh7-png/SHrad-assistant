import asyncio
import json
import logging

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google.genai import types

from app.config import settings
from app.llm.gemini_client import get_client
from app.stt.gemini_live import build_live_config
from app.stt.model import transcribe_chunk
from app.stt.vad import SpeechSegmenter

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket):
    await websocket.accept()
    mode = websocket.query_params.get("mode", "ko-en")

    if mode == "en":
        await _run_whisper_mode(websocket)
    else:
        await _run_gemini_mode(websocket)


async def _run_whisper_mode(websocket: WebSocket):
    """English-only dictation: local Whisper, VAD-chunked, no network round trip per utterance."""
    segmenter = SpeechSegmenter()
    segment_id = 0
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue[np.ndarray] = asyncio.Queue()

    async def worker():
        nonlocal segment_id
        while True:
            audio = await queue.get()
            segment_id += 1
            sid = segment_id
            try:
                text = await loop.run_in_executor(None, transcribe_chunk, audio, "en")
            except Exception:
                logger.exception("Whisper transcription failed")
                await websocket.send_json({"type": "error", "message": "transcription failed"})
            else:
                if text:
                    await websocket.send_json({"type": "final", "segment_id": sid, "text": text})
            finally:
                queue.task_done()

    worker_task = asyncio.create_task(worker())

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            text_msg = message.get("text")
            bytes_msg = message.get("bytes")

            if text_msg is not None:
                data = json.loads(text_msg)
                if data.get("type") == "stop":
                    audio = segmenter.flush()
                    if audio is not None:
                        queue.put_nowait(audio)
                    await queue.join()
                    await websocket.send_json({"type": "vad_status", "state": "silence"})

            elif bytes_msg is not None:
                pcm_int16 = np.frombuffer(bytes_msg, dtype=np.int16)
                pcm_float32 = pcm_int16.astype(np.float32) / 32768.0

                prev_state = segmenter.state
                finalized = segmenter.feed(pcm_float32)
                if segmenter.state != prev_state:
                    await websocket.send_json({"type": "vad_status", "state": segmenter.state})
                for audio in finalized:
                    queue.put_nowait(audio)

    except WebSocketDisconnect:
        logger.info("Transcription client disconnected")
    finally:
        worker_task.cancel()


async def _run_gemini_mode(websocket: WebSocket):
    """Mixed Korean/English dictation: streamed to Gemini Live for code-switching accuracy."""
    if not settings.gemini_api_key:
        await websocket.send_json({"type": "error", "message": "GEMINI_API_KEY가 설정되지 않았습니다."})
        await websocket.close()
        return

    segmenter = SpeechSegmenter()  # kept only to drive the mic speech/silence UI pulse
    segment_id = 0
    client = get_client()

    try:
        async with client.aio.live.connect(model=settings.gemini_live_model, config=build_live_config()) as session:

            async def receiver():
                nonlocal segment_id
                # session.receive() yields messages for ONE turn and then its generator ends —
                # it must be re-entered after every turn to keep receiving subsequent ones, or
                # transcription silently stops after the first utterance.
                while True:
                    async for msg in session.receive():
                        content = msg.server_content
                        transcription = content.input_transcription if content else None
                        text = (transcription.text or "").strip() if transcription else ""
                        if text:
                            segment_id += 1
                            await websocket.send_json({"type": "final", "segment_id": segment_id, "text": text})

            receiver_task = asyncio.create_task(receiver())

            try:
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        break
                    text_msg = message.get("text")
                    bytes_msg = message.get("bytes")

                    if text_msg is not None:
                        data = json.loads(text_msg)
                        if data.get("type") == "stop":
                            await session.send_realtime_input(audio_stream_end=True)
                            await asyncio.sleep(1.0)  # let any in-flight transcription flush
                            await websocket.send_json({"type": "vad_status", "state": "silence"})

                    elif bytes_msg is not None:
                        pcm_int16 = np.frombuffer(bytes_msg, dtype=np.int16)
                        pcm_float32 = pcm_int16.astype(np.float32) / 32768.0

                        prev_state = segmenter.state
                        segmenter.feed(pcm_float32)
                        if segmenter.state != prev_state:
                            await websocket.send_json({"type": "vad_status", "state": segmenter.state})

                        await session.send_realtime_input(
                            audio=types.Blob(data=bytes_msg, mime_type="audio/pcm;rate=16000")
                        )

            except WebSocketDisconnect:
                logger.info("Transcription client disconnected")
            finally:
                receiver_task.cancel()

    except Exception:
        logger.exception("Gemini Live session failed")
        try:
            await websocket.send_json({"type": "error", "message": "transcription session failed"})
        except Exception:
            pass
