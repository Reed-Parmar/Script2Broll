"""Semantic search API, plus clip metadata and media served from the local library.

Media is served by the backend from DATA_DIR rather than linking the provider's CDN, so the
browser never talks to third parties directly. Only library files are served, by video id;
no client-supplied paths are accepted.
"""

import time
from enum import StrEnum
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.models import Video
from app.db.session import get_session
from app.api.editorial import MAX_TEXT_LENGTH, clean_text, get_editorial_analyzer
from app.providers import factory
from app.services.candidates import from_local_hit
from app.services.editorial import EditorialIntent, EditorialIntentResult
from app.services.ingestion import thumbnail_path
from app.services.retrieval import MultiQueryHit, SearchHit, SearchOutcome, SemanticSearchService, multi_query_search
from app.services.vibe import VIBE_WEIGHT_USER, VibeScorer, VibeTags

router = APIRouter(prefix="/v1", tags=["search"])

SOURCE_NAMES = {"pixabay": "Pixabay"}


class SearchMode(StrEnum):
    SEMANTIC = "semantic"  # query text -> embedding search
    EDITORIAL = "editorial"  # script text -> editorial analysis -> retrieval query -> embedding search


class SearchRequest(BaseModel):
    query: str = Field(max_length=MAX_TEXT_LENGTH)
    top_k: int = Field(default=12, ge=1, le=50)
    mode: SearchMode = SearchMode.SEMANTIC
    # Editorial mode only (ignored in semantic mode):
    intent: EditorialIntent | None = None  # editor-chosen intent; omitted -> the model decides
    vibe: VibeTags | None = None  # desired feel (controlled vocabulary); re-orders results, never edits the query

    @field_validator("query")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        return clean_text(value)


class VideoOut(BaseModel):
    video_id: int
    source: str
    source_id: str
    source_url: str
    creator: str | None
    tags: list[str]
    duration: float | None
    width: int | None
    height: int | None
    video_url: str  # backend path, relative to the API root
    thumbnail_url: str  # backend path, relative to the API root

    @classmethod
    def from_model(cls, video: Video) -> "VideoOut":
        return cls(
            video_id=video.id,
            source=SOURCE_NAMES.get(video.source_provider, video.source_provider),
            source_id=video.source_id,
            source_url=video.source_url,
            creator=video.creator,
            tags=[t.strip() for t in (video.tags or "").split(",") if t.strip()],
            duration=video.duration,
            width=video.width,
            height=video.height,
            video_url=f"/v1/videos/{video.id}/file",
            thumbnail_url=f"/v1/videos/{video.id}/thumbnail",
        )


class SearchResult(VideoOut):
    score: float  # cosine similarity between query and clip embeddings


class SearchResponse(BaseModel):
    query: str
    mode: SearchMode
    retrieval_query: str  # the text actually embedded and searched
    editorial: EditorialIntentResult | None = None  # set in editorial mode
    intent_source: str | None = None  # editorial mode: "user" (request.intent) or "model"
    vibe: VibeTags | None = None  # editorial mode: tags applied to the ranking, if any
    model: str
    results: list[SearchResult]
    timings_ms: dict[str, float]


def get_search_service(settings: Settings = Depends(get_settings)) -> SemanticSearchService:
    return SemanticSearchService(
        factory.build_embedding_provider(settings),
        factory.build_vector_store(),
        prompt_ensemble=settings.search_prompt_ensemble,
        hubness_alpha=settings.search_hubness_alpha,
    )


@router.post("/search")
def search(
    request: SearchRequest,
    service: SemanticSearchService = Depends(get_search_service),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> SearchResponse:
    started = time.perf_counter()
    editorial, retrieval_query, timings = None, request.query, {}
    intent_source, vibe = None, None
    if request.mode == SearchMode.EDITORIAL:
        # Built only in this mode, so semantic search never depends on the LLM being configured.
        editorial = get_editorial_analyzer(settings).analyze(request.query, intent=request.intent)
        intent_source = "user" if request.intent is not None else "model"
        retrieval_query = editorial.retrieval_query
        timings["analysis"] = round((time.perf_counter() - started) * 1000, 1)
    use_vibe = request.mode == SearchMode.EDITORIAL and request.vibe is not None and not request.vibe.is_empty()
    # With a mood, rank a larger pool of relevant clips so the vibe can choose among them.
    pool = min(50, max(request.top_k * 3, 30)) if use_vibe else request.top_k
    if editorial is not None:
        # Same multi-query retrieval as the script pipeline: primary + alternative shots, each clip
        # keeps its best score. More robust than one very specific primary caption.
        multi = multi_query_search(service, session, [editorial.retrieval_query, *editorial.alternative_queries], pool)
        outcome = SearchOutcome([SearchHit(h.video, h.score) for h in multi.hits], multi.timings_ms)
    else:
        outcome = service.search(session, retrieval_query, pool)
    if use_vibe:
        # Same vibe mechanism as /v1/script/analyze: re-order the retrieved clips by the selected tags.
        vibe = request.vibe
        candidates = [from_local_hit(MultiQueryHit(h.video, h.score, retrieval_query)) for h in outcome.hits]
        by_key = {c.asset_key: h for c, h in zip(candidates, outcome.hits)}
        reordered = VibeScorer(service.embedder).rerank(session, candidates, vibe, weight=VIBE_WEIGHT_USER)
        outcome.hits = [SearchHit(by_key[c.asset_key].video, by_key[c.asset_key].score) for c in reordered][: request.top_k]
    results = [
        SearchResult(score=round(hit.score, 4), **VideoOut.from_model(hit.video).model_dump())
        for hit in outcome.hits
    ]
    timings |= outcome.timings_ms | {"total": round((time.perf_counter() - started) * 1000, 1)}
    return SearchResponse(
        query=request.query,
        mode=request.mode,
        retrieval_query=retrieval_query,
        editorial=editorial,
        intent_source=intent_source,
        vibe=vibe,
        model=service.embedder.model_name,
        results=results,
        timings_ms=timings,
    )


def _video_or_404(session: Session, video_id: int) -> Video:
    video = session.get(Video, video_id)
    if video is None:
        raise HTTPException(404, "Video not found")
    return video


def _library_file(data_dir: Path, path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(data_dir.resolve()) or not resolved.is_file():
        raise HTTPException(404, "File not available")
    return resolved


@router.get("/videos/{video_id}")
def get_video(video_id: int, session: Session = Depends(get_session)) -> VideoOut:
    return VideoOut.from_model(_video_or_404(session, video_id))


@router.get("/videos/{video_id}/file")
def get_video_file(
    video_id: int,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    video = _video_or_404(session, video_id)
    if not video.local_path:
        raise HTTPException(404, "Video not downloaded")
    return FileResponse(_library_file(settings.data_dir, settings.data_dir / video.local_path), media_type="video/mp4")


@router.get("/videos/{video_id}/thumbnail")
def get_video_thumbnail(
    video_id: int,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    _video_or_404(session, video_id)
    return FileResponse(_library_file(settings.data_dir, thumbnail_path(settings.data_dir, video_id)), media_type="image/jpeg")
