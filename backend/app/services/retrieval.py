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
