from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class VectorMatch:
    entity_type: str
    entity_id: int
    score: float  # cosine similarity, higher is better


class VectorStore(ABC):
    """Stores and searches embeddings. The retrieval engine depends only on this interface."""

    @abstractmethod
    def upsert(
        self,
        entity_type: str,
        entity_id: int,
        embedding_type: str,
        model_name: str,
        vector: list[float],
    ) -> None: ...

    @abstractmethod
    def search(
        self,
        vector: list[float],
        model_name: str,
        embedding_type: str,
        top_k: int = 10,
    ) -> list[VectorMatch]: ...
