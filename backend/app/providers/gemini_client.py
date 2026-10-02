"""Shared google-genai client construction and error translation for Gemini providers."""

from google import genai
from google.genai import errors as genai_errors

from app.providers.errors import ProviderError, ProviderNotConfigured


def make_client(api_key: str | None, timeout_seconds: float) -> genai.Client:
    if not api_key:
        raise ProviderNotConfigured("GEMINI_API_KEY is not set")
    return genai.Client(
        api_key=api_key,
        http_options={"timeout": int(timeout_seconds * 1000)},
    )


def check_model(client: genai.Client, model: str) -> dict:
    """Fetch model metadata; free and validates both the key and the model id."""
    try:
        info = client.models.get(model=model)
    except genai_errors.APIError as exc:
        raise ProviderError(describe_api_error(exc, model)) from None
    except Exception as exc:  # network/timeouts; don't echo text that may hold the key
        raise ProviderError(f"Gemini request failed ({type(exc).__name__})") from None
    return {"model": model, "display_name": getattr(info, "display_name", None)}


def describe_api_error(exc: genai_errors.APIError, model: str) -> str:
    code = getattr(exc, "code", None)
    if code in (400, 401, 403):
        return f"Gemini rejected the API key or request (HTTP {code})"
    if code == 402:
        return "Gemini billing: the project's prepaid credits are depleted (HTTP 402)"
    if code == 404:
        return f"Gemini model '{model}' not found"
    if code == 429:
        return "Gemini quota or rate limit exceeded (HTTP 429)"
    return f"Gemini API error (HTTP {code})"
