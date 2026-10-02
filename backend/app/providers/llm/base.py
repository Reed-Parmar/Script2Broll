from abc import ABC, abstractmethod


class LLMProvider(ABC):
    name: str

    @abstractmethod
    def generate(self, prompt: str) -> str:
        """Return a text completion for the prompt."""

    @abstractmethod
    def check(self) -> dict:
        """Cheap connectivity check. Returns non-secret details or raises ProviderError."""
