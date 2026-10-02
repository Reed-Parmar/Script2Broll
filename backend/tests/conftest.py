import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.config import Settings, get_settings
from app.db.session import get_engine
from app.main import create_app

FAKE_GEMINI_KEY = "test-gemini-key-SHOULD-NOT-LEAK"
FAKE_PIXABAY_KEY = "test-pixabay-key-SHOULD-NOT-LEAK"

requires_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="FFmpeg not on PATH"
)


def make_settings(**overrides) -> Settings:
    """Settings that ignore the developer's real .env file."""
    return Settings(_env_file=None, **overrides)


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def client(settings):
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def db_engine():
    """The real DATABASE_URL database; tests using it are skipped when none is reachable."""
    engine = get_engine()
    try:
        with engine.connect():
            pass
    except OperationalError:
        pytest.skip("No PostgreSQL reachable at DATABASE_URL")
    return engine


def make_test_video(path: Path, seconds: int = 4, color_source: str = "testsrc") -> Path:
    """Generate a small synthetic H.264 clip with FFmpeg."""
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "lavfi", "-i", f"{color_source}=size=320x240:rate=10:duration={seconds}",
            "-pix_fmt", "yuv420p", "-c:v", "libx264", str(path),
        ],
        check=True,
    )
    return path
