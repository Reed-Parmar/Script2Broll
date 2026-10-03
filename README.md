# EpochScript2Broll

AI-powered semantic B-roll retrieval: describe a shot in plain language, get matching stock footage.

**Current stage:** Phase 3, editorial intent. A text query is embedded and matched against
clip-level visual embeddings in pgvector by cosine similarity (semantic search). Optionally, a script
sentence is first interpreted by a language model (editorial search, below).

**Temporal localization is not implemented in the Phase 1 MVP.** The searchable unit is a whole
clip; the system does not find where inside a clip a query matches.

## Semantic search architecture

```
React (Vite) ──/api proxy──▶ FastAPI  POST /v1/search
                               │
                       SemanticSearchService            (services/retrieval.py)
                         │                 │
              EmbeddingProvider       VectorStore
              (local OpenCLIP)        (PgVectorStore: PostgreSQL + pgvector, cosine/HNSW)

Ingestion (scripts/ingest.py -> services/ingestion.py):
  VideoSourceProvider (Pixabay) -> download to DATA_DIR -> ffprobe validate
  -> FFmpeg: 8 frames -> EmbeddingProvider.embed_images -> mean -> VectorStore.upsert
```

The search service and ingestion depend only on the `EmbeddingProvider`, `VectorStore` and
`VideoSourceProvider` interfaces; `providers/factory.py` is the only place concrete classes
(CLIP or Gemini, pgvector, Pixabay) are chosen.

| Topic | Phase 1 choice |
|---|---|
| Embedding model | Local OpenCLIP `ViT-B-32/laion2b_s34b_b79k`, 512 dims (CPU; CUDA if available). Gemini Embedding 2 (768 dims) remains selectable via `EMBEDDING_PROVIDER=gemini` |
| Query embedding | CLIP text encoder on the raw query; frames go through the CLIP image encoder (same space) |
| Frame sampling | 8 frames per clip at the centres of 8 equal segments (deterministic; skips fade-in/out edges), max 512 px wide |
| Frame embedding | One embedding per frame (CLIP preprocessing: resize shortest side to 224, centre crop) |
| Aggregation | Mean of the 8 L2-normalised frame vectors, re-normalised (`embedding_type = visual_mean`) |
| Storage | `embeddings(entity_type='video', entity_id, embedding_type, model_name, vector(512), created_at)`, HNSW `vector_cosine_ops` index; unique per (video, type, model) |
| Ranking | Cosine similarity only (`score = 1 - cosine distance`); no reranking |
| Thumbnails | Middle sampled frame, saved to `DATA_DIR/thumbnails/{id}.jpg` |

Per clip, `videos.extra.embedding` records `{model, dim, frames, aggregation}`.

## Editorial search (Phase 3)

```
script sentence ──▶ EditorialIntentAnalyzer ──▶ EditorialAnalysis (validated) ──▶ build_retrieval_query
                    (LLMProvider: Ollama/Gemini,    topic, editorial_intent,        (deterministic)
                     JSON-schema output)            visual_role, visual_description        │
                                                                                            ▼
                                                     existing SemanticSearchService (CLIP + pgvector)
```

`services/editorial.py` holds the layer. The LLM only interprets language; it never embeds or ranks.

- **Schema:** `topic`, `editorial_intent` (one of `context, introduction, explanation, problem, cause,
  effect, evidence, comparison, process, transition, human_impact, conclusion`), `visual_role`,
  `visual_description`, plus `original_text` and `retrieval_query` added by the backend.
- **Validation:** the model is asked for schema-constrained JSON, then the reply is parsed and validated
  with Pydantic. Malformed JSON, missing/empty fields, wrong types or an unknown intent raise an error
  (HTTP `502`) instead of reaching search. Extra fields from the model are ignored.
- **Retrieval query:** the visual description (a stock-footage-style caption of one filmable shot),
  with the topic prepended only if the description doesn't already name it, capped at 32 words for
  CLIP. Intent and visual role are left out on purpose: they describe purpose, which no frame shows.
- **LLM:** `LLM_PROVIDER=ollama` (local, free; default model `qwen2.5:3b`, `ollama pull qwen2.5:3b`)
  or `gemini` (`GEMINI_LLM_MODEL`; needs a key with billing).

```bash
curl -X POST localhost:8000/v1/editorial/analyze -H "Content-Type: application/json" \
  -d '{"text": "Despite the rapid growth of electric vehicles, charging infrastructure remains a major obstacle."}'
curl -X POST localhost:8000/v1/search -H "Content-Type: application/json" \
  -d '{"query": "<script sentence>", "mode": "editorial", "top_k": 6}'
```

Search responses include `mode` (`semantic` default, or `editorial`), `retrieval_query` (the text
that was actually embedded) and, in editorial mode, the full `editorial` analysis plus an `analysis`
timing. Semantic search never calls the LLM. The UI has a Semantic / Editorial toggle and shows the
interpretation above the results.

## Full-script analysis (Phase 4 / 4.1)

