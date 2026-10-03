"""Semantic search: embed the query text, find the nearest clip embeddings, return clip details.

Depends only on the EmbeddingProvider and VectorStore interfaces. Ranking is pure cosine
similarity between the query vector and each clip's visual_mean vector.
"""

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


class SemanticSearchService:
    def __init__(self, embedder: EmbeddingProvider, store: VectorStore):
        self.embedder = embedder
        self.store = store

    def search(self, session: Session, query: str, top_k: int = 10) -> SearchOutcome:
        started = time.perf_counter()
        [query_vector] = self.embedder.embed_texts([query])
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
