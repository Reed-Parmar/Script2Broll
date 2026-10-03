"""Full-script analysis: beats, their editorial intent, and B-roll candidates for each beat."""

from typing import Literal

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.search import SearchResult, VideoOut, get_search_service
from app.config import Settings, get_settings
from app.db.session import get_session
from app.providers import factory
from app.services.editorial import EditorialIntent, EditorialIntentAnalyzer
from app.db.session import get_engine
from app.providers.video_source.cache import ProviderCache
from app.services.broll_retrieval import BrollRetrievalService, CloudCandidateSource, RetrievalPolicy
from app.services.vibe import BeatVibe, VibeAnalyzer, VibeTags, vocabulary
from app.services.pacing import BeatPacing, ClipRef, estimate_pacing
from app.services.retrieval import SemanticSearchService
from app.services.script import (
    MAX_SCRIPT_CHARS,
    BeatResult,
    ScriptAnalysisService,
    ScriptSegmenter,
    ScriptTooLongError,
)

router = APIRouter(prefix="/v1/script", tags=["script"])


class RetrievalIn(BaseModel):
    """Phase 5: mix of local library and cloud candidates per beat. Omitted -> local only (top_k)."""

    local_k: int = Field(default=3, ge=0, le=50)
    cloud_k: int = Field(default=2, ge=0, le=10)
    cloud_providers: list[str] = ["pixabay"]
    fill: Literal["strict", "backfill"] = "backfill"


class PacingIn(BaseModel):
    words_per_minute: float = Field(default=150, ge=80, le=250)


class VibeIn(BaseModel):
    """Phase 7. `selected` applies to every beat; `per_beat` (keyed by beat_id) overrides it.
    Tags outside the vocabulary (GET /v1/vibe/vocabulary) are dropped. Omitted -> suggestions are used."""

    suggest: bool = True
    selected: VibeTags | None = None
    per_beat: dict[str, VibeTags] = {}


class ScriptRequest(BaseModel):
    script: str = Field(max_length=MAX_SCRIPT_CHARS)
    top_k: int = Field(default=12, ge=1, le=50)  # B-roll candidates per beat (ignored when `retrieval` is given)
    retrieval: RetrievalIn | None = None
    pacing: PacingIn | None = None
    vibe: VibeIn | None = None

    @field_validator("script")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()  # keep line breaks: blank lines separate paragraphs
        if not value:
            raise ValueError("script must not be empty")
        return value


class BeatClip(SearchResult):
    matched_query: str  # which of the beat's queries gave this clip its (best) score


class CandidateOut(BaseModel):
    """Local or cloud B-roll candidate. Compare `similarity` only within the same `score_basis`."""

    asset_key: str
    source_type: Literal["local", "cloud"]
    provider: str
    provider_asset_id: str
    video_id: int | None
    display_name: str
    page_url: str
    creator: str | None
    title: str | None
    tags: list[str]
    duration: float | None
    width: int | None
    height: int | None
    thumbnail_url: str
    media_url: str | None
    exportable: bool
    similarity: float | None
    score_basis: str
    provider_rank: int | None
    matched_query: str
    vibe_score: float | None = None  # Phase 7: match with the beat's selected tags; None = no signal


class SourceStatusOut(BaseModel):
    status: str
    count: int = 0
    detail: str | None = None
    requests: int = 0
    cache_hits: int = 0
    latency_ms: float = 0.0


class BeatOut(BaseModel):
    beat_id: str
    order: int
    text: str
    status: Literal["ok", "error"]
    error: str | None = None  # why this beat has no analysis/results; other beats are unaffected
    # Editorial analysis (from the existing analyzer); null if it failed for this beat.
    editorial_intent: EditorialIntent | None = None
    topic: str | None = None
    visual_role: str | None = None
    visual_description: str | None = None
    retrieval_query: str | None = None  # primary query
    # Phase 4.1 (additive): other filmable shots and the queries built from them. Clips are the
    # union of all queries' results, one entry per video, ranked by its best similarity.
    filmable_visuals: list[str] = []
    alternative_queries: list[str] = []
    warnings: list[str] = []  # non-fatal problems, e.g. one of the queries failed
    broll_results: list[BeatClip] = []
    # Phase 5/8 (additive)
    candidates: list[CandidateOut] = []
    source_status: dict[str, SourceStatusOut] = {}
    pacing: BeatPacing | None = None
    vibe: BeatVibe | None = None

    @classmethod
    def from_result(cls, beat: BeatResult, pacing: BeatPacing | None = None) -> "BeatOut":
        e = beat.editorial
        return cls(
            candidates=[CandidateOut(**{**c.__dict__, "tags": list(c.tags)}) for c in beat.candidates],
            source_status={k: SourceStatusOut(**v.__dict__) for k, v in beat.source_status.items()},
            pacing=pacing,
            vibe=beat.vibe,
            beat_id=beat.beat_id,
            order=beat.order,
            text=beat.text,
            status="error" if beat.error else "ok",
            error=beat.error,
            editorial_intent=e.editorial_intent if e else None,
            topic=e.topic if e else None,
            visual_role=e.visual_role if e else None,
            visual_description=e.visual_description if e else None,
            retrieval_query=e.retrieval_query if e else None,
            filmable_visuals=e.filmable_visuals if e else [],
            alternative_queries=e.alternative_queries if e else [],
            warnings=beat.warnings,
            broll_results=[
                BeatClip(score=round(hit.score, 4), matched_query=hit.query, **VideoOut.from_model(hit.video).model_dump())
                for hit in beat.hits
            ],
        )


