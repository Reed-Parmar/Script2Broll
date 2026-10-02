import pytest

from app.services.frames import FrameExtractionError, probe_video, sample_frames, sample_timestamps
from tests.conftest import make_test_video, requires_ffmpeg


def test_sample_timestamps_are_evenly_spaced_and_deterministic():
    assert sample_timestamps(8.0, 4) == [1.0, 3.0, 5.0, 7.0]
    assert sample_timestamps(10.0, 8) == sample_timestamps(10.0, 8)
    ts = sample_timestamps(10.0, 8)
    assert len(ts) == 8 and 0 < ts[0] and ts[-1] < 10.0


@requires_ffmpeg
def test_probe_and_sample_real_video(tmp_path):
    video = make_test_video(tmp_path / "clip.mp4", seconds=4)

    info = probe_video(video)
    assert info.duration == pytest.approx(4.0, abs=0.2)
    assert (info.width, info.height) == (320, 240)

    frames = sample_frames(video, tmp_path / "frames", 8, info.duration)
    assert len(frames) == 8
    assert all(f.suffix == ".jpg" and f.stat().st_size > 0 for f in frames)


@requires_ffmpeg
def test_corrupt_video_is_rejected(tmp_path):
    corrupt = tmp_path / "corrupt.mp4"
    corrupt.write_bytes(b"this is not a video")
    with pytest.raises(FrameExtractionError):
        probe_video(corrupt)
    with pytest.raises(FrameExtractionError):
        sample_frames(corrupt, tmp_path / "frames", 8)
