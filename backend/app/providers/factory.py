"""Builds providers from settings. The only place that maps config names to concrete classes."""

from app.config import Settings
from app.providers.embedding.base import EmbeddingProvider
from app.providers.errors import ProviderNotConfigured
from app.providers.llm.base import LLMProvider
from app.providers.video_source.base import VideoSourceProvider
from app.vectorstore.base import VectorStore


def _secret(value) -> str | None:
    return value.get_secret_value() if value else None


def build_llm_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "gemini":
        from app.providers.llm.gemini import GeminiLLMProvider

        return GeminiLLMProvider(
            _secret(settings.gemini_api_key),
            settings.gemini_llm_model,
            settings.llm_timeout_seconds,
        )
    if settings.llm_provider == "ollama":
        from app.providers.llm.ollama import OllamaLLMProvider

        return OllamaLLMProvider(
            settings.ollama_url, settings.ollama_model, settings.llm_timeout_seconds, num_ctx=settings.ollama_num_ctx
        )
    raise ProviderNotConfigured(f"Unknown LLM_PROVIDER '{settings.llm_provider}'")


def build_embedding_provider(settings: Settings) -> EmbeddingProvider:
    if settings.embedding_provider == "gemini":
        from app.providers.embedding.gemini import GeminiEmbeddingProvider

        return GeminiEmbeddingProvider(
            _secret(settings.gemini_api_key),
            settings.embedding_model,
            settings.embedding_dim,
            settings.embedding_timeout_seconds,
        )
    if settings.embedding_provider == "clip":
        from app.providers.embedding.clip import ClipEmbeddingProvider

        return ClipEmbeddingProvider(settings.embedding_model, settings.embedding_dim)
    raise ProviderNotConfigured(f"Unknown EMBEDDING_PROVIDER '{settings.embedding_provider}'")


def build_video_source(settings: Settings) -> VideoSourceProvider:
    from app.providers.video_source.pixabay import PixabayVideoProvider

    return PixabayVideoProvider(_secret(settings.pixabay_api_key), settings.external_timeout_seconds)


def build_cloud_sources(settings: Settings) -> dict[str, VideoSourceProvider | None]:
    """Query-time cloud providers from CLOUD_PROVIDERS. Misconfigured ones map to None ("not_configured")."""
    sources: dict[str, VideoSourceProvider | None] = {}
    for name in settings.cloud_providers:
        name = name.strip().lower()
        try:
            if name == "pixabay":
                from app.providers.video_source.pixabay import PixabayVideoProvider

                sources[name] = PixabayVideoProvider(_secret(settings.pixabay_api_key), settings.cloud_timeout_seconds)
            else:
                sources[name] = None
        except ProviderNotConfigured:
            sources[name] = None
    return sources


def build_vector_store() -> VectorStore:
    from app.db.session import get_engine
    from app.vectorstore.pgvector import PgVectorStore

    return PgVectorStore(get_engine())
