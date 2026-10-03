"""Unified B-roll candidate model (Phase 5): local library hits and cloud provider results.

`asset_key` = "<provider>:<provider_asset_id>" is the stable identity (local DB ids differ per
machine). Scores are only comparable within the same `score_basis`.
"""

from dataclasses import dataclass, field
from typing import Literal

from app.providers.video_source.base import VideoCandidate
from app.services.retrieval import MultiQueryHit

SourceType = Literal["local", "cloud"]
ScoreBasis = Literal["clip_visual_mean", "clip_thumbnail", "provider_rank"]

DISPLAY_NAMES = {"pixabay": "Pixabay", "getty": "Getty Images"}


def asset_key(provider: str, provider_asset_id: str) -> str:
    return f"{provider}:{provider_asset_id}"


@dataclass(frozen=True)
class BrollCandidate:
    asset_key: str
    source_type: SourceType
    provider: str
    provider_asset_id: str
    video_id: int | None  # local DB id (machine-specific); None for cloud
    display_name: str
    page_url: str
    creator: str | None
    title: str | None
    tags: tuple[str, ...]
    duration: float | None
    width: int | None
    height: int | None
    thumbnail_url: str
    media_url: str | None
    exportable: bool
    similarity: float | None
    score_basis: ScoreBasis
    provider_rank: int | None
    matched_query: str
    query_scores: dict[str, float] = field(default_factory=dict)
    vibe_score: float | None = None  # Phase 7: match with the beat's selected vibe tags (None = no signal)


def from_local_hit(hit: MultiQueryHit) -> BrollCandidate:
    v = hit.video
    return BrollCandidate(
        asset_key=asset_key(v.source_provider, v.source_id),
        source_type="local",
        provider=v.source_provider,
        provider_asset_id=v.source_id,
        video_id=v.id,
        display_name=DISPLAY_NAMES.get(v.source_provider, v.source_provider),
        page_url=v.source_url,
        creator=v.creator,
        title=None,
        tags=tuple(t.strip() for t in (v.tags or "").split(",") if t.strip()),
        duration=v.duration,
        width=v.width,
        height=v.height,
        thumbnail_url=f"/v1/videos/{v.id}/thumbnail",
        media_url=f"/v1/videos/{v.id}/file",
        exportable=True,
        similarity=round(hit.score, 4),
        score_basis="clip_visual_mean",
        provider_rank=None,
        matched_query=hit.query,
    )


def from_cloud(c: VideoCandidate, rank: int, query: str) -> BrollCandidate:
    return BrollCandidate(
        asset_key=asset_key(c.source_provider, c.source_id),
        source_type="cloud",
        provider=c.source_provider,
        provider_asset_id=c.source_id,
        video_id=None,
        display_name=DISPLAY_NAMES.get(c.source_provider, c.source_provider),
        page_url=c.source_url,
        creator=c.creator,
        title=None,
        tags=tuple(c.tags),
        duration=c.duration,
        width=c.width,
        height=c.height,
        # Thumbnails are images: proxied by the backend (Pixabay disallows permanent image hotlinking).
        thumbnail_url=f"/v1/remote/{c.source_provider}/{c.source_id}/thumbnail",
        # Pixabay explicitly allows embedding videos directly.
        media_url=c.video_url,
        exportable=c.source_provider == "pixabay",
        similarity=None,
        score_basis="provider_rank",
        provider_rank=rank,
        matched_query=query,
    )
