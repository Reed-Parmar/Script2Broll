# Script2Broll — Deployment, Configuration & Security Plan

Part of the planning package. Master document: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

---

## 1. Current setup (verified)

- `docker-compose.yml`: one service `db` (`pgvector/pgvector:pg17`), credentials `script2broll`
  (local dev only), host port `${POSTGRES_PORT:-5432}`, volume `pgdata`, `pg_isready` healthcheck.
- Backend runs on the host: `uv run uvicorn app.main:app --port 8000` (Python ≥ 3.12; the dev
  machine's venv uses 3.14). FFmpeg/ffprobe must be on `PATH`.
- Frontend runs on the host: Vite dev server on 5173 proxying `/api` → backend.
- Ollama runs natively on the host (GPU), `OLLAMA_URL=http://localhost:11434`.
- CLIP weights download to the Hugging Face cache on first use.
- Local machine note: a native PostgreSQL also listens on 5432 here, so this machine uses
  `POSTGRES_PORT=5433` in `.env`.

---

## 2. Target Docker layout (Phase 10, optional before then)

Keep compose minimal; add services only when they help teammates run the demo.

```yaml
services:
  db:                      # unchanged
    ...
  backend:                 # NEW (optional until the demo needs it)
    build: ./backend       # Dockerfile: python:3.12-slim + ffmpeg + uv sync --frozen (CPU torch)
    env_file: .env
    environment:
      DATABASE_URL: postgresql+psycopg://script2broll:script2broll@db:5432/script2broll
      OLLAMA_URL: ${OLLAMA_URL:-http://host.docker.internal:11434}
      DATA_DIR: /data
      HF_HOME: /models/hf
    volumes:
      - ./data:/data              # local dataset, caches, exports (git-ignored)
      - hf-cache:/models/hf       # CLIP weights survive rebuilds
    command: sh -c "python -m scripts.init_db && uvicorn app.main:app --host 0.0.0.0 --port 8000"
    ports: ["8000:8000"]
    depends_on: { db: { condition: service_healthy } }
    healthcheck: { test: ["CMD", "python", "-c", "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')"], interval: 10s, retries: 10 }
  ollama:                  # OPTIONAL profile; prefer native Ollama on Windows for GPU access
    image: ollama/ollama
    profiles: ["llm"]
    volumes: [ollama:/root/.ollama]
    ports: ["11434:11434"]
volumes: { pgdata: {}, hf-cache: {}, ollama: {} }
```

Notes:
- **Migrations** = `scripts.init_db` at backend start (idempotent; DATA_MODEL_PLAN §6).
- **Model availability**: `docker compose exec ollama ollama pull qwen2.5:3b` (or native `ollama pull`);
  `/health/ai` reports `not pulled` clearly (exists). CLIP weights download on first start (≈ 600 MB)
  into `hf-cache`.
- **GPU**: GPU passthrough on Windows Docker is fiddly; run Ollama natively and point the container
  at `host.docker.internal`. CLIP on CPU is fast enough for ~209 clips and query embedding.
- **Frontend**: stays a separate dev server or static build served by any web server; it only needs
  the backend URL (`VITE_BACKEND_URL`). Not containerised by this plan.
- Exports/caches live in the mounted `./data` volume, never in the image.

---

## 3. Configuration (all via environment / `.env`; placeholders only in `.env.example`)

Existing: `DATABASE_URL, POSTGRES_PORT, LLM_PROVIDER, LLM_TIMEOUT_SECONDS, GEMINI_API_KEY,
GEMINI_LLM_MODEL, OLLAMA_URL, OLLAMA_MODEL, EMBEDDING_PROVIDER, EMBEDDING_MODEL, EMBEDDING_DIM,
PIXABAY_API_KEY, DATA_DIR, FRAMES_PER_VIDEO, CORS_ORIGINS` (+ `EXTERNAL_TIMEOUT_SECONDS`,
`EMBEDDING_TIMEOUT_SECONDS`).

Planned additions:

| Phase | Variable | Default | Notes |
|---|---|---|---|
| 5.0 | `OLLAMA_NUM_CTX` | `8192` | sent as `options.num_ctx` |
| 5.0 | `LLM_MAX_REPAIRS` | `1` | schema-repair re-asks |
| 5.0 | `LLM_MAX_RETRIES` | `1` | transient errors only |
| 5 | `CLOUD_PROVIDERS` | `""` | e.g. `pixabay` |
| 5 | `RETRIEVAL_LOCAL_K` / `RETRIEVAL_CLOUD_K` | `top_k` / `0` | request may override |
| 5 | `CLOUD_QUERIES_PER_BEAT`, `CLOUD_MAX_REQUESTS_PER_SCRIPT`, `CLOUD_TIMEOUT_SECONDS` | `1`, `20`, `5` | |
| 5 | `PROVIDER_CACHE_TTL_HOURS` | `24` | Pixabay requirement |
| 5 | `PIXABAY_RATE_LIMIT_PER_MINUTE`, `PIXABAY_VIDEO_TYPE`, `PIXABAY_MIN_WIDTH` | `90`, `film`, `1280` | |
| 5 (gated) | `GETTY_API_KEY`, `GETTY_API_SECRET` | empty | SecretStr |
| 6 | `RANKING_ENABLED` | `false` until benchmarked | |
| 6 | `RANK_W_SEMANTIC, RANK_W_PRIMARY, RANK_W_DURATION, RANK_W_QUALITY, RANK_W_VIBE` | `0.55, 0.20, 0.10, 0.10, 0.05` | starting values |
| 6 | `MMR_LAMBDA`, `COVERAGE_BONUS`, `NEAR_DUPLICATE_THRESHOLD`, `RANK_POOL_SIZE`, `CLOUD_PREFERENCE` | `0.7, 0.05, 0.93, 30, 0.9` | |
| 7 | `VIBE_ENABLED` | `false` until validated | |
| 8 | `PACING_WORDS_PER_MINUTE`, `PACING_MIN_SHOT_SECONDS`, `PACING_MAX_SHOT_SECONDS`, `PACING_MAX_SHOTS_PER_BEAT` | `150, 1.5, 8, 3` | |
| 9 | `STORYBOARD_ALTERNATES`, `REUSE_MIN_GAP_BEATS` | `5`, `3` | |
| 10 | `EXPORT_WIDTH, EXPORT_HEIGHT, EXPORT_FPS, EXPORT_MAX_CONCURRENT, EXPORT_CACHE_MAX_GB` | `1920, 1080, 30, 1, 5` | |

Rule: every new setting has a default that keeps previous behaviour; documented in README and `.env.example`.

---

## 4. Security checklist (every phase)

- [ ] Keys only in `.env` (ignored) and typed `SecretStr`; `.env.example` contains empty placeholders.
- [ ] No key in any response, log line, exception message, cache row or exported file.
- [ ] `httpx`/`httpcore` loggers at WARNING in the API process (httpx logs full URLs at INFO; the Pixabay key is a query parameter).
- [ ] Provider errors pass through `ProviderError` with fixed client-safe text (existing pattern).
- [ ] No endpoint fetches a client-supplied URL; remote proxies use provider + validated id + allow-list.
- [ ] All served files go through the `_library_file` containment check under `DATA_DIR`.
- [ ] Getty OAuth tokens held in memory only.
- [ ] Database URL never echoed (existing `_database_error` handler).
- [ ] CORS origins stay explicit (no `*`).
- [ ] Attribution fields always present in candidates (Pixabay requirement).

---

## 5. Observability in deployment
- Uvicorn access logs + app logs with request ids (ARCHITECTURE_PLAN §8).
- `/health`, `/health/database`, `/health/ai`, `/health/pixabay`, `/health/providers` for readiness;
  the compose healthcheck uses `/health` (liveness) to avoid failing on optional providers.
- Export job table doubles as an audit log of renders.
