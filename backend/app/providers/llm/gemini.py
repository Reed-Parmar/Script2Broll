from google.genai import errors as genai_errors
from google.genai import types

from app.providers.errors import ProviderError
from app.providers.gemini_client import describe_api_error, check_model, make_client
from app.providers.llm.base import LLMProvider


class GeminiLLMProvider(LLMProvider):
    name = "gemini"

    def __init__(self, api_key: str | None, model: str, timeout_seconds: float = 10.0):
        self.model = model
        self._client = make_client(api_key, timeout_seconds)

    def generate(self, prompt: str, json_schema: dict | None = None) -> str:
        config = types.GenerateContentConfig(temperature=0)
        if json_schema is not None:
            config.response_mime_type = "application/json"
            config.response_json_schema = json_schema
        try:
            response = self._client.models.generate_content(model=self.model, contents=prompt, config=config)
        except genai_errors.APIError as exc:
            raise ProviderError(describe_api_error(exc, self.model)) from None
        except Exception as exc:  # network/timeouts; don't echo text that may hold the key
            raise ProviderError(f"Gemini request failed ({type(exc).__name__})") from None
        return response.text or ""

    def check(self) -> dict:
        return check_model(self._client, self.model)
