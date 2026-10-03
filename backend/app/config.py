"""Application settings, loaded from environment variables and the repo-root .env file.

Secrets are typed as SecretStr so they never appear in reprs, logs or error messages.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str = "postgresql+psycopg://script2broll:script2broll@localhost:5432/script2broll"

    # Language model for editorial-intent analysis (not used for embeddings).
    # gemini: hosted, needs GEMINI_API_KEY with billing. ollama: local server, no key.
    llm_provider: str = "gemini"
    llm_timeout_seconds: float = 60.0

    # Gemini (LLM; also an optional embedding provider)
    gemini_api_key: SecretStr | None = None
    gemini_llm_model: str = "gemini-2.5-flash"

    # Ollama (local LLM server)
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:3b"

    # Embeddings. The provider/model/dimension triple defines the vector space;
    # changing any of them means re-embedding the library.
    # clip: local OpenCLIP, EMBEDDING_MODEL = "<architecture>/<pretrained tag>".
    # gemini: e.g. EMBEDDING_MODEL=gemini-embedding-2, EMBEDDING_DIM=768 (needs billing).
    embedding_provider: str = "clip"
    embedding_model: str = "ViT-B-32/laion2b_s34b_b79k"
    embedding_dim: int = 512

    # Pixabay (backend only; never sent to the frontend)
    pixabay_api_key: SecretStr | None = None

    # Ingestion. Downloaded clips and thumbnails live under data_dir (git-ignored).
    data_dir: Path = REPO_ROOT / "data"
    frames_per_video: int = 8

    # HTTP
    cors_origins: list[str] = ["http://localhost:5173"]
    external_timeout_seconds: float = 10.0
    # Embedding several frames in one request is slower than a metadata check.
    embedding_timeout_seconds: float = 60.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
