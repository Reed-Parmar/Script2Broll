# Script2Broll — Testing & Evaluation Plan

Part of the planning package. Master document: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

---

## 1. Current test suite (verified)

199 tests collected in `backend/tests/` (last full run: 196 passed, 3 skipped opt-in):

| File | Tests | Covers |
|---|---|---|
| test_config.py | 3 | settings defaults, secrets hidden |
| test_providers.py | 19 | factory, Pixabay parsing/errors (respx), Gemini errors |
| test_embedding.py | 13 | mean/normalise, Gemini embedding (mocked) |
| test_clip.py | 6 | CLIP provider with fake model; 1 opt-in real model (`RUN_CLIP_MODEL_TESTS=1`) |
| test_frames.py | 3 | FFmpeg probe/sampling on generated clips |
| test_health.py | 7 | health endpoints |
| test_search_api.py | 15 | `/v1/search` contract with fake service |
| test_editorial.py / _api.py | 33 / 15 | schema, parsing, query builder, Ollama/Gemini (mocked), API; 1 opt-in live LLM |
| test_script.py / _api.py | 33 / 17 | splitting, segmentation validation, orchestration, API; 1 opt-in live segmentation |
| test_phase41.py | 23 | grounding, context, multi-query, fallbacks, schema compatibility |
| test_search_integration.py | 9 | real PostgreSQL + FFmpeg with a fake embedder/LLM (marker `integration`; skipped if no DB) |
| test_database_integration.py | 3 | pgvector availability, schema |

Conventions to keep: LLM and providers mocked (`ScriptedLLM`, `FakeLLM`, respx); integration tests use
`TEST_PROVIDER="test"` rows and clean up; opt-in env flags for anything live.

Commands:
```bash
cd backend
uv run pytest                                  # normal suite (needs nothing external; integration skipped without DB)
uv run pytest -m integration                   # DB + FFmpeg
RUN_LLM_TESTS=1 RUN_CLIP_MODEL_TESTS=1 RUN_PROVIDER_TESTS=1 uv run pytest   # live, opt-in
```

---

## 2. Rules for new tests
1. Normal suite: no network, no Ollama, no Gemini, no Pixabay. Inject fakes via FastAPI
   `dependency_overrides` or `monkeypatch` on `factory.*` (existing pattern).
2. Time-dependent code (cache TTL, rate limiter, URL expiry) takes an injectable `clock` callable.
3. Determinism tests: run the same function twice and compare (query builders, ranking, MMR, pacing, selection).
4. Every new response field gets a contract test with an exact expected dict (existing style).
5. Every failure mode in ARCHITECTURE_PLAN §6.2 has at least one test.
6. New opt-in flag `RUN_PROVIDER_TESTS=1` for live provider calls; benchmarks are scripts, not tests.

---

## 3. Tests per phase

### Phase 5.0 (hardening)
- `test_thumbnails.py`: new naming, legacy fallback, migration script idempotency (tmp DATA_DIR).
- `test_ingest_checks.py`: frames mismatch refusal (mirrors dimension check).
- `test_llm_json.py`: repair retry succeeds on 2nd reply; gives up after `LLM_MAX_REPAIRS`; transient retry on 503/timeout, no retry on 401; `num_ctx` sent.
- `test_analysis_meta.py`: prompt versions present in responses.
- `test_dataset_manifest.py`: manifest generation/verification on generated files.

### Phase 5 (local + cloud)
- Unit: `test_keyword_query.py`, `test_provider_cache.py`, `test_rate_limit.py`, `test_candidates.py`
  (normalisation local/cloud, `asset_key`, attribution fields).
- Orchestrator `test_broll_retrieval.py`: quotas (strict/backfill), cross-source dedupe (local wins),
  cloud timeout ignored, cloud error → status + local results, budget exhaustion, all-local regression
  (cloud disabled → candidates equal current `broll_results`).
- Provider `test_cloud_source.py` (respx): success, empty, 429, timeout+retry, 401, non-JSON.
- API `test_script_api.py`/`test_search_api.py`: request validation for `retrieval`, response shape,
  **regression: no `retrieval` block → response identical except additive fields**.
- `test_remote_thumbnail.py`: allow-listed provider only, id pattern, no client URLs, cached file served.
- Integration: Pixabay mocked + real DB (`provider_cache` rows written and reused).

### Phase 6 (ranking)
- `test_ranking.py`: normalisation edge cases (single candidate, equal scores), component maths,
  weights echo, near-duplicate filter at the threshold, MMR picks a diverse set on a constructed
  example (two near-identical high scorers + one distinct), coverage bonus, tie-breaking by `asset_key`,
  determinism.
- Integration: vectors fetched from `embeddings` for a pool; thumbnail embeddings stored with
  `embedding_type='thumbnail'` never appear in `visual_mean` search.

### Phase 7 (vibe)
- Schema/enum validation, repair → null fallback, beat adjustment table, `vibe_override` precedence.
- `test_visual_stats.py`: FFmpeg-generated clips (`color=black` vs `color=white`, static vs `testsrc` motion) give ordered luma/motion.
- Ranking with vibe weight 0 equals Phase 6 ranking exactly (regression).

