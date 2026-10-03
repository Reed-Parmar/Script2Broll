"""Full-script analysis: beats, their editorial intent, and B-roll candidates for each beat."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.search import SearchResult, VideoOut, get_search_service
from app.config import Settings, get_settings
from app.db.session import get_session
from app.providers import factory
from app.services.editorial import EditorialIntent, EditorialIntentAnalyzer
from app.services.retrieval import SemanticSearchService
from app.services.script import (
    MAX_SCRIPT_CHARS,
    BeatResult,
    ScriptAnalysisService,
    ScriptSegmenter,
    ScriptTooLongError,
)

router = APIRouter(prefix="/v1/script", tags=["script"])


class ScriptRequest(BaseModel):
    script: str = Field(max_length=MAX_SCRIPT_CHARS)
    top_k: int = Field(default=12, ge=1, le=50)  # B-roll candidates per beat

    @field_validator("script")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()  # keep line breaks: blank lines separate paragraphs
        if not value:
            raise ValueError("script must not be empty")
        return value


class BeatClip(SearchResult):
    matched_query: str  # which of the beat's queries gave this clip its (best) score


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

    @classmethod
    def from_result(cls, beat: BeatResult) -> "BeatOut":
        e = beat.editorial
        return cls(
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


def get_script_service(
    settings: Settings = Depends(get_settings),
    search: SemanticSearchService = Depends(get_search_service),
) -> ScriptAnalysisService:
    llm = factory.build_llm_provider(settings)  # one LLM client, shared by segmentation and every beat
    return ScriptAnalysisService(ScriptSegmenter(llm), EditorialIntentAnalyzer(llm), search)


@router.post("/analyze")
def analyze_script(
    request: ScriptRequest,
    service: ScriptAnalysisService = Depends(get_script_service),
    session: Session = Depends(get_session),
) -> ScriptResponse:
    try:
        analysis = service.analyze(session, request.script, request.top_k)
    except ScriptTooLongError as exc:
        raise HTTPException(422, str(exc)) from None
    return ScriptResponse(
        script=analysis.script,
        segmentation=SegmentationOut(method=analysis.segmentation.method, error=analysis.segmentation.error),
        model=service.search.embedder.model_name,
        top_k=request.top_k,
        beats=[BeatOut.from_result(beat) for beat in analysis.beats],
        timings_ms=analysis.timings_ms,
    )
