# Script2Broll — Architecture Plan

Part of the planning package. Master document: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

This document records **what the repository actually contains today** (verified by inspection on
2026-10-03, HEAD `61100b9`), the target architecture for the
remaining phases, and the cross-cutting rules (LLM, embeddings, errors, performance, observability,
security) that every phase must follow.

---

## 1. Current architecture audit

### 1.1 Repository layout (tracked files)

```
backend/
  app/
    main.py                  FastAPI app factory; CORS (GET, POST only); ProviderError -> 502/503; SQLAlchemyError -> 503
    config.py                pydantic-settings Settings (SecretStr keys), repo-root .env
    api/
      health.py              GET /health, /health/database, /health/ai, /health/pixabay
      search.py              POST /v1/search (semantic | editorial); GET /v1/videos/{id}, /file, /thumbnail
      editorial.py           POST /v1/editorial/analyze; clean_text(); MAX_TEXT_LENGTH=500
      script.py              POST /v1/script/analyze (Phase 4/4.1)
    db/
      models.py              Video, Embedding (Vector(EMBEDDING_DIM), HNSW cosine index)
      session.py             cached Engine, request-scoped Session, vector_column_dim(), check_database()
    providers/
      errors.py              ProviderError (client-safe message), ProviderNotConfigured
      factory.py             the only config-name -> class mapping
      gemini_client.py       shared google-genai client + error translation
      embedding/  base.py (EmbeddingProvider, l2_normalize, mean_vector), clip.py, gemini.py
      llm/        base.py (LLMProvider.generate(prompt, json_schema)), ollama.py, gemini.py
      video_source/ base.py (VideoCandidate, VideoSourceProvider.search/get/check), pixabay.py
    services/
      frames.py              ffprobe validation + 8 deterministic frames (segment centres, <=512 px)
      ingestion.py           IngestionService: Pixabay query ingest, local-file ingest, pending re-embed
      retrieval.py           SemanticSearchService.search(); multi_query_search() (Phase 4.1)
      editorial.py           EditorialIntent enum, EditorialAnalysis schema, prompt, parser, query builders
      script.py              split_sentences, ScriptSegmenter (+fallback), ScriptAnalysisService
    vectorstore/ base.py (VectorStore, VectorMatch), pgvector.py (PgVectorStore)
  scripts/  init_db.py, ingest.py, evaluate.py, benchmark_llm.py
  tests/    14 files, 199 tests collected (196 pass + 3 opt-in skips in the last full run)
frontend/   React 19 + TS + Vite 8 + Tailwind 4 (owned by a teammate; out of scope here)
docker-compose.yml           PostgreSQL 17 + pgvector only (port via POSTGRES_PORT)
.env.example                 placeholders only
docs/                        this planning package
```

### 1.2 Implemented pipelines (verified in code)

**Ingestion (offline, CLI)** — `scripts/ingest.py` → `IngestionService`
```
Pixabay search (or data/videos/<provider>_<id>.mp4 for --local)
  → register Video row (unique source_provider+source_id; idempotent)
  → download ~720p rendition to DATA_DIR/videos (reused if present)
  → ffprobe validate → 8 frames at segment centres (FFmpeg) → CLIP image embeddings
  → mean pool + L2 normalise → upsert embeddings(entity_type='video', embedding_type='visual_mean', model_name)
  → middle frame copied to DATA_DIR/thumbnails/<videos.id>.jpg
```

**Semantic search (Phase 2)** — `SemanticSearchService.search(session, query, top_k)`:
CLIP text embedding → `PgVectorStore.search` (cosine, HNSW, `hnsw.iterative_scan = relaxed_order`,
filtered by model_name + embedding_type) → `Video` rows → `SearchHit(video, score)`.

**Editorial (Phase 3)** — `EditorialIntentAnalyzer.analyze(text, previous=None)`:
prompt → `LLMProvider.generate(prompt, LLM_RESPONSE_SCHEMA)` → `load_json_object` → Pydantic
`EditorialAnalysis` (topic, 12-value `EditorialIntent`, visual_role, visual_description,
filmable_visuals ≤ 4) → deterministic `build_retrieval_query` + `build_alternative_queries` (≤ 3).