`POST /v1/script/analyze` with `{"script": "...", "top_k": 12}` (max 5000 chars / 40 sentences).

```
script → sentences (deterministic) → LLM groups consecutive sentence numbers into beats
       → per beat: EditorialIntentAnalyzer (previous beat as context when the line says "this/it/they…")
       → primary query + up to 3 alternative queries (from filmable_visuals, same deterministic builder)
       → existing semantic search per query → union, one entry per video, ranked by best similarity
```

- **Beat text is never rewritten**: it is rebuilt from the original sentences. The model may merge
  sentences but not split one; a sentence with two ideas stays one beat (its alternative queries
  often cover the second idea).
- **Fallbacks are explicit**: an invalid grouping falls back to one beat per sentence
  (`segmentation.method = "sentence_fallback"` plus the reason); a failed beat has
  `status: "error"`; a failed query is listed in that beat's `warnings`.
- **Transparent ranking**: each clip's score is its best cosine similarity over the beat's queries,
  and `matched_query` says which query that was. No blended or learned score.
- Beats expose `filmable_visuals`, `retrieval_query` (primary) and `alternative_queries`.
- Compare local models: `uv run python -m scripts.benchmark_llm --models qwen2.5:3b qwen2.5:7b --out report.md`
  (human-review report; reference labels are hints, not ground truth).

## Layout

```
backend/            FastAPI app (Python 3.12, uv)
  app/
    config.py       Settings from env / .env (secrets as SecretStr)
    main.py         App factory, CORS, routers, provider/database error handlers
    api/            health.py; search.py (/v1/search, /v1/videos/...)
    db/             SQLAlchemy engine/session, models (videos, embeddings)
    providers/      Replaceable external services
      llm/            LLMProvider          -> OllamaLLMProvider, GeminiLLMProvider (editorial intent)
      embedding/      EmbeddingProvider    -> ClipEmbeddingProvider (default), GeminiEmbeddingProvider
      video_source/   VideoSourceProvider  -> PixabayVideoProvider
      factory.py      config name -> concrete provider / vector store
    vectorstore/    VectorStore -> PgVectorStore
    services/       frames.py (FFmpeg), ingestion.py, retrieval.py (SemanticSearchService),
                    editorial.py (editorial intent + retrieval query)
  scripts/
    init_db.py      pgvector extension + tables (+ dimension check)
    ingest.py       Build the library from Pixabay
    evaluate.py     Manual validation queries + timing baseline
  tests/
frontend/           React + TypeScript + Vite + Tailwind (search page + service status)
docker-compose.yml  PostgreSQL 17 + pgvector
```

## Setup

Requires Docker, Python 3.12 + uv, Node 20+, and FFmpeg (`ffmpeg`/`ffprobe` on PATH).

```bash
cp .env.example .env            # then fill in PIXABAY_API_KEY (GEMINI_API_KEY is optional)

docker compose up -d db

cd backend
uv sync
uv run python -m scripts.init_db
uv run uvicorn app.main:app --reload --port 8000

cd ../frontend
npm install
npm run dev                     # http://localhost:5173 (proxies /api -> :8000)
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | local docker-compose DB | PostgreSQL + pgvector |
| `POSTGRES_PORT` | `5432` | Host port docker-compose publishes the DB on (use e.g. `5433` if 5432 is taken) |
| `GEMINI_API_KEY` | – | Gemini LLM (unused by search); embeddings only if `EMBEDDING_PROVIDER=gemini` (needs billing) |
| `LLM_PROVIDER` | `gemini` | Language model for editorial intent: `gemini` or `ollama` |
| `GEMINI_LLM_MODEL` | `gemini-2.5-flash` | Gemini LLM model |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://localhost:11434` / `qwen2.5:3b` | Local Ollama server and model |
| `LLM_TIMEOUT_SECONDS` | `60` | Per-request LLM timeout |
| `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` / `EMBEDDING_DIM` | `clip` / `ViT-B-32/laion2b_s34b_b79k` / `512` | Embedding space (CLIP model is `<architecture>/<pretrained tag>`; weights download to the Hugging Face cache on first use). Changing any requires re-embedding; changing the dimension also requires recreating `embeddings` |
| `PIXABAY_API_KEY` | – | Pixabay video search (backend only) |
| `DATA_DIR` | `<repo>/data` | Downloaded clips and thumbnails (git-ignored) |
| `FRAMES_PER_VIDEO` | `8` | Frames sampled per clip |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | Allowed browser origins |

## Populating the dataset

```bash
cd backend
uv run python -m scripts.ingest      # 14 distinct topics x 3 clips (~42 clips, ~330 MB)
uv run python -m scripts.ingest --local [--limit 2]   # index clips already in data/videos, no downloads
```

`--local` registers every `data/videos/<provider>_<id>.mp4` and indexes it without re-downloading;
creator/tags are looked up from Pixabay by id when `PIXABAY_API_KEY` is set.

