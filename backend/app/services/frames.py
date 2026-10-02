"""Frame sampling with FFmpeg: a clip is represented by a few evenly spaced stills."""

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

# Embedding models downscale anyway; smaller frames mean smaller embedding requests.
FRAME_MAX_WIDTH = 512


class FrameExtractionError(Exception):
    pass


def _tool(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise FrameExtractionError(f"{name} not found on PATH (install FFmpeg)")
    return path


def _run(args: list[str]) -> str:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=60, check=False)
    except subprocess.TimeoutExpired:
        raise FrameExtractionError(f"{Path(args[0]).stem} timed out") from None
    if result.returncode != 0:
        raise FrameExtractionError(f"{Path(args[0]).stem} failed: {result.stderr.strip()[-300:]}")
    return result.stdout


@dataclass(frozen=True)
class VideoInfo:
    duration: float
    width: int
    height: int


def probe_video(video_path: Path) -> VideoInfo:
    """Validate the file is a readable video and return its real duration and resolution."""
    output = _run([
        _tool("ffprobe"), "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "json",
        str(video_path),
    ])
    try:
        data = json.loads(output)
        stream = data["streams"][0]
        info = VideoInfo(float(data["format"]["duration"]), int(stream["width"]), int(stream["height"]))
    except (ValueError, KeyError, IndexError, TypeError):
        raise FrameExtractionError(f"{video_path.name} has no readable video stream") from None
    if info.duration <= 0 or info.width <= 0 or info.height <= 0:
        raise FrameExtractionError(f"{video_path.name} has invalid duration/resolution")
    return info


def sample_timestamps(duration: float, count: int) -> list[float]:
    """Centres of `count` equal segments, so the first/last (often fades) are avoided."""
    return [duration * (i + 0.5) / count for i in range(count)]


def sample_frames(video_path: Path, out_dir: Path, count: int, duration: float | None = None) -> list[Path]:
    """Extract `count` evenly spaced JPEG frames from the clip into out_dir (deterministic)."""
    ffmpeg = _tool("ffmpeg")
    out_dir.mkdir(parents=True, exist_ok=True)
    if duration is None:
        duration = probe_video(video_path).duration
    frames = []
    for i, timestamp in enumerate(sample_timestamps(duration, count)):
        frame = out_dir / f"frame_{i:02d}.jpg"
        _run([
            ffmpeg, "-v", "error", "-y",
            "-ss", f"{timestamp:.3f}", "-i", str(video_path),
            "-frames:v", "1",
            "-vf", f"scale='min({FRAME_MAX_WIDTH},iw)':-2",
            "-q:v", "3",
            str(frame),
        ])
        if frame.exists():
            frames.append(frame)
    if not frames:
        raise FrameExtractionError(f"No frames extracted from {video_path.name}")
    return frames