### Phase 8 (pacing)
- Table-driven: word counts × wpm × energy → expected shot counts/durations; min/max clamps; sums equal narration; very short beat warning; determinism.

### Phase 9 (storyboard)
- Selection: no reuse, reuse-after-gap with warning when the pool is exhausted, consecutive
  near-duplicate penalty, locked shots preserved, regeneration excludes given assets, determinism.
- Persistence: create/get/replace/regenerate, 409 on stale version, cascade delete, asset_key
  resolution when local ids differ (simulate by re-ingesting into a fresh test schema).
- Stateless vs persisted produce the same storyboard for the same inputs.

### Phase 10 (timeline/export)
- Timeline validation (overlaps, crossfade overlap, in/out bounds, unknown assets), build from storyboard, version conflicts.
- Export (integration, FFmpeg): two generated clips → cut-only export has expected duration (±0.1 s),
  resolution, fps; crossfade export; missing local file → job failed with asset list; non-exportable
  cloud asset → failed; interrupted job marked failed on startup; containment check on the file endpoint.

---

## 4. Evaluation & benchmarks (human-reviewable; no invented accuracy targets)

Location: `backend/eval/` (tracked, small JSON) + scripts in `backend/scripts/`. Reports written to
an ignored folder or attached to PRs; summaries pasted into the PR description.

### 4.1 Beat segmentation
- Dataset: extend `benchmark_llm.CASES` into `eval/segmentation.json` (~40 scripts: merges, splits,
  contrasts, processes, lists, context references, very short/long). Labels = sentence groups; mark
  cases with more than one acceptable grouping.
- Metrics: exact-match rate; **boundary F1** over sentence gaps (boundary present/absent);
  over-/under-segmentation counts; fallback rate; run-to-run agreement (2 runs).

### 4.2 Editorial intent
- `eval/intents.json`: beats with a set of acceptable intents (1–2) and short notes.
- Metrics: accuracy against the acceptable set; confusion matrix; share of `context`/`transition` (known 3B bias).

### 4.3 Visual grounding
- Automatic checks: banned-term rate (`chart, graph, text, caption, logo, infographic, statistics`),
  description length, query word count, fraction of beats with ≥ 2 filmable visuals.
- Human rubric (0–2 each): filmable, faithful to the line, specific. Two raters where possible.

### 4.4 Retrieval relevance (local)
- `eval/retrieval_qrels.json`: ~50 information needs (beat text + its queries).
  **Pooling**: judge the union of top-10 from every system being compared (raw text, Phase 4.1
  multi-query, Phase 6 reranked) on a 0/1/2 scale; unjudged = not relevant (state this bias).
- Metrics: P@5, P@10, nDCG@10, MRR, Recall@10 relative to judged relevant clips.
- Script: `scripts/eval_retrieval.py --system {raw,multiquery,reranked} --split {dev,test}`.

### 4.5 Retrieval diversity
- Intra-list similarity: mean pairwise cosine of selected clips' `visual_mean` vectors (lower = more diverse).
- Near-duplicate rate: pairs ≥ 0.93 per list.
- Query coverage: fraction of a beat's queries that are the `matched_query`/`covered_query` of ≥ 1 selected clip.

### 4.6 Cloud / local
- Cloud hit rate (non-empty results per keyword query), fallback depth used, cache hit rate,
  provider latency p50/p95, error rate by type, cross-source duplicate rate.
- Relevance of cloud results judged with the same 0/1/2 rubric on thumbnails.

### 4.7 Reranking
- Baseline vs. reranked on 4.4 + 4.5 metrics, **dev split for tuning, test split for reporting**.
- Ablations (one component off at a time). Record weights/λ in the report.

### 4.8 Vibe
- `eval/clip_vibes.json`: ~60 clips labelled (mood, lighting, energy). Metric: agreement of
  feature/CLIP buckets with labels per field; drop signals that do not separate classes.
- Script vibe consistency: same script ×3 runs → identical mood/energy rate.

### 4.9 Pacing
- Constraint checks (all durations within min/max, sums match) on the segmentation set.
- Small reference set of 5–10 manually edited timings; mean absolute error of shot durations.

### 4.10 Storyboard quality
- Automatic: reuse rate, consecutive near-duplicate rate, query/concept coverage per beat,
  underfilled-shot rate, total duration vs. narration estimate.
- Human: blind pairwise preference (baseline greedy vs. candidate change) on ~10 scripts.

### 4.11 Performance benchmarks
- `scripts/benchmark_pipeline.py`: fixed scripts (1, 3, 10, 40 sentences) → per-stage timings
  (`segmentation, analysis, retrieval, cloud, ranking, pacing, selection, total`), cold and warm.
- Track before/after for every performance change; no fixed targets beyond "no regression".

### 4.12 LLM model comparison
- Existing `scripts/benchmark_llm.py` (qwen2.5:3b vs 7b done in Phase 4.1). Extend with the
  segmentation/intent gold files once they exist; include `prompt_versions` in the report header.