**Full script (Phase 4 / 4.1)** — `ScriptAnalysisService.analyze(session, script, top_k)`:
`split_sentences` (deterministic; paragraphs, quotes, abbreviations) → `ScriptSegmenter`
(LLM groups *sentence numbers*; beat text rebuilt from the script; strict coverage validation;
invalid output → one beat per sentence, reported as `sentence_fallback`) → per beat:
analyzer (previous beat passed only if the beat contains a reference word) →
`multi_query_search` (primary + alternatives, union by video, best cosine, `matched_query`) →
`BeatResult` (per-beat `error` and `warnings`; DB errors still fail the request).

### 1.3 Verified facts that differ from the project brief

| # | Brief / assumption | Repository reality | Consequence for the plan |
|---|---|---|---|
| D1 | "The local dataset is intentionally tracked in Git" | Commit `a33b378` removed all 418 `data/` files from the index and `f5b76de` added `data/` to `.gitignore`. 209 videos + 209 thumbnails exist **on disk only**. All 209 `.mp4` blobs are still reachable in history (`git count-objects`: 1.49 GiB), so clones are not smaller. | A **team decision** is required (Phase 5.0, step H1). The plan does not delete or move the dataset. |
| D2 | "FFmpeg/OpenCV are used" | Only FFmpeg/ffprobe via `subprocess` (`services/frames.py`). OpenCV is not a dependency. | Do not plan around OpenCV. Visual statistics (Phase 7) use FFmpeg filters. |
| D3 | "Getty may potentially be added" | No Getty code, config or credentials. | Getty is a *gated* optional adapter (see PROVIDER_PLAN §5). |
| D4 | Migrations | No migration tool. `scripts/init_db.py` = `create_all` + additive `ALTER ... IF NOT EXISTS`. | All planned schema changes are additive and fit this approach (DATA_MODEL_PLAN §6). |
| D5 | Thumbnails | Named by **database id** (`thumbnail_path(data_dir, video_id)`). IDs differ per machine (a fresh `ingest --local` assigns new ids). | Persisted storyboards/timelines must reference clips by a stable key, never `videos.id` (DATA_MODEL_PLAN §3). Thumbnail naming fix in Phase 5.0 (H2). |
| D6 | CORS | `allow_methods=["GET", "POST"]` | Phases 9/10 need `PUT`, `PATCH`, `DELETE` added. |
| D7 | Editorial search mode | `/v1/search?mode=editorial` uses only the primary query and no context (Phase 4.1 multi-query applies to `/v1/script/analyze` only). | Keep as is; Phase 5 can opt it into the new retrieval service. |
| D8 | Recent teammate fixes | Commit `61100b9`: Ollama 404 handled only for `/api/generate`, benchmark median guard, README note, `ScriptView.tsx` key. | Already in HEAD; build on them, do not revert. |

### 1.4 Measured performance (dev laptop: i7-13650HX, RTX 3050 6 GB, CLIP on CPU, Ollama on GPU)

| Operation | Measured |
|---|---|
| CLIP model load (first request per process) | ~5 s (cached by `lru_cache` afterwards) |
| CLIP query embedding | ~25–50 ms |
| pgvector search (209 clips) | ~10–80 ms |
| Retrieval per beat, 4 queries (sequential) | ~0.3 s |
| qwen2.5:3b segmentation call | ~0.9–1.2 s (3.3 s cold) |
| qwen2.5:3b editorial analysis per beat | ~3.5–3.8 s |
| qwen2.5:7b per call (27/29 layers on GPU) | ~24–27 s (impractical on this machine) |
| 3-beat script end to end (3b) | ~12–15 s; worst case 40 sentences ≈ 2.5 min |

---

## 2. What must NOT change

1. **PostgreSQL + pgvector** remain the local retrieval store (`embeddings` table, HNSW cosine index).
   No MongoDB, no Supabase, no second vector database.
2. **OpenCLIP `ViT-B-32/laion2b_s34b_b79k`, 512 dims, 8 frames, mean pooling + L2 normalisation.**
   Change only through the versioned migration procedure in §5.
3. **The script is never rewritten.** Beats are rebuilt from sentence numbers. Any future split
   operation must also be index/offset-based, never model-generated text.
