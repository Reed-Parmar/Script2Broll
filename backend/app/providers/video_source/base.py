from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(frozen=True)
class VideoCandidate:
    """Provider-neutral description of a downloadable stock clip."""

    source_provider: str
    source_id: str
    source_url: str
    video_url: str
    thumbnail_url: str | None
    duration: float | None
    width: int | None
    height: int | None
    tags: list[str] = field(default_factory=list)
    creator: str | None = None


class VideoSourceProvider(ABC):
    name: str

    @abstractmethod
    def search(self, query: str, per_page: int = 20, page: int = 1) -> list[VideoCandidate]:
        """Search the provider's catalogue."""

    @abstractmethod
    def check(self) -> dict:
        """Cheap connectivity check. Returns non-secret details or raises ProviderError."""
