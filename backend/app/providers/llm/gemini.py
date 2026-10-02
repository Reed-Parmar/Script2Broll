from google.genai import errors as genai_errors

from app.providers.errors import ProviderError
from app.providers.gemini_client import describe_api_error, check_model, make_client
from app.providers.llm.base import LLMProvider


class GeminiLLMProvider(LLMProvider):
    name = "gemini"

    def __init__(self, api_key: str | None, model: str, timeout_seconds: float = 10.0):
        self.model = model
        self._client = make_client(api_key, timeout_seconds)

    def generate(self, prompt: str) -> str:
        try:
            response = self._client.models.generate_content(model=self.model, contents=prompt)
        except genai_errors.APIError as exc:
            raise ProviderError(describe_api_error(exc, self.model)) from None
        return response.text or ""

    def check(self) -> dict:
        return check_model(self._client, self.model)
