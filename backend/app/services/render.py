"""Demo export: beats + paced clips (+ optional TTS narration) -> one MP4, with FFmpeg.

Per beat: if narration is on, synthesize the beat text and use its real duration as the beat length,
scaling the beat's paced clip durations proportionally (so visuals change with the voice); otherwise
use the pacing durations as given. Each clip is trimmed from its start (no content search), scaled/
padded to 1280x720@30fps; clips shorter than their slot hold the last frame. Segments are joined and
the narration track is muxed in.

Clips are referenced by asset_key ("pixabay:10447"): local files come from the library; cloud clips
are downloaded to DATA_DIR/cache/remote/ at export time (Pixabay allows downloading its videos).
"""

import json
import logging
import re
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Video
from app.providers.errors import ProviderError
from app.providers.tts.base import TTSProvider
from app.providers.video_source.base import VideoSourceProvider
from app.services.frames import FrameExtractionError, _tool

log = logging.getLogger(__name__)

WIDTH, HEIGHT, FPS = 1280, 720, 30
_ASSET_KEY = re.compile(r"^([a-z]+):([A-Za-z0-9_-]{1,128})$")


class RenderError(ProviderError):
    """Client-safe export failure."""


@dataclass
class ClipSlot:
    asset_key: str
    seconds: float


@dataclass
class BeatSlot:
    text: str
    clips: list[ClipSlot]


def _ffmpeg(args: list[str], timeout: float = 300) -> str:
    try:
        exe = _tool("ffmpeg") if args[0] == "ffmpeg" else _tool("ffprobe")
    except FrameExtractionError as exc:
        raise RenderError(str(exc)) from None
    try:
        result = subprocess.run([exe, *args[1:]], capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise RenderError("Video rendering timed out") from None
    if result.returncode != 0:
        log.warning("ffmpeg failed: %s", result.stderr[-400:])
        raise RenderError("Video rendering failed (FFmpeg error)")
    return result.stdout


def media_duration(path: Path) -> float:
    out = _ffmpeg(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)], 60)
    try:
        return float(json.loads(out)["format"]["duration"])
    except (KeyError, ValueError, TypeError):
        raise RenderError(f"Could not read the duration of {path.name}") from None


def resolve_clip_file(session: Session, data_dir: Path, asset_key: str,
                      clouds: dict[str, VideoSourceProvider | None]) -> Path:
    """Local library file for the asset, or a cached download of the cloud clip."""
    match = _ASSET_KEY.match(asset_key)
    if not match:
        raise RenderError(f"Invalid clip id '{asset_key}'")
    provider, source_id = match.groups()
    video = session.scalar(select(Video).where(Video.source_provider == provider, Video.source_id == source_id))
    if video is not None and video.local_path:
        path = (data_dir / video.local_path).resolve()
        if path.is_relative_to(data_dir.resolve()) and path.is_file():
            return path
    cached = data_dir / "cache" / "remote" / f"{provider}_{source_id}.mp4"
    if cached.is_file():
        return cached
    source = clouds.get(provider)
    if source is None:
        raise RenderError(f"Clip {asset_key} is not in the local library and {provider} is not enabled")
    candidate = source.get(source_id)
    if candidate is None or not candidate.video_url:
        raise RenderError(f"Clip {asset_key} is no longer available from {provider}")
    cached.parent.mkdir(parents=True, exist_ok=True)
    partial = cached.with_suffix(".part")
    try:
        with httpx.stream("GET", candidate.video_url, timeout=60, follow_redirects=True) as response:
            response.raise_for_status()
            with partial.open("wb") as f:
                for chunk in response.iter_bytes():
                    f.write(chunk)
    except httpx.HTTPError:
        partial.unlink(missing_ok=True)
        raise RenderError(f"Could not download clip {asset_key} from {provider}") from None
    partial.replace(cached)
    return cached


def render_video(session: Session, data_dir: Path, beats: list[BeatSlot], tts: TTSProvider | None,
                 voice_id: str | None, clouds: dict[str, VideoSourceProvider | None]) -> Path:
    if not any(b.clips for b in beats):
        raise RenderError("There are no clips to render")
    out_dir = data_dir / "exports"
    out_dir.mkdir(parents=True, exist_ok=True)
    output = out_dir / f"script2broll_{uuid.uuid4().hex[:10]}.mp4"
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        segments: list[Path] = []
        audio_parts: list[Path] = []
        for i, beat in enumerate(beats):
            clips = [c for c in beat.clips if c.seconds > 0]
            if not clips:
                continue
            planned = sum(c.seconds for c in clips)
            scale = 1.0
            if tts is not None and voice_id and beat.text.strip():
                audio = tts.synthesize(beat.text, voice_id, tmp / f"beat_{i:03d}.mp3")
                spoken = media_duration(audio)
                audio_parts.append(audio)
                scale = spoken / planned if planned > 0 else 1.0
            for j, clip in enumerate(clips):
                seconds = max(clip.seconds * scale, 0.5)
                source = resolve_clip_file(session, data_dir, clip.asset_key, clouds)
                segment = tmp / f"seg_{i:03d}_{j:02d}.mp4"
                vf = (f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
                      f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={FPS},"
                      f"tpad=stop_mode=clone:stop_duration={seconds:.2f},format=yuv420p")
                _ffmpeg(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-t", f"{seconds:.3f}", "-vf", vf,
                         "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", str(segment)])
                segments.append(segment)
        listing = tmp / "segments.txt"
        listing.write_text("".join(f"file '{s.as_posix()}'\n" for s in segments), encoding="utf-8")
        silent = tmp / "video.mp4"
        _ffmpeg(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(silent)])
        if audio_parts:
            audio_list = tmp / "audio.txt"
            audio_list.write_text("".join(f"file '{a.as_posix()}'\n" for a in audio_parts), encoding="utf-8")
            narration = tmp / "narration.m4a"
            _ffmpeg(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(audio_list),
                     "-c:a", "aac", "-b:a", "160k", str(narration)])
            _ffmpeg(["ffmpeg", "-v", "error", "-y", "-i", str(silent), "-i", str(narration), "-map", "0:v", "-map", "1:a",
                     "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", str(output)])
        else:
            _ffmpeg(["ffmpeg", "-v", "error", "-y", "-i", str(silent), "-c", "copy", "-movflags", "+faststart", str(output)])
    if not output.is_file():
        raise RenderError("Video rendering produced no file")
    return output


def clip_download_path(session: Session, data_dir: Path, asset_key: str,
                       clouds: dict[str, VideoSourceProvider | None]) -> Path:
    return resolve_clip_file(session, data_dir, asset_key, clouds)