4. **Deterministic query construction** (`build_retrieval_query`, `build_alternative_queries`).
5. **Pixabay** (`PixabayVideoProvider`) stays, both for ingestion and as the first cloud source.
6. **Provider boundary rules**: concrete classes are chosen only in `providers/factory.py`;
   `ProviderError` messages are client-safe; keys are `SecretStr` and never logged or returned.
7. **Existing API fields** keep their names and meaning. All changes are additive (API_PLAN §2).
8. **Normal test suite needs no Ollama, Gemini or provider network access.**
9. **No temporal localization.** The retrieval unit is a whole short clip. Choosing an in-point for
   display (e.g. "skip the first second") is trimming, not searching inside a video.

---

## 3. Target architecture

```
                         ┌──────────────────────────── API (FastAPI routers) ────────────────────────────┐
                         │ /v1/search  /v1/editorial  /v1/script  /v1/storyboards  /v1/projects  /v1/exports │
                         └───────────────────────────────────────┬───────────────────────────────────────┘
                                                                 │
  WHAT / WHY (LLM, existing)            WHICH (retrieval)                 HOW / WHEN (deterministic)         EDIT
  ┌──────────────────────────┐  ┌───────────────────────────────────┐  ┌───────────────────────────┐  ┌──────────────────┐
  │ ScriptSegmenter          │  │ BrollRetrievalService  (Phase 5)  │  │ VibeAnalyzer (7, LLM once) │  │ StoryboardService│
  │ EditorialIntentAnalyzer  │→ │  ├ LocalCandidateSource           │→ │ RankingService (6)         │→ │  (9) selection   │
  │ (Phases 3–4.1)           │  │  │   └ SemanticSearchService      │  │ PacingService (8)          │  │ TimelineService  │
  └──────────────────────────┘  │  │       └ PgVectorStore/CLIP     │  └───────────────────────────┘  │ ExportService(10)│
                                │  └ CloudCandidateSource            │                                 └──────────────────┘
                                │      └ VideoSourceProvider         │
                                │          ├ PixabayVideoProvider    │
                                │          └ GettyVideoProvider*     │   * gated on access/licensing
                                │  → normalise → dedupe → label      │
                                └───────────────────────────────────┘
         Persistence: PostgreSQL — videos, embeddings (existing); provider_cache (5);
                      remote_assets (6); projects, storyboards (9); timelines, export_jobs (10)
```

Thesis mapping:

| Question | Component | Nature |
|---|---|---|
| WHAT is discussed | segmentation + editorial `topic` | LLM + deterministic validation |
| WHY (what the viewer should understand) | `editorial_intent`, `visual_role`, `filmable_visuals` | LLM |
| HOW it should feel | `Vibe` (Phase 7) | LLM once per script + deterministic clip features |
| WHEN visuals change | pacing (Phase 8) | deterministic |
| WHICH footage | retrieval (5) + ranking (6) + storyboard selection (9) | deterministic over CLIP/pgvector + providers |

### 3.1 Layering rules (enforced by review)

- `api/*` → validates input, builds services via dependencies, maps domain objects to response models. No ranking or provider logic in routers.
- `services/*` → domain logic. Depends on provider **interfaces**, never on concrete providers.
- `providers/*` → one class per external system; translate failures into `ProviderError`.
- `vectorstore/*` → only place that writes SQL for vectors.
- New phases add new service modules; they do not edit the internals of earlier phases except at
  the documented integration points (listed per phase in the roadmap).

---

## 4. LLM architecture

### 4.1 Current state
- `LLMProvider.generate(prompt, json_schema) -> str`; Ollama sends `format=<schema>`, `temperature 0`,
  `seed 0`; Gemini sends `response_mime_type=application/json` + `response_json_schema`, `temperature 0`.
- Validation: `load_json_object` (fence stripping, object check) → Pydantic model → domain checks.
- Prompts are module constants (`editorial.PROMPT`, `script.SEGMENTATION_PROMPT`) without version ids.
- No retries in either LLM provider; Ollama `num_ctx` is not set (server default applies).
- A new `httpx.Client` / genai client is built per request (factory called per request).

### 4.2 Where an LLM is genuinely needed (and nowhere else)

