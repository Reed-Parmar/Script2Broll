from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VoicePreset:
    id: str  # stable id used by the API/frontend
    label: str
    voice: str  # provider voice name
    rate: str = "+0%"
    pitch: str = "+0Hz"


class TTSProvider(ABC):
    """Text -> narration audio (mp3). Used only for demo narration; independent of beat logic."""

    name: str

    @abstractmethod
    def voices(self) -> list[VoicePreset]: ...

    @abstractmethod
    def synthesize(self, text: str, voice_id: str, out_path: Path) -> Path:
        """Write mp3 narration for `text` to out_path. Raises ProviderError on failure."""
