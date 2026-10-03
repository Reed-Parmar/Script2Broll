"""Local, offline speech-to-text with faster-whisper (Whisper via CTranslate2). No API key.

The model downloads to the Hugging Face cache on first use, then runs locally (CPU int8 by default).
Audio (mp3, wav, m4a, ogg, ...) is decoded with FFmpeg (already required by the project).
"""

import subprocess
import threading
from functools import lru_cache
from pathlib import Path

from app.providers.errors import ProviderError
from app.providers.transcription.base import Transcript, TranscriptionProvider, TranscriptSegment


@lru_cache(maxsize=2)
def _load(model: str, device: str, compute_type: str):
    from faster_whisper import WhisperModel

    try:
        return WhisperModel(model, device=device, compute_type=compute_type)
    except Exception as exc:  # download/load failure
        raise ProviderError(f"Could not load Whisper model '{model}' ({type(exc).__name__})") from None


_lock = threading.Lock()  # one transcription at a time per process

SAMPLE_RATE = 16000  # what Whisper expects


def _decode(audio_path: Path):
    """Decode any FFmpeg-readable audio (mp3, wav, m4a, ogg, ...) to 16 kHz mono float32 samples.
    FFmpeg is already a project dependency; this avoids faster-whisper's PyAV decoder, which is
    incompatible with recent PyAV releases."""
    import numpy as np

    from app.services.frames import FrameExtractionError, _tool

    try:
        ffmpeg = _tool("ffmpeg")
    except FrameExtractionError as exc:
        raise ProviderError(str(exc)) from None
    result = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(audio_path), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, timeout=300, check=False,
    )
    if result.returncode != 0 or not result.stdout:
        raise ProviderError("Could not decode the audio file (unsupported or corrupt)")
    return np.frombuffer(result.stdout, dtype=np.float32)


class FasterWhisperProvider(TranscriptionProvider):
    name = "faster_whisper"

    def __init__(self, model: str = "base", device: str = "cpu", compute_type: str = "int8"):
        self.model = model
        self._device = device
        self._compute_type = compute_type

    def transcribe(self, audio_path: Path) -> Transcript:
        whisper = _load(self.model, self._device, self._compute_type)
        audio = _decode(audio_path)
        try:
            with _lock:
                segments, info = whisper.transcribe(audio, vad_filter=True)
                parts = [TranscriptSegment(round(s.start, 2), round(s.end, 2), s.text.strip()) for s in segments]
        except Exception as exc:  # unreadable/corrupt audio
            raise ProviderError(f"Could not transcribe the audio ({type(exc).__name__})") from None
        text = " ".join(p.text for p in parts if p.text).strip()
        return Transcript(text=text, language=info.language, duration=round(info.duration, 2), segments=parts)