| Task | LLM? | Reason |
|---|---|---|
| Sentence splitting | No | regex + abbreviation list (exists) |
| Beat grouping | **Yes** | semantic judgement of visual/story change |
| Editorial intent, visual role, filmable visuals | **Yes** | interpretation |
| Retrieval / keyword query construction | No | deterministic builders |
| Script-level vibe | **Yes** (one call per script) | tone interpretation |
| Beat vibe | No (inherit + deterministic intent modifiers) | avoid per-beat calls |
| Ranking, diversity, pacing, storyboard selection, timeline, export | No | deterministic, testable, explainable |
| Storyboard "purpose" text | No | reuse `visual_role` from the editorial analysis |

### 4.3 Planned evolution (Phase 5.0, step H4 — small, contained)

1. **Structured-output helper** `app/services/llm_json.py`:
   ```python
   def generate_validated(llm, prompt, schema: dict, parse: Callable[[str], T],
                          max_repairs: int) -> T:
       raw = llm.generate(prompt, json_schema=schema)
       for attempt in range(max_repairs + 1):
           try:
               return parse(raw)                      # raises EditorialAnalysisError / SegmentationError
           except ProviderError as exc:               # only *validation* errors are repaired
               if attempt == max_repairs:
                   raise
               raw = llm.generate(prompt + REPAIR_SUFFIX.format(error=str(exc)), json_schema=schema)
   ```
   `REPAIR_SUFFIX` = "Your previous reply was invalid: {error}. Return only JSON matching the schema."
   Default `LLM_MAX_REPAIRS=1`. Segmentation keeps its sentence fallback *after* repairs fail.
2. **Transient-error retries inside providers**: retry once on timeout / HTTP 429 / 5xx with
   1–2 s backoff, bounded by `LLM_TIMEOUT_SECONDS`. Never retry 4xx auth errors.
3. **Prompt versions**: `PROMPT_VERSION = "editorial-v3"`, `SEGMENTATION_PROMPT_VERSION = "segmentation-v3"`
   (and `vibe-v1` later). Returned in a new additive `analysis_meta` object
   `{llm_provider, llm_model, prompt_versions}` and recorded in storyboards and benchmark reports.
4. **Context window**: add `OLLAMA_NUM_CTX` (default `8192`) sent as `options.num_ctx`. A 5000-char
   script (~1.3k tokens) plus the ~500-token segmentation prompt approaches small server defaults;
   silent truncation would corrupt segmentation. **Verify** the installed Ollama version's default.
5. **Client reuse**: cache provider instances per settings (e.g. `functools.lru_cache` on a factory
   keyed by the relevant config tuple) so HTTP connections are reused.
6. **Model configurability**: keep `LLM_PROVIDER`, `OLLAMA_MODEL`, `GEMINI_LLM_MODEL`. Optional later:
   per-task overrides `LLM_MODEL_SEGMENTATION`, `LLM_MODEL_EDITORIAL`. Any new hosted provider
   (e.g. an OpenAI-compatible endpoint) is a new `LLMProvider` subclass + factory branch only.
7. **Model upgrades are benchmark-driven** (`scripts/benchmark_llm.py`): qwen2.5:7b reasoned better
   in Phase 4.1 but took ~25 s/call here; Gemini is blocked by billing. No automatic switching.

### 4.4 Determinism statement
Temperature 0 + seed 0 + schema-constrained decoding made segmentation identical across 5 runs
and kept intent + primary query identical; secondary wording (filmable visuals) still varied.
Do not promise bit-identical LLM output. Reproducibility of *stored* artefacts (storyboards) comes
from persisting the LLM output, not from re-running the model.

---

## 5. Embedding architecture

### 5.1 Current state
- `ClipEmbeddingProvider` (OpenCLIP), weights loaded once per process (`lru_cache`), guarded by a
  lock, CPU or CUDA; outputs validated (dim, finite, non-zero) and L2-normalised.
- Frames: 8 at segment centres, ≤ 512 px wide; CLIP preprocessing centre-crops to 224×224.
- One clip vector = normalised mean of frame vectors (`embedding_type='visual_mean'`).
- `embeddings.vector` is `vector(EMBEDDING_DIM)`; the column dimension is fixed at creation time;
  `init_db`/`ingest` refuse to run if `EMBEDDING_DIM` differs from the stored dimension.