- Pixabay is searched per topic; clips over 60 s are skipped; the ~720p rendition is downloaded.
- Each clip is validated with ffprobe (corrupt files are marked `failed`), real duration/resolution
  are stored, 8 frames are embedded, and the mean vector is upserted.
- **Idempotent / resumable:** clips are unique on (provider, source id); downloads are reused; a clip
  is only embedded if it has no `visual_mean` embedding for the current `EMBEDDING_MODEL`. If the run
  stops (quota, billing), re-run it, or use `--pending` to process registered clips only.
- Embeddings from different models are never mixed: search filters on the configured model, and
  `init_db`/`ingest` refuse to run if `EMBEDDING_DIM` differs from the stored vector dimension.
- Custom topics: `uv run python -m scripts.ingest --queries "ev charging, city traffic" --per-query 5`.

Pixabay results are cached locally and served from our backend; review Pixabay's API terms before
any public deployment.

## Running semantic search

- UI: open http://localhost:5173, type a query (e.g. "people charging an electric vehicle").
  Results show the thumbnail (hover or press play to preview), similarity score, duration, source and creator.
- API (via the backend directly, without the `/api` proxy prefix):

```bash
curl -X POST localhost:8000/v1/search -H "Content-Type: application/json" \
  -d '{"query": "people charging an electric vehicle", "top_k": 10}'
```

```json
{ "query": "...", "model": "gemini-embedding-2", "timings_ms": {"embedding": 0, "search": 0, "total": 0},
  "results": [{ "video_id": 6, "score": 0.42, "source": "Pixabay", "source_id": "200682",
                "source_url": "https://pixabay.com/videos/id-200682/", "creator": "...", "tags": ["..."],
                "duration": 23.5, "width": 960, "height": 540,
                "video_url": "/v1/videos/6/file", "thumbnail_url": "/v1/videos/6/thumbnail" }] }
```

`query`: 1–500 chars (whitespace-normalised); `top_k`: 1–50 (default 12). Media URLs are relative to
the API root. Errors: `422` invalid input, `502` embedding provider failure, `503` provider not
configured or database unavailable; messages never include keys or raw upstream errors.

| Endpoint | Purpose |
|---|---|
| `POST /v1/search` | Semantic search; `"mode": "editorial"` analyses the text first |
| `POST /v1/editorial/analyze` | Editorial-intent analysis only (`{"text": ...}`) |
| `GET /v1/videos/{id}` | Clip metadata |
| `GET /v1/videos/{id}/file` | Clip stream (supports HTTP Range for seeking) |
| `GET /v1/videos/{id}/thumbnail` | Thumbnail JPEG |

Manual validation + timing baseline: `uv run python -m scripts.evaluate` (10 validation queries;
prints top results with scores, ingestion topic, tags and thumbnail paths for human judgement).

## Health checks

| Endpoint               | Verifies                                         |
|------------------------|--------------------------------------------------|
| `GET /health`          | API process is up                                |
| `GET /health/database` | PostgreSQL reachable, pgvector installed, stored embedding dimension |
| `GET /health/ai`       | Configured embedding provider loads and embeds (CLIP) or key/model valid (Gemini); LLM state (Ollama model pulled / Gemini key) reported but not required |
| `GET /health/pixabay`  | Pixabay key valid; video search responds         |

They return `200 {"status":"ok"}` or `503` with `not_configured` / `error`. Responses never contain secrets.
With Gemini embeddings, `/health/ai` only reads model metadata (free); it does not detect exhausted billing/credits.

## Tests

```bash
cd backend
uv run pytest                   # unit tests mock CLIP/Gemini/Pixabay; integration tests use the real
                                # DB and FFmpeg (skipped if unavailable) with a fake embedder;
                                # LLM replies are mocked
RUN_CLIP_MODEL_TESTS=1 RUN_LLM_TESTS=1 uv run pytest   # also run the real CLIP model / configured LLM
```

## Known limitations

- Temporal localization is not implemented in the Phase 1 MVP: whole clips are ranked, not moments.
- A clip is one mean vector of 8 frames; clips that change subject mid-way are blurred together.
- Ranking is raw cosine similarity: no reranking, keyword boosting or near-duplicate collapsing
  (Pixabay sometimes has several near-identical clips of one shoot).
- The library is small (~42 clips), so many queries have no truly relevant clip; results are then
  "nearest available", not "relevant". Scores are only comparable within one model.
- No migration tool: schema changes are applied by `init_db` (additive `ALTER ... IF NOT EXISTS`).
- Ingestion is sequential and synchronous (CLI only; no ingestion API).
- Editorial analysis is one sentence at a time (max 500 chars) with no script context; its quality
  depends on the LLM (a small local model is fast and free but less nuanced than a hosted one).

## Security

- All API keys live in `.env` (git-ignored). Only the backend reads them.
- The frontend only calls our backend. Pixabay, Gemini and Ollama requests never originate in the browser;
  clips and thumbnails are served by the backend by video id (no client-supplied paths).
