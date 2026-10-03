# Script2Broll — Implementation Roadmap (master document)

Planning package for the remaining project. Written from a full inspection of the repository on
2026-10-03 (HEAD `61100b9`). **Nothing here is implemented yet.**

| Document | Contents |
|---|---|
| [ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md) | current-state audit, discrepancies, target architecture, LLM/embedding architecture, error model, performance, observability, security |
| [PROVIDER_PLAN.md](PROVIDER_PLAN.md) | provider interfaces, Pixabay as a cloud source (verified terms), Getty (gated), caching, rate limits |
| [RETRIEVAL_PLAN.md](RETRIEVAL_PLAN.md) | Phase 5 candidate model + orchestration, Phase 6 reranking/diversity, Phase 7 vibe |
| [STORYBOARD_TIMELINE_PLAN.md](STORYBOARD_TIMELINE_PLAN.md) | Phase 8 pacing, Phase 9 storyboard, Phase 10 timeline/export |
| [DATA_MODEL_PLAN.md](DATA_MODEL_PLAN.md) | current schema, stable asset identity, tables per phase, migrations, dataset |
| [API_PLAN.md](API_PLAN.md) | current endpoints, compatibility rules, every future endpoint |
| [TESTING_PLAN.md](TESTING_PLAN.md) | tests per phase, evaluation datasets and metrics, benchmarks |
| [DEPLOYMENT_PLAN.md](DEPLOYMENT_PLAN.md) | Docker, configuration per phase, security checklist |

---

## 1. Current architecture audit (summary — details in ARCHITECTURE_PLAN §1)

- **Backend**: FastAPI; services `frames`, `ingestion`, `retrieval`, `editorial`, `script`;
  providers behind `EmbeddingProvider`, `LLMProvider`, `VideoSourceProvider`, `VectorStore`;
  PostgreSQL 17 + pgvector (`videos`, `embeddings` with HNSW cosine index); schema via `init_db`.
- **Models**: OpenCLIP ViT-B-32 (512-d, CPU) for visual retrieval; Ollama `qwen2.5:3b` (local) or
  Gemini (blocked by billing) for language reasoning. `qwen2.5:7b` is pulled but too slow here (~25 s/call).
- **Data**: 209 Pixabay clips + 209 thumbnails on disk; 209 `videos` rows; 209 `visual_mean` embeddings.
- **Tests**: 199 collected; 196 pass, 3 opt-in skips.
- **Discrepancies with the brief** (must be read before starting):
  1. The dataset is **no longer tracked in Git** (`a33b378` untracked it, `f5b76de` ignores `data/`),
     yet all media blobs remain in history (~1.5 GB). → Decision H1.
  2. No OpenCV — FFmpeg only. 3. No Getty code or config. 4. No migration tool.
  5. Thumbnails are named by machine-specific DB ids. 6. CORS allows only GET/POST.
  7. `/v1/search?mode=editorial` does not use Phase 4.1 multi-query/context.
  8. Recent teammate fixes (`61100b9`) are part of the baseline; do not revert them.

## 2. What is already implemented
Phases 1–4.1 as described in ARCHITECTURE_PLAN §1.2: ingestion (Pixabay + local files, idempotent),
semantic search, editorial analysis (intent, visual role, filmable visuals, deterministic primary +
alternative queries), full-script segmentation (sentence-number grouping, fallback), context-aware
analysis (previous beat when referenced), multi-query local retrieval with dedupe and `matched_query`,
per-beat errors/warnings, timings, LLM benchmark script, health endpoints, minimal frontend.

## 3. What must NOT be changed
PostgreSQL + pgvector; the CLIP model/dimension/frame sampling/pooling (except via the versioned
procedure); the "script is never rewritten" invariant; deterministic query builders; Pixabay
provider and ingestion idempotency; existing API fields (additive changes only); client-safe error
messages; LLM-free normal test suite; no temporal localization. (ARCHITECTURE_PLAN §2.)

## 4. Revised phase structure

The original order (5 cloud → 6 rerank → 7 vibe → 8 pacing → 9 storyboard → 10 editor) is kept, with
three changes justified by the code:

