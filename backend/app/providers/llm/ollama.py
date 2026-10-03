"""Local LLM through an Ollama server (https://ollama.com). No API key; runs on this machine."""

import httpx

from app.providers.errors import ProviderError
from app.providers.llm.base import LLMProvider


class OllamaLLMProvider(LLMProvider):
    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout_seconds: float = 60.0, client: httpx.Client | None = None):
        self.model = model
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=timeout_seconds)

    def generate(self, prompt: str, json_schema: dict | None = None) -> str:
        payload: dict = {"model": self.model, "prompt": prompt, "stream": False, "options": {"temperature": 0, "seed": 0}}
        if json_schema is not None:
            payload["format"] = json_schema  # constrained decoding to the schema
        data = self._request("POST", "/api/generate", json=payload)
        return data.get("response") or ""

    def check(self) -> dict:
        models = {m.get("name") for m in self._request("GET", "/api/tags").get("models", [])}
        if self.model not in models and f"{self.model}:latest" not in models:
            raise ProviderError(f"Ollama model '{self.model}' is not pulled (run: ollama pull {self.model})")
        return {"model": self.model}

    def _request(self, method: str, path: str, **kwargs) -> dict:
        try:
            response = self._client.request(method, self._base_url + path, **kwargs)
        except httpx.TimeoutException:
            raise ProviderError("Ollama request timed out") from None
        except httpx.HTTPError as exc:
            raise ProviderError(f"Ollama is not reachable at {self._base_url} ({type(exc).__name__})") from None
        if response.status_code == 404:
            raise ProviderError(f"Ollama model '{self.model}' not found (run: ollama pull {self.model})")
        if response.status_code != 200:
            raise ProviderError(f"Ollama error (HTTP {response.status_code})")
        try:
            return response.json()
        except ValueError:
            raise ProviderError("Ollama returned a non-JSON response") from None
