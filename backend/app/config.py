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

    # Semantic search quality (see services/retrieval.py): caption-template ensembling and hubness
    # correction (subtracts each clip's average similarity to generic descriptions; 0 disables).
    search_prompt_ensemble: bool = True
    search_hubness_alpha: float = 0.75

    # Ollama context window (prompt truncation guard)
    ollama_num_ctx: int = 8192

    # Phase 5: query-time cloud retrieval (off unless CLOUD_PROVIDERS is set)
    cloud_providers: list[str] = []
    retrieval_cloud_k: int = 0
    cloud_queries_per_beat: int = 1
    cloud_max_requests_per_script: int = 20
    cloud_timeout_seconds: float = 5.0
    provider_cache_ttl_hours: float = 24.0

    # Phase 7: vibe tag suggestions (returned by the same LLM call as the editorial analysis)
    vibe_suggest: bool = True
    # Beats processed concurrently in /v1/script/analyze (LLM calls still queue at the LLM server;
    # retrieval for one beat overlaps the next beat's LLM call). 1 = sequential.
    script_beat_concurrency: int = 3

    # Audio upload: speech-to-text for Script -> Beat (faster_whisper = local/offline; none = disabled)
    transcription_provider: str = "faster_whisper"
    whisper_model: str = "base"
    max_audio_mb: int = 25

    # Demo narration (text-to-speech) for video export: edge (online neural voices, no key) | none
    tts_provider: str = "edge"

    # Phase 8: pacing
    pacing_words_per_minute: float = 150.0
    pacing_min_shot_seconds: float = 1.5
    pacing_max_shot_seconds: float = 8.0
    pacing_max_shots_per_beat: int = 3

    # HTTP
    cors_origins: list[str] = ["http://localhost:5173"]
    external_timeout_seconds: float = 10.0
    # Embedding several frames in one request is slower than a metadata check.
    embedding_timeout_seconds: float = 60.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