1. **New Phase 5.0 — Hardening & baseline.** Several later phases depend on things that do not exist
   yet: a stable asset identity (storyboards/timelines must survive different DB ids), a retrieval
   evaluation set (Phase 6 cannot be judged without it), prompt versioning and robust LLM JSON
   handling (every LLM phase), and a decision on how teammates obtain the untracked dataset.
2. **Phase 5 split into 5A (candidate model + orchestrator, local only, behaviour-preserving) and 5B
   (Pixabay cloud source), with 5C (Getty) gated.** 5A is the foundation both 5B and 6 build on, so
   5B and 6 can then proceed in parallel.
3. **Phases 9 and 10 split into stateless (9A) and persisted (9B), and timeline (10A) and export
   (10B).** The frontend teammate can integrate storyboard output before persistence exists.

```
Phase 5.0  Hardening & baseline ───────────────────────────────┐
   │                                                            │
Phase 5A   Candidate model + retrieval orchestrator (local)    │
   ├──────────────────────┬─────────────────────────┐          │
Phase 5B  Pixabay cloud   Phase 6 Rerank+diversity   │      Phase 8 Pacing (needs only beats;
   │      (5C Getty,         │                       │       energy input optional from 7)
   │       gated)            │                       │          │
   │                     Phase 7 Vibe ───────────────┼──────────┤
   │   (vibe LLM + clip features can start after 5.0;│          │
   │    vibe_fit scoring needs 6)                    │          │
   └──────────────┬──────────┴───────────────────────┘          │
              Phase 9A Storyboard (stateless) ◄──────────────────┘
                  │
              Phase 9B Storyboard persistence (projects, storyboards)
                  │
              Phase 10A Timeline ──► Phase 10B Export (FFmpeg)
```

Parallel tracks that are safe: {5B, 6} after 5A; 8 any time after 5.0; 7's LLM vibe inference and
clip-feature backfill any time after 5.0 (only `vibe_fit` integration waits for 6); Docker backend
image any time.

