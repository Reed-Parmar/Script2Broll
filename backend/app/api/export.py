"""Demo export: narration voices, narration preview, full-video render, and single-clip download."""

import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.session import get_session
from app.providers import factory
from app.services.render import BeatSlot, ClipSlot, RenderError, clip_download_path, render_video

router = APIRouter(prefix="/v1/export", tags=["export"])


class ClipIn(BaseModel):
    asset_key: str = Field(max_length=200)
    seconds: float = Field(gt=0, le=60)


class BeatIn(BaseModel):
    text: str = Field(default="", max_length=2000)
    clips: list[ClipIn] = Field(default=[], max_length=10)


class RenderRequest(BaseModel):
    beats: list[BeatIn] = Field(min_length=1, max_length=40)
    narration: bool = True
    voice: str | None = None  # voice preset id; default = deep male narrator


class NarrationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice: str | None = None


@router.get("/voices")
def voices(settings: Settings = Depends(get_settings)) -> dict:
    from app.providers.tts.edge import DEFAULT_VOICE

    tts = factory.build_tts_provider(settings)
    return {"default": DEFAULT_VOICE, "voices": [{"id": v.id, "label": v.label} for v in tts.voices()]}


@router.post("/narration")
def narration(request: NarrationRequest, background: BackgroundTasks, settings: Settings = Depends(get_settings)) -> FileResponse:
    """Narration preview (mp3) for a text."""
    from app.providers.tts.edge import DEFAULT_VOICE

    tts = factory.build_tts_provider(settings)
    tmp = Path(tempfile.mkdtemp())
    path = tts.synthesize(request.text, request.voice or DEFAULT_VOICE, tmp / "narration.mp3")
    background.add_task(lambda: (path.unlink(missing_ok=True), tmp.rmdir()))
    return FileResponse(path, media_type="audio/mpeg", filename="narration.mp3")


@router.post("/video")
def video(request: RenderRequest, session: Session = Depends(get_session),
          settings: Settings = Depends(get_settings)) -> FileResponse:
    """Render the beats' clips (and optional narration) into one downloadable MP4."""
    from app.providers.tts.edge import DEFAULT_VOICE

    tts = factory.build_tts_provider(settings) if request.narration else None
    beats = [BeatSlot(b.text, [ClipSlot(c.asset_key, c.seconds) for c in b.clips]) for b in request.beats]
    try:
        output = render_video(session, settings.data_dir, beats, tts, request.voice or DEFAULT_VOICE,
                              factory.build_cloud_sources(settings))
    except RenderError as exc:
        raise HTTPException(422, str(exc)) from None
    return FileResponse(output, media_type="video/mp4", filename="script2broll_video.mp4")


@router.get("/clip/{asset_key}")
def clip(asset_key: str, session: Session = Depends(get_session), settings: Settings = Depends(get_settings)) -> FileResponse:
    """Download one B-roll clip (local library file, or the cloud clip fetched by the backend)."""
    try:
        path = clip_download_path(session, settings.data_dir, asset_key, factory.build_cloud_sources(settings))
    except RenderError as exc:
        raise HTTPException(404, str(exc)) from None
    return FileResponse(path, media_type="video/mp4", filename=f"{asset_key.replace(':', '_')}.mp4")
