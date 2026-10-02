from abc import ABC, abstractmethod


class LLMProvider(ABC):
    name: str
    model: str

    @abstractmethod
    def generate(self, prompt: str, json_schema: dict | None = None) -> str:
        """Return a text completion for the prompt.

        With json_schema, ask the model for a JSON document matching that schema (using the
        provider's structured-output mode). The raw text is returned either way: callers
        must still parse and validate it, since models can return malformed output.
        """

    @abstractmethod
    def check(self) -> dict:
        """Cheap connectivity check. Returns non-secret details or raises ProviderError."""
