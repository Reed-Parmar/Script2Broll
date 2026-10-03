"""Backend proxy for cloud-provider thumbnails (Phase 5).

Thumbnails are images; Pixabay disallows permanent image hotlinking, so the backend fetches them
once and serves them from DATA_DIR/cache. Only URLs the backend itself received from a provider are
fetched (looked up by provider + id); client-supplied URLs are never fetched.
"""

import re

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.config import Settings, get_settings
from app.providers import factory
from app.providers.errors import ProviderError
from app.services.broll_retrieval import REMOTE_THUMBNAILS
from app.services.candidates import asset_key

router = APIRouter(prefix="/v1/remote", tags=["remote"])

_ASSET_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


@router.get("/{provider}/{asset_id}/thumbnail")
def remote_thumbnail(provider: str, asset_id: str, settings: Settings = Depends(get_settings)) -> FileResponse:
    if provider not in settings.cloud_providers or not _ASSET_ID.match(asset_id):
        raise HTTPException(404, "Thumbnail not available")
    target = settings.data_dir / "cache" / "remote_thumbnails" / f"{provider}_{asset_id}.jpg"
    if not target.is_file():
        url = REMOTE_THUMBNAILS.get(asset_key(provider, asset_id))
        if url is None:  # not seen in this process: ask the provider by id
            source = factory.build_cloud_sources(settings).get(provider)
            try:
                candidate = source.get(asset_id) if source else None
            except ProviderError:
                candidate = None
            url = candidate.thumbnail_url if candidate else None
        if not url:
            raise HTTPException(404, "Thumbnail not available")
        try:
            response = httpx.get(url, timeout=settings.cloud_timeout_seconds, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError:
            raise HTTPException(502, "Could not fetch the provider thumbnail") from None
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(response.content)
    return FileResponse(target, media_type="image/jpeg")