- Search filters on `model_name` + `embedding_type`, so different models never mix in results.

### 5.2 Gap: pipeline parameters are not part of the embedding identity
`FRAMES_PER_VIDEO` (and the pooling method) are recorded only in `videos.extra.embedding`. Changing
`FRAMES_PER_VIDEO` would silently mix 8-frame and N-frame vectors under the same
`(model_name, embedding_type)`. **Phase 5.0 (H3)**: `ingest` and `init_db` compare the configured
`FRAMES_PER_VIDEO` with the value stored in existing rows' `extra.embedding.frames` and refuse to run
on mismatch (same pattern as the dimension check). No schema change.

### 5.3 Versioning and migration procedure (for any future model change)
- **Same dimension, different model**: set the new `EMBEDDING_MODEL`; run `ingest --pending`
  (already embeds only clips lacking a vector for the configured model). Old rows remain; switching
  back is instant. Benchmark with `scripts/eval_retrieval.py` before switching the default.
- **Different dimension**: the column cannot hold both. Procedure: rename `embeddings` →
  `embeddings_<old_model_slug>` (keeps a rollback), run `init_db` (creates a new table with the new
  dimension and HNSW index), run `ingest --pending`. At 209 clips this takes minutes.
- New embedding *types* (e.g. Phase 6 `thumbnail` vectors for cloud assets) reuse the table with a
  distinct `embedding_type` and `entity_type`, so they can never leak into `visual_mean` searches.
- **Do not change the model** without a retrieval benchmark showing a gain; ViT-B/32 is adequate
  for a 209-clip MVP.

### 5.4 Planned (optional) embedding work
- Phase 5.0 (H6, perf): embed all of a beat's queries in **one** `embed_texts` batch, then run vector
  searches with precomputed vectors (`SemanticSearchService.search_vector(...)`).
- Phase 6: per-candidate per-query similarity matrix (dot products of already-normalised vectors in
  NumPy; candidate vectors fetched from `embeddings` by `entity_id`).
- Phase 6: cloud thumbnail embeddings (`entity_type='remote_asset'`, `embedding_type='thumbnail'`).
- Phase 7: vibe prompt text embeddings (cached in-process; 10–20 short prompts).

---

## 6. Error handling model

### 6.1 Principles
- **Degrade, don't fail**, when the failed part is optional for the response (cloud, alternatives,
  vibe, ranking). **Fail fast** when the core dependency is missing (database, embedding model).
- Every degradation is **reported** (`warnings`, `status` fields, `provider_status`). Never silent.
- Client messages come only from `ProviderError` (safe) or fixed strings; raw upstream text, URLs
  with keys, and connection strings are never returned (existing rule; keep it).

### 6.2 Failure matrix

| Failure | Scope | Behaviour | HTTP |
|---|---|---|---|
| Database / pgvector unreachable | request | fail (existing `SQLAlchemyError` handler) | 503 `Database unavailable` |
| CLIP weights missing / load error | request | fail (`ProviderError`) | 502 |
| LLM not configured | request (LLM paths only) | fail; semantic search unaffected | 503 |
| LLM unreachable / timeout at segmentation | request | fail (every beat would fail too) | 502 |
| LLM malformed output at segmentation | request | repair once → sentence fallback, reported | 200 |
| LLM failure / malformed for one beat | beat | repair once → `status:"error"` + message; other beats continue | 200 |
| One local query fails (embedding) | query | skip, `warnings` entry; beat fails only if all fail | 200 |
| Cloud provider not configured | provider | `provider_status = "not_configured"`, local results returned | 200 |
| Cloud provider 429 / timeout / 5xx | provider | one bounded retry (timeouts/5xx only); then `provider_status = "error"`; local results returned | 200 |
| Cloud provider auth error (401/403) | provider | no retry; `error`; logged once at WARNING | 200 |
| Cloud request budget exhausted | provider | remaining beats `provider_status = "skipped_budget"` | 200 |
| Empty results | beat | `candidates: []`, `warnings: ["no results"]` | 200 |
| Vibe inference fails | script | `vibe: null`, vibe weight treated as 0, warning | 200 |
| Local file missing for a clip | asset | `/file` returns 404; storyboard marks shot `asset_unavailable`; export fails that job with a list | 404 / job failed |
| Remote URL expired | asset | re-resolve via `provider.get(id)`; if gone → `asset_unavailable` | 200 / job failed |
| FFmpeg failure during export | job | job `failed`, `error` = sanitised stderr tail (no paths outside DATA_DIR) | job status |
| Oversized script | request | 422 (exists: 5000 chars / 40 sentences) | 422 |
| Version conflict on save | request | 409 with current version | 409 |

