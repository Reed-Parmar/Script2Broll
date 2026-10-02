import math
from abc import ABC, abstractmethod
from pathlib import Path


def l2_normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vector))
    return [x / norm for x in vector] if norm else list(vector)


def mean_vector(vectors: list[list[float]]) -> list[float]:
    """Normalised centroid: how several frame embeddings become one clip embedding."""
    if not vectors:
        raise ValueError("mean_vector needs at least one vector")
    return l2_normalize([sum(column) / len(vectors) for column in zip(*vectors, strict=True)])


class EmbeddingProvider(ABC):
    """Maps text queries and video frames into one shared vector space.

    Retrieval only works if text and image vectors are comparable, so every
    implementation must be a cross-modal model (Gemini Embedding 2, CLIP-style models).
    Implementations should L2-normalise their output so cosine distance is meaningful.
    """

    name: str
    model_name: str
    dim: int

    @abstractmethod
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed search queries. Implementations add any model-specific query formatting."""

    @abstractmethod
    def embed_images(self, image_paths: list[Path]) -> list[list[float]]:
        """Embed sampled video frames, one vector per image."""

    @abstractmethod
    def check(self) -> dict:
        """Cheap connectivity check. Returns non-secret details or raises ProviderError."""
