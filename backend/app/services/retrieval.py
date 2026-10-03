"""Semantic search: embed the query text, find the nearest clip embeddings, return clip details.

Depends only on the EmbeddingProvider and VectorStore interfaces. Ranking is pure cosine
similarity between the query vector and each clip's visual_mean vector.
"""

import math
import time
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Video
from app.providers.embedding.base import EmbeddingProvider
from app.services.ingestion import ENTITY_VIDEO, VISUAL_MEAN
from app.vectorstore.base import VectorStore


@dataclass(frozen=True)
class SearchHit:
    video: Video
    score: float


@dataclass
class SearchOutcome:
    hits: list[SearchHit]
    timings_ms: dict[str, float] = field(default_factory=dict)


# Prompt ensembling (standard CLIP practice): a bare phrase like "school" embeds better when averaged
# over a few caption templates.
QUERY_TEMPLATES = ("{}", "a photo of {}", "a video of {}", "footage of {}")

# Hubness correction: mean-pooled clip vectors that sit near the centre of the space ("hubs", e.g. a
# plain door or a heartbeat graphic) score moderately for almost any query. A clip's average similarity
# to this fixed bank of generic stock-footage descriptions measures that, and is subtracted:
#     score(q, v) = cos(q, v) - alpha * mean_b cos(b, v) = v · (q - alpha * mean_b(b))     (|v| = 1)
# so the correction is a modified query vector and pgvector still does all the ranking.
HUBNESS_BANK = (
    "a video of people", "a video of a city", "a video of nature", "a video of an office", "a video of technology",
    "a video of a building", "a video of a room", "a video of a person", "a video of hands", "a video of a street",
    "a video of food", "a video of animals", "a video of the sky", "a video of water", "a video of a vehicle",
    "a video of a machine", "a video of a screen", "a video of an object", "a video of a landscape", "a video of a crowd",
    "a close-up shot", "a wide shot", "an aerial shot", "an indoor scene", "an outdoor scene", "a night scene",
    "a bright scene", "a dark scene", "an abstract background", "a colorful animation",
)


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [x / norm for x in vector]


class SemanticSearchService:
    """Query text -> CLIP text vector -> pgvector cosine search over clip `visual_mean` vectors.

    prompt_ensemble / hubness_alpha are off by default (plain query embedding, raw cosine) and are
    enabled from settings by the API (`get_search_service`). With hubness on, `score` is the cosine
    similarity to the corrected query vector, so scores stay sorted and comparable within a request.
    """

    _bank_means: dict[str, list[float]] = {}  # embedding model -> mean of the normalised bank vectors

    def __init__(self, embedder: EmbeddingProvider, store: VectorStore, prompt_ensemble: bool = False,
                 hubness_alpha: float = 0.0):
        self.embedder = embedder
        self.store = store
        self.prompt_ensemble = prompt_ensemble
        self.hubness_alpha = hubness_alpha

    def _bank_mean(self) -> list[float]:
        cached = self._bank_means.get(self.embedder.model_name)
        if cached is None:
            vectors = [_normalize(v) for v in self.embedder.embed_texts(list(HUBNESS_BANK))]
            cached = [sum(column) / len(vectors) for column in zip(*vectors)]
            self._bank_means[self.embedder.model_name] = cached
        return cached

    def query_vector(self, query: str) -> list[float]:
        if self.prompt_ensemble:
            vectors = [_normalize(v) for v in self.embedder.embed_texts([t.format(query) for t in QUERY_TEMPLATES])]
            vector = _normalize([sum(column) / len(vectors) for column in zip(*vectors)])
        else:
            [vector] = self.embedder.embed_texts([query])
        if self.hubness_alpha:
            vector = [q - self.hubness_alpha * b for q, b in zip(vector, self._bank_mean())]
        return vector

    def search(self, session: Session, query: str, top_k: int = 10) -> SearchOutcome:
        started = time.perf_counter()
        query_vector = self.query_vector(query)
        embedded = time.perf_counter()
        matches = [
            m
            for m in self.store.search(query_vector, self.embedder.model_name, VISUAL_MEAN, top_k)
            if m.entity_type == ENTITY_VIDEO
        ]
        hits: list[SearchHit] = []
        if matches:
            ids = [m.entity_id for m in matches]
            videos = {v.id: v for v in session.scalars(select(Video).where(Video.id.in_(ids)))}
            # Keep the vector store's ranking; skip embeddings whose video row was deleted.
            hits = [SearchHit(videos[m.entity_id], m.score) for m in matches if m.entity_id in videos]
        searched = time.perf_counter()
        return SearchOutcome(
            hits,
            {
                "embedding": round((embedded - started) * 1000, 1),
                "search": round((searched - embedded) * 1000, 1),
            },
        )


@dataclass(frozen=True)
class MultiQueryHit:
    video: Video
    score: float  # best cosine similarity over all queries (no blending, no reranking)
    query: str  # the query that produced that best score


@dataclass
class MultiQueryOutcome:
    hits: list[MultiQueryHit]
    failed_queries: dict[str, str] = field(default_factory=dict)  # query -> client-safe error
    timings_ms: dict[str, float] = field(default_factory=dict)


def multi_query_search(search: SemanticSearchService, session: Session, queries: list[str], top_k: int) -> MultiQueryOutcome:
    """Run each query through the existing search; merge by video, keeping each video's best score.

    best_similarity(video) = max over queries of cosine(query, video). Deliberately simple and
    explainable: every hit says which query found it. A failing query is reported and skipped;
    if every query fails, the first error is raised.
    """
    from app.providers.errors import ProviderError

    started = time.perf_counter()
    best: dict[int, MultiQueryHit] = {}
    failed: dict[str, str] = {}
    first_error: ProviderError | None = None
    for query in dict.fromkeys(queries):  # drop exact duplicates, keep order
        try:
            outcome = search.search(session, query, top_k)
        except ProviderError as exc:
            failed[query] = str(exc)
            first_error = first_error or exc
            continue
        for hit in outcome.hits:
            current = best.get(hit.video.id)
            if current is None or hit.score > current.score:
                best[hit.video.id] = MultiQueryHit(hit.video, hit.score, query)
    if first_error is not None and len(failed) == len(dict.fromkeys(queries)):
        raise first_error
    hits = sorted(best.values(), key=lambda h: h.score, reverse=True)[:top_k]
    return MultiQueryOutcome(hits, failed, {"search": round((time.perf_counter() - started) * 1000, 1)})
