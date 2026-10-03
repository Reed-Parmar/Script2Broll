from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class TranscriptSegment:
    start: float  # seconds
    end: float
    text: str


@dataclass
class Transcript:
    text: str
    language: str | None = None
    duration: float | None = None  # seconds of audio
    segments: list[TranscriptSegment] = field(default_factory=list)


class TranscriptionProvider(ABC):
    """Speech-to-text. Independent of beat logic: the transcript text feeds the normal script pipeline."""

    name: str
    model: str

    @abstractmethod
    def transcribe(self, audio_path: Path) -> Transcript:
        """Transcribe an audio file (mp3, wav, m4a, ogg...). Raises ProviderError on failure."""