class SegmentationOut(BaseModel):
    # llm: beats grouped by the language model; single_sentence: nothing to group;
    # sentence_fallback: the model's grouping was invalid, so each sentence became a beat.
    method: Literal["llm", "single_sentence", "sentence_fallback"]
    error: str | None = None  # why the fallback was used


class ScriptResponse(BaseModel):
    script: str
    segmentation: SegmentationOut
    model: str  # embedding model the B-roll was ranked with
    top_k: int
    beats: list[BeatOut]
    timings_ms: dict[str, float]
    total_narration_seconds: float | None = None


def _clip_refs(beat: BeatResult) -> list[ClipRef]:
    """Ranked clips for pacing: unified candidates (Phase 5), else the local hits."""
    if beat.candidates:
        return [ClipRef(beat_id=beat.beat_id, asset_key=c.asset_key, source_type=c.source_type,
                        provider=c.provider, duration=c.duration) for c in beat.candidates]
    return [ClipRef(beat_id=beat.beat_id, asset_key=f"{h.video.source_provider}:{h.video.source_id}",
                    source_type="local", provider=h.video.source_provider, duration=h.video.duration)
            for h in beat.hits]


def get_script_service(
    settings: Settings = Depends(get_settings),
    search: SemanticSearchService = Depends(get_search_service),
) -> ScriptAnalysisService:
    llm = factory.build_llm_provider(settings)  # one LLM client, shared by segmentation and every beat
    cache = ProviderCache(get_engine(), settings.provider_cache_ttl_hours)
    clouds = {
        name: CloudCandidateSource(name, provider, cache, settings.cloud_queries_per_beat)
        for name, provider in factory.build_cloud_sources(settings).items()
    }
    retrieval = BrollRetrievalService(search, clouds, settings.cloud_max_requests_per_script)
    vibe = VibeAnalyzer(llm) if settings.vibe_suggest else None
    return ScriptAnalysisService(ScriptSegmenter(llm), EditorialIntentAnalyzer(llm), search, retrieval, vibe,
                                 concurrency=settings.script_beat_concurrency)


@router.post("/analyze")
def analyze_script(
    request: ScriptRequest,
    service: ScriptAnalysisService = Depends(get_script_service),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ScriptResponse:
    if request.retrieval is None:
        policy = RetrievalPolicy(local_k=request.top_k)  # identical to Phase 4.1 behaviour
    else:
        r = request.retrieval
        policy = RetrievalPolicy(r.local_k, r.cloud_k, tuple(p.strip().lower() for p in r.cloud_providers), r.fill)
    try:
        v = request.vibe or VibeIn()
        analysis = service.analyze(session, request.script, request.top_k, policy,
                                   vibe_selected=v.per_beat, vibe_global=v.selected, suggest_vibe=v.suggest)
    except ScriptTooLongError as exc:
        raise HTTPException(422, str(exc)) from None
    wpm = request.pacing.words_per_minute if request.pacing else settings.pacing_words_per_minute
    pacings = [
        estimate_pacing(b.text, b.editorial.editorial_intent if b.editorial else None, wpm,
                        settings.pacing_min_shot_seconds, settings.pacing_max_shot_seconds, settings.pacing_max_shots_per_beat,
                        candidates=_clip_refs(b))
        for b in analysis.beats
    ]
    return ScriptResponse(
        script=analysis.script,
        segmentation=SegmentationOut(method=analysis.segmentation.method, error=analysis.segmentation.error),
        model=service.search.embedder.model_name,
        top_k=request.top_k,
        beats=[BeatOut.from_result(beat, pacing) for beat, pacing in zip(analysis.beats, pacings)],
        timings_ms=analysis.timings_ms,
        total_narration_seconds=round(sum(p.narration_seconds for p in pacings), 1),
    )


@router.get("/vibe/vocabulary", tags=["vibe"])
def vibe_vocabulary() -> dict[str, list[str]]:
    """Allowed vibe tags per category (controlled vocabulary)."""
    return vocabulary()


AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".webm"}  # .webm: browser microphone recordings


class TranscriptOut(BaseModel):
    text: str
    language: str | None
    duration: float | None
    model: str


@router.post("/transcribe", tags=["audio"])
def transcribe_audio(file: UploadFile = File(...), settings: Settings = Depends(get_settings)) -> TranscriptOut:
    """Audio narration -> text. The client then sends the text to POST /v1/script/analyze (same pipeline)."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(422, f"Unsupported audio type '{suffix or '?'}'; use {', '.join(sorted(AUDIO_EXTENSIONS))}")
    provider = factory.build_transcription_provider(settings)
    data = file.file.read(settings.max_audio_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_audio_mb * 1024 * 1024:
        raise HTTPException(413, f"Audio file is larger than {settings.max_audio_mb} MB")
    if not data:
        raise HTTPException(422, "The audio file is empty")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"upload{suffix}"
        path.write_bytes(data)
        transcript = provider.transcribe(path)
    if not transcript.text:
        raise HTTPException(422, "No speech was recognised in the audio")
    return TranscriptOut(text=transcript.text, language=transcript.language, duration=transcript.duration, model=provider.model)