## 5. Recommended implementation order (summary)
5.0 → 5A → 6 → 5B → 8 → 7 → 9A → 9B → 10A → 10B (5C only when Getty access is confirmed).
Rationale: ranking (6) on local footage gives the biggest quality gain and needs only 5A; cloud (5B)
then plugs into an already-ranked pipeline; pacing (8) is cheap and unblocks storyboard; vibe (7) is
the least certain signal and is validated before it is weighted. The detailed step list is in
[Recommended Execution Order](#recommended-execution-order).

---

## 6. Phase specifications

Each phase below follows the same template. Detailed designs live in the linked documents; this
section is the checklist an implementer follows.

### Phase 5.0 — Hardening & baseline

**GOAL** Make later phases safe: stable asset identity, reproducible dataset access, robust LLM JSON
handling with versions, and a measured retrieval baseline.

**INPUTS** current repo, 209-clip dataset, team decision on dataset distribution.

**OUTPUTS** H1 dataset decision + manifest; H2 source-keyed thumbnails; H3 frames consistency check;
H4 LLM hardening (`llm_json`, retries, `num_ctx`, prompt versions, `analysis_meta`); H5 retrieval eval
set + `eval_retrieval.py` with baseline numbers; H6 CLIP warm-up + batched query embeddings (perf).

**DATA FLOW** unchanged pipelines; only thumbnails path, LLM call wrapper and response metadata change.

**CURRENT CODE INVOLVED** `services/ingestion.py` (`thumbnail_path`, `_process`), `api/search.py`
(thumbnail endpoint), `scripts/init_db.py`, `scripts/ingest.py`, `providers/llm/ollama.py`,
`providers/llm/gemini.py`, `services/editorial.py`, `services/script.py`, `services/retrieval.py`,
`providers/factory.py`, `main.py`, `api/script.py`, `api/editorial.py`.

**FILES TO MODIFY** the files above, `.gitignore` (only if the team chooses option A/C exception for
`data/manifest.json`), `.env.example`, `README.md`.

**FILES TO CREATE** `app/services/llm_json.py`, `scripts/migrate_thumbnails.py`,
`scripts/dataset_manifest.py`, `scripts/eval_retrieval.py`, `backend/eval/retrieval_qrels.json`,
`backend/eval/segmentation.json`, `backend/eval/intents.json`, tests listed in TESTING_PLAN §3.

**DATABASE CHANGES** none (H3 reads `videos.extra`).

**API CHANGES** additive `analysis_meta` on editorial/script responses; thumbnail endpoint resolves
new file names with legacy fallback.

**SERVICE CHANGES** analyzer/segmenter call `generate_validated`; `SemanticSearchService.search_vector`
(+ batch embedding in `multi_query_search`); lifespan warm-up in `main.py`; provider instances cached.

**PROVIDER CHANGES** Ollama: `num_ctx`, one transient retry; Gemini LLM: one transient retry.

**CONFIGURATION** `OLLAMA_NUM_CTX`, `LLM_MAX_REPAIRS`, `LLM_MAX_RETRIES`.

**TESTS** TESTING_PLAN §3 "Phase 5.0"; full suite stays green.

**BENCHMARKS** record baseline: `eval_retrieval.py --system multiquery` (P@5/10, nDCG@10, MRR,
diversity metrics); `benchmark_llm.py` on the new gold files; `benchmark_pipeline.py` cold/warm timings.

**FAILURE MODES** repair loop must stop after `LLM_MAX_REPAIRS`; thumbnail migration must be idempotent
and never delete a file it cannot map.

**PERFORMANCE** first request no longer pays CLIP load; 4 queries → 1 CLIP forward pass.

**DEFINITION OF DONE** decision H1 recorded in README; manifest verifies 209/209 locally; thumbnails
served by source key on a fresh DB; frames mismatch refused; responses carry `analysis_meta`;
baseline evaluation report committed (summary in PR); all tests pass.

### Phase 5A — Candidate model & retrieval orchestrator (local only)

**GOAL** Introduce `BrollCandidate`, `CandidateSource`, `BrollRetrievalService` without changing results.
**INPUTS** beat queries from the editorial analysis. **OUTPUTS** per-beat `candidates` + `source_status`.
**DATA FLOW** RETRIEVAL_PLAN §2–3 with only the local source enabled.
**CURRENT CODE** `services/retrieval.py`, `services/script.py` (`_process_beat`, `BeatResult`), `api/script.py`.
**FILES TO MODIFY** `services/script.py`, `api/script.py`, `api/search.py` (shared `CandidateOut`, `display_name`).
**FILES TO CREATE** `app/services/candidates.py`, `app/services/broll_retrieval.py`, `tests/test_candidates.py`, `tests/test_broll_retrieval.py`.
**DATABASE** none. **API** additive `candidates`, `source_status` on `/v1/script/analyze` (API_PLAN §4.1); request `retrieval` block accepted (cloud values validated but no providers enabled yet).
**SERVICE** `ScriptAnalysisService` depends on `BrollRetrievalService` (constructor injection; `get_script_service` builds it).
**PROVIDER** none. **CONFIG** `RETRIEVAL_LOCAL_K`.
**TESTS** regression: candidates (local) ≡ current `broll_results` order and scores; schema tests.
**BENCHMARKS** `eval_retrieval.py` identical to baseline. **FAILURE MODES** unchanged from 4.1.
**PERFORMANCE** no change (± noise). **DONE** identical retrieval, new fields documented, tests green.

### Phase 5B — Pixabay cloud retrieval (and 5C Getty, gated)

**GOAL** Return labelled, attributed cloud candidates next to local ones without risking local results.
**INPUTS** beat topic + shots + queries; `retrieval` policy. **OUTPUTS** cloud `BrollCandidate`s,
provider status, proxied thumbnails.
**DATA FLOW** RETRIEVAL_PLAN §3.1; PROVIDER_PLAN §4.
**CURRENT CODE** `providers/video_source/base.py`, `pixabay.py`, `providers/factory.py`, `api/health.py`.
**FILES TO MODIFY** those + `config.py`, `db/models.py` (`ProviderCache`), `main.py` (httpx log level), `.env.example`, `README.md`.
**FILES TO CREATE** `app/services/keyword_query.py`, `app/providers/video_source/cache.py`,
`app/providers/video_source/rate_limit.py`, `app/api/remote.py` (thumbnail proxy), tests per TESTING_PLAN; 5C: `app/providers/video_source/getty.py` only when gated conditions are met.
**DATABASE** `provider_cache` (REQUIRED). **API** `retrieval.cloud_*` honoured; `GET /v1/remote/{provider}/{asset_id}/thumbnail`; `GET /health/providers`.
**SERVICE** `CloudCandidateSource` in `broll_retrieval.py`; thread pool for concurrent sources.
**PROVIDER** additive `VideoCandidate` fields + capability flags; `build_cloud_sources`.
**CONFIG** PROVIDER_PLAN §6.
**TESTS** respx-mocked provider matrix, cache/limiter with fake clock, orchestrator isolation, proxy security.
**BENCHMARKS** cloud hit rate, cache hit rate, latency p50/p95, duplicate rate (TESTING_PLAN §4.6).
**FAILURE MODES** not configured / 429 / timeout / auth / budget → status only, local always returned.
**PERFORMANCE** cloud adds ≤ `CLOUD_TIMEOUT_SECONDS` per beat worst case (concurrent with local); cache makes repeats free.
**DONE** mixed results for a 3-beat script with `local_k=3, cloud_k=2`; provider outage test passes;
no API key in logs (checked with INFO logging); attribution present; 24 h caching verified.

### Phase 6 — Reranking & diversity

**GOAL** Pick relevant *and* varied clips per beat with explainable scores.
**INPUTS** candidate pool (local + cloud), beat queries, query/clip vectors, metadata, (later) vibe.
**OUTPUTS** reordered candidates with `ranking` components.
**DATA FLOW** RETRIEVAL_PLAN §4.1.
**CURRENT CODE** `services/retrieval.py`, `vectorstore/pgvector.py` (fetch vectors by id).
**FILES TO MODIFY** `services/broll_retrieval.py`, `vectorstore/base.py` + `pgvector.py` (`get_vectors(entity_type, ids, embedding_type, model)`), `api/script.py`, `api/search.py`, `config.py`, `db/models.py` (`RemoteAsset`).
**FILES TO CREATE** `app/services/ranking.py`, `tests/test_ranking.py`, `backend/eval` dev/test split.
**DATABASE** `remote_assets` + thumbnail rows in `embeddings` (REQUIRED for cloud scoring).
**API** `ranking` request flag + response components (API_PLAN §5).
**SERVICE** `RankingService.rank(pool, beat_context, k)`; MMR + near-duplicate filter.
**PROVIDER** none (thumbnail download through the proxy cache). **CONFIG** DEPLOYMENT_PLAN §3 row 6.
**TESTS** TESTING_PLAN §3 "Phase 6". **BENCHMARKS** baseline vs. reranked on dev/test splits + ablations.
**FAILURE MODES** missing vectors → fall back to similarity order for those candidates (warning);
thumbnail fetch fails → cloud candidate keeps `provider_rank` basis.
**PERFORMANCE** vectors fetched in one query; NumPy dot products for ≤ 30×4 pairs; thumbnail
embeddings cached → negligible after first use.
**DONE** test-split report shows diversity improved and relevance within the agreed tolerance;
`RANKING_ENABLED` default decided from that report.

### Phase 7 — Vibe / atmosphere

**GOAL** Know how the footage should feel and use it only to reorder relevant candidates.
**INPUTS** full script, beat intents, clip features. **OUTPUTS** script `Vibe`, beat vibe, `vibe_fit`.
**DATA FLOW** RETRIEVAL_PLAN §5.
**CURRENT CODE** `services/frames.py` (FFmpeg helpers), `services/ingestion.py` (hook for stats on new clips), `services/editorial.py` (pattern for LLM schema use).
**FILES TO MODIFY** `services/ingestion.py`, `services/ranking.py`, `services/script.py` (call vibe once), `api/script.py`, `config.py`.
**FILES TO CREATE** `app/services/vibe.py`, `app/services/visual_stats.py`, `scripts/backfill_visual_stats.py`, `backend/eval/clip_vibes.json`, tests.
**DATABASE** none (`videos.extra.visual_stats`). **API** `vibe_override`, `vibe`, `vibe_fit` (API_PLAN §6).
**SERVICE** `VibeAnalyzer` (LLM, `vibe-v1`), beat adjustment table, `vibe_fit` in ranking.
**PROVIDER** none. **CONFIG** `VIBE_ENABLED`, `RANK_W_VIBE`.
**TESTS** TESTING_PLAN §3 "Phase 7". **BENCHMARKS** clip vibe agreement; script vibe consistency.
**FAILURE MODES** LLM failure → `vibe: null`, weight 0, warning.
**PERFORMANCE** +1 LLM call per script (~1–4 s with 3B); backfill ≈ seconds per clip, once.
**DONE** only validated vibe signals carry weight; vibe never appears in retrieval queries; tests green.

### Phase 8 — Pacing

**GOAL** Decide shot count and on-screen duration per beat, deterministically.
**INPUTS** beat text, intent, energy (optional), wpm. **OUTPUTS** `BeatPacing`.
**DATA FLOW / DESIGN** STORYBOARD_TIMELINE_PLAN §1.
**CURRENT CODE** `services/script.py` (beats), `api/script.py`.
**FILES TO MODIFY** `api/script.py`, `services/script.py` (attach pacing), `config.py`.
**FILES TO CREATE** `app/services/pacing.py`, `tests/test_pacing.py`.
**DATABASE** none. **API** `pacing` request/response (API_PLAN §7). **PROVIDER** none.
**CONFIG** `PACING_*`. **TESTS** table-driven. **BENCHMARKS** constraint checks + small reference timings.
**FAILURE MODES** none external; very short beats → warning. **PERFORMANCE** negligible.
**DONE** every beat has durations summing to its narration estimate within bounds; no temporal search anywhere.

### Phase 9A — Storyboard generation (stateless)

**GOAL** Turn ranked candidates + pacing into a selected visual sequence.
**INPUTS** script + options. **OUTPUTS** `Storyboard` (STORYBOARD_TIMELINE_PLAN §2.2).
**CURRENT CODE** all services above. **FILES TO CREATE** `app/services/storyboard.py`, `app/api/storyboard.py`, tests.
**FILES TO MODIFY** `main.py` (router). **DATABASE** none. **API** `POST /v1/storyboards/generate`.
**SERVICE** greedy deterministic selection (§2.3), alternates, purpose text from `visual_role`.
**TESTS** selection rules, determinism, contract. **BENCHMARKS** storyboard metrics (TESTING_PLAN §4.10).
**FAILURE MODES** per-beat errors carried into `StoryboardBeat.status`; empty pool → beat with no shots + warning.
**PERFORMANCE** selection is milliseconds; total ≈ script analysis time.
**DONE** frontend teammate can render a storyboard from the endpoint; same input → same selection.

### Phase 9B — Storyboard persistence & editing

**GOAL** Save projects/storyboards; replace, lock, regenerate beats without re-running everything.
**FILES TO MODIFY** `db/models.py`, `main.py` (CORS methods), `api/storyboard.py`. **FILES TO CREATE** `app/api/projects.py`, `app/services/assets.py` (`resolve_asset`), tests.
**DATABASE** `projects`, `storyboards` (DATA_MODEL_PLAN §4.5). **API** API_PLAN §8 9B.
**SERVICE** optimistic concurrency; regeneration reuses stored candidates unless `reanalyze=true`.
**TESTS** persistence, 409, cascade, asset resolution across differing DB ids.
**FAILURE MODES** stale version 409; unresolvable asset → 422 on save / warning on load.
**DONE** a project survives restart; replacing a shot changes only that beat; regeneration deterministic.

### Phase 10A — Timeline

**GOAL** Backend contract for the editor: concrete clip placements with versioned saves.
**FILES TO CREATE** `app/services/timeline.py`, `app/api/timeline.py`, tests. **FILES TO MODIFY** `db/models.py`, `main.py`.
**DATABASE** `timelines`. **API** API_PLAN §9 (timeline + `/v1/assets/resolve`).
**SERVICE** build from storyboard; server-side validation; totals computed by server.
**DONE** editor can load, modify (replace/reorder/duration/in-point) and save with conflict detection.

### Phase 10B — Export

**GOAL** Render a timeline to MP4 with FFmpeg, including permitted cloud assets.
**FILES TO CREATE** `app/services/export.py`, `app/api/exports.py`, tests (integration with generated clips).
**FILES TO MODIFY** `services/frames.py` (reuse `_tool`/`_run` helpers, or move them to a small `ffmpeg.py`), `db/models.py`, `main.py` (startup: mark interrupted jobs failed).
**DATABASE** `export_jobs`. **API** exports endpoints (API_PLAN §9).
**SERVICE** background job, asset resolution/download cache, normalise → concat/xfade.
**FAILURE MODES** STORYBOARD_TIMELINE_PLAN §3.6. **PERFORMANCE** one export at a time; cached remote downloads.
**DONE** a 3-beat project exports to a playable MP4 of the right duration/resolution; failures produce
clear job errors; no cloud asset exported without `exportable`.

---

## 7. Exact backend modules likely to change (all phases)
`app/main.py`, `app/config.py`, `app/db/models.py`, `app/api/{search,script,editorial,health}.py`,
`app/providers/factory.py`, `app/providers/video_source/{base,pixabay}.py`,
`app/providers/llm/{ollama,gemini}.py`, `app/services/{ingestion,retrieval,editorial,script,frames}.py`,
`app/vectorstore/{base,pgvector}.py`, `scripts/{init_db,ingest}.py`, `.env.example`, `README.md`.

## 8. New modules likely required
`services/llm_json.py`, `services/candidates.py`, `services/broll_retrieval.py`,
`services/keyword_query.py`, `services/ranking.py`, `services/vibe.py`, `services/visual_stats.py`,
`services/pacing.py`, `services/storyboard.py`, `services/assets.py`, `services/timeline.py`,
`services/export.py`, `providers/video_source/{cache,rate_limit}.py`, (gated) `providers/video_source/getty.py`,
`api/{remote,storyboard,projects,timeline,exports}.py`, scripts `migrate_thumbnails.py`,
`dataset_manifest.py`, `eval_retrieval.py`, `backfill_visual_stats.py`, `benchmark_pipeline.py`,
`purge_cache.py`, and `backend/eval/*.json`.

## 9. Database changes
Phase 5: `provider_cache` · Phase 6: `remote_assets` (+ thumbnail rows in `embeddings`) ·
Phase 7: none (`videos.extra`) · Phase 8: none · Phase 9B: `projects`, `storyboards` ·
Phase 10: `timelines`, `export_jobs`. All additive; `init_db` remains the mechanism. (DATA_MODEL_PLAN §4.)

## 10. API changes
Additive fields on `/v1/script/analyze`, `/v1/search`, `/v1/editorial/analyze`; new
`/v1/remote/...`, `/health/providers`, `/v1/storyboards/generate`, `/v1/projects/...`,
`/v1/assets/resolve`, `/v1/exports/...`. CORS methods extended in 9B. (API_PLAN.)

## 11. Configuration changes
DEPLOYMENT_PLAN §3 lists every new variable, its default and phase. Defaults preserve behaviour.

## 12. Testing requirements
Normal suite stays offline (mocks/fakes); each phase adds the tests in TESTING_PLAN §3; integration
tests for DB/FFmpeg; live tests opt-in only.

## 13. Benchmark requirements
Gold files and scripts in TESTING_PLAN §4. A phase that claims a quality improvement must include a
before/after report on the relevant metrics (dev split for tuning, test split for the claim).

## 14. Performance considerations
ARCHITECTURE_PLAN §7: warm-up, batched query embeddings, concurrent cloud I/O, optional beat
pipelining, provider/thumbnail caching; async jobs only for export. LLM latency dominates (≈ 3.5 s/beat
with 3B); stronger models are a benchmark-gated configuration change.

## 15. Failure handling
ARCHITECTURE_PLAN §6.2 failure matrix; STORYBOARD_TIMELINE_PLAN §3.6 for export. Principle: core
dependencies (DB, embeddings) fail the request; optional parts (cloud, vibe, alternatives, single
beats) degrade with explicit status.

## 16. Security considerations
DEPLOYMENT_PLAN §4 checklist: SecretStr keys, no keys in logs (httpx log level), backend-only provider
calls, proxied cloud thumbnails, no client-supplied URLs, containment checks, explicit CORS, attribution.

## 17. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Teammates cannot get the dataset (data/ ignored) | blocked local work, inconsistent results | H1 decision + manifest verification |
| Pixabay keyword search misses CLIP-style captions | few cloud hits | deterministic keyword builder + fallback cascade; measure hit rate |
| Pixabay rate limit (100/60 s) on long scripts | errors | budget per script, cache 24 h, primary query only |
| Getty access/licensing unknown | wasted work | gated; design only until confirmed |
| 3B LLM quality (intents, segmentation) | weaker storyboards | prompts versioned + benchmarks; model switch via config when hardware/billing allow |
| Overfitting rank weights to a small judged set | false improvements | dev/test split, ablations, few parameters |
| CLIP cannot separate abstract moods | noisy vibe | validate per mood; weight 0 for unvalidated signals |
| Machine-specific DB ids leak into saved projects | broken projects for teammates | `asset_key` everywhere in persisted documents |
| Expiring cloud URLs | broken previews/exports | `/v1/assets/resolve`, re-resolve at export |
| Long synchronous requests | browser/proxy timeouts | measure; optional job endpoint only if needed |
| Ollama context truncation | silent segmentation errors | explicit `num_ctx` |
| Repo size growth | slow clones | manifest + size checks; no blind dataset expansion |

## 18. Future optional improvements (not scheduled)
Beam-search storyboard selection; learned linear reranker once enough judgements exist; per-task
LLM models; LLM `search_keywords` for keyword providers; editorial-mode search using multi-query;
async script-analysis jobs; timeline version history; narration audio mux and VO-timed pacing;
additional cloud providers following the same adapter pattern; dataset expansion in weak categories.

## 19. Explicit out-of-scope items
Temporal localization (finding moments inside long videos); automatic content-aware trimming;
microservices, queues, Kubernetes, separate vector DBs, MongoDB/Supabase; replacing OpenCLIP or
pgvector; frontend implementation details; user accounts/auth; multi-user real-time collaboration;
transitions beyond cut/crossfade; colour grading/effects; music selection; custom model training.

---

## Recommended Execution Order

| # | Step | Prerequisite | Files / modules | Expected result | Validation | Checkpoint |
|---|---|---|---|---|---|---|
| 1 | Record dataset decision (H1) + manifest | team decision | `scripts/dataset_manifest.py`, `data/manifest.json`, `.gitignore` (exception), README | everyone can verify 209/209 clips | `--verify` passes on two machines | commit "dataset manifest" |
| 2 | Source-keyed thumbnails (H2) | 1 | `services/ingestion.py`, `api/search.py`, `scripts/migrate_thumbnails.py` | thumbnails independent of DB ids | fresh DB + `ingest --local` → all thumbnails served | commit |
| 3 | Frames consistency check (H3) | — | `scripts/init_db.py`, `scripts/ingest.py` | mismatch refused | new test | commit |
| 4 | LLM hardening (H4) | — | `services/llm_json.py`, providers, editorial/script services, responses | repairs/retries/num_ctx/prompt versions/`analysis_meta` | tests + `RUN_LLM_TESTS=1` | commit |
| 5 | Eval set + baseline (H5) | 2 | `backend/eval/*`, `scripts/eval_retrieval.py` | baseline report | report reviewed by a teammate | commit "baseline" |
| 6 | Perf basics (H6) | 4 | `main.py` lifespan, `retrieval.py` batch embedding | warm first request; fewer CLIP passes | `benchmark_pipeline.py` before/after | commit |
| 7 | Phase 5A orchestrator | 5 | `candidates.py`, `broll_retrieval.py`, `script.py`, `api/script.py` | identical results + new fields | regression test + eval identical | commit, tag `phase-5a` |
| 8 | Phase 6 ranking | 7 | `ranking.py`, vector fetch, API fields, `remote_assets` (cloud part can follow step 9) | diverse, explainable lists | dev/test report + ablations | commit, decide `RANKING_ENABLED` |
| 9 | Phase 5B Pixabay cloud | 7 | keyword_query, cache, rate_limit, provider changes, remote thumbnail API, health | mixed local/cloud results | respx tests, opt-in live test, outage test, log check | commit, tag `phase-5b` |
| 10 | Rank cloud candidates (thumbnail CLIP) | 8, 9 | `ranking.py`, `remote_assets` | cloud ordered by relevance within quota | tests + cloud relevance judgements | commit |
| 11 | Phase 8 pacing | 4 | `pacing.py`, API | durations per beat | table tests | commit |
| 12 | Phase 7 vibe | 8 (scoring), 4 | `vibe.py`, `visual_stats.py`, backfill, ranking | validated vibe signals | clip vibe agreement report | commit; enable per report |
| 13 | Phase 9A stateless storyboard | 8, 11 (12 optional) | `storyboard.py`, `api/storyboard.py` | storyboard JSON | determinism + metrics | commit, notify frontend teammate |
| 14 | Phase 9B persistence | 13 | models, `projects.py`, `assets.py`, CORS | editable saved projects | persistence tests | commit |
| 15 | Phase 10A timeline | 14 | `timeline.py`, API | editor contract | validation/409 tests | commit |
| 16 | Phase 10B export | 15 | `export.py`, API, startup hook | MP4 export | FFmpeg integration tests + manual playback | commit, tag `phase-10` |
| 17 | (optional) Docker backend | any | `backend/Dockerfile`, compose | one-command demo | `docker compose up` + health | commit |
| 18 | (gated) Phase 5C Getty | access + terms confirmed | `getty.py`, factory, config | metadata/previews per verified terms | fixture tests | commit |

After every step: run `uv run pytest` (and `-m integration` when DB code changed), update README for
user-visible changes, and stop for review at each tag.

## What NOT To Build Yet

- Cloud downloads into `data/videos/` (cloud stays remote; download only for export, Phase 10B).
- Getty code before credentials and written preview/export terms exist.
- Reranking weights tuned without the dev/test evaluation set (step 5).
- Vibe words in CLIP retrieval queries; per-beat LLM vibe calls.
- Any learned reranker, custom model training, or new embedding model.
- Storyboard persistence before stateless generation is validated (9A before 9B).
- Timeline or export before a persisted storyboard exists.
- Async job infrastructure for script analysis (only export uses background jobs).
- Narration audio, music, transitions beyond cut/crossfade, effects.
- Temporal localization or content-aware trimming of any kind.
- Dataset expansion without the manifest, near-duplicate check and size limits.
- Frontend components (owned by the teammate) beyond keeping the API contract documented.

## Handoff Instructions for Antigravity

1. Read [ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md) first (especially §1.3 discrepancies and §2
   "must not change"), then this roadmap, then the document for the phase you are implementing.
2. Before each phase, re-inspect the current code: files may have changed since 2026-10-03. If the
   code disagrees with a plan, trust the code, note the discrepancy, and ask before redesigning.
3. Implement **one step of the Recommended Execution Order at a time**. Do not start the next phase
   without explicit approval.
4. Preserve existing behaviour: changes to existing endpoints are additive; add a regression test
   proving old requests produce the old response (plus new fields).
5. Run `cd backend && uv run pytest` after every step (and `-m integration` for DB/FFmpeg changes).
   Normal tests must not need Ollama, Gemini or provider network access.
6. No unrelated refactors, dependency upgrades or formatting sweeps. Do not touch the frontend except
   where a phase explicitly changes the API contract (and then only the API client types, if asked).
7. Never commit `.env`, API keys, `data/` media, caches or exports. Do not commit automatically;
   leave commits to the user unless asked.
8. Treat the dataset as read-only (no deletions, re-downloads or re-indexing) except via documented scripts.
9. At the end of each step, report: changed files, new settings, test results (counts), benchmark
   numbers where required, known limitations, and anything that deviated from this plan.