---

## 7. Performance plan (in order; stop when fast enough)

1. **Warm-up at startup** (Phase 5.0, H6): FastAPI lifespan hook loads CLIP once (`embed_texts(["warm up"])`) so
   the first user request does not pay ~5 s. Optional `ollama` keep-alive ping.
2. **Batch query embeddings per beat** (H6): one CLIP forward pass for ≤ 4 queries.
3. **Concurrent I/O in Phase 5**: local retrieval and cloud provider calls for a beat run in a small
   `ThreadPoolExecutor` (bounded, e.g. 4 workers). CLIP calls stay serialised by the existing lock.
4. **Pipeline beats**: while the LLM analyses beat *i+1*, retrieval for beat *i* runs in the pool.
   Only after correctness tests are green.
5. **LLM concurrency only where the backend supports it** (`LLM_MAX_CONCURRENCY`, default 1 for
   Ollama; hosted APIs may use 2–4).
6. **Caching**: provider responses (required by Pixabay terms, 24 h), cloud thumbnail embeddings
   (Phase 6), optional in-process LRU for editorial analyses keyed by
   `(prompt_version, model, text, previous)` to make storyboard regeneration cheap.
7. **Async jobs only for export** (Phase 10). Script analysis stays synchronous unless measured
   request times exceed proxy/browser timeouts; then add `POST /v1/script/analyze/jobs` (optional).

Not planned: distributed queues, separate model servers, GPU scheduling, Kubernetes.

---

## 8. Observability

- **Request id** middleware (`X-Request-ID` echoed or generated); included in every log line.
- **Structured log fields** (JSON or key=value): `route`, `duration_ms`, `beats`, `llm_provider`,
  `llm_model`, `prompt_versions`, `embedding_model`, `retrieval_mode`, per-provider
  `{status, requests, cache_hits, latency_ms, results}`, `fallback` flags, counts of beat errors.
- **Response timings** (exists: `timings_ms`) gain `cloud`, `ranking`, `pacing`, `selection` keys.
- **Never log**: API keys, provider request URLs containing keys, database URLs, full script text at
  INFO (log length + SHA-256 prefix instead). Set `httpx`/`httpcore` loggers to WARNING in the API
  process (the ingest script already does this) because httpx logs full URLs at INFO and Pixabay
  puts the key in the query string.
- Optional: `GET /health/stats` with in-process counters (requests, errors by type, provider
  cache hit rate). No Prometheus stack required.

---

## 9. Security and configuration

- Secrets stay in `.env` (ignored: `.env`, `.env.*`, except `.env.example`). Keys typed `SecretStr`.
- New secrets (placeholders only in `.env.example`): `GETTY_API_KEY=`, `GETTY_API_SECRET=`.
- Provider keys never reach the browser: cloud **thumbnails** are proxied by the backend
  (`/v1/remote/...`), cloud **videos** are returned as provider media URLs only when the provider
  allows direct embedding and the URL contains no credential (Pixabay video URLs: verified allowed
  to embed; verify per provider).
- Proxy endpoints accept only `(provider, asset_id)` validated against `^[A-Za-z0-9_-]{1,128}$` and an
  allow-list of enabled providers; they never fetch arbitrary client-supplied URLs (SSRF guard).
- File serving keeps the existing `_library_file` containment check for everything under `DATA_DIR`
  (exports and caches included).
- Attribution data (provider name, page URL, creator) is part of every candidate; the frontend must
  display it whenever results are shown (Pixabay requirement, verified).

See [DEPLOYMENT_PLAN.md](DEPLOYMENT_PLAN.md) for environment variables per phase and Docker.
