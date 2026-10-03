# Script2Broll — Retrieval Plan (Phases 5, 6, 7)

Part of the planning package. Master document: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).
Provider details: [PROVIDER_PLAN.md](PROVIDER_PLAN.md). Schemas: [DATA_MODEL_PLAN.md](DATA_MODEL_PLAN.md), [API_PLAN.md](API_PLAN.md).

The existing CLIP + pgvector search (`SemanticSearchService`, `multi_query_search`) remains the
**candidate generator for local footage**. Everything in this document wraps it; nothing replaces it.

---

## 1. Current retrieval behaviour (verified)

```
beat → EditorialIntentResult → queries = [retrieval_query, *alternative_queries]  (≤ 4)
     → multi_query_search(search, session, queries, top_k)
          for q in dedupe(queries): SemanticSearchService.search(q, top_k)   # CLIP text emb → pgvector cosine
          union by video.id, keep max cosine + matched query; failed query → failed_queries
     → top_k MultiQueryHit(video, score, query)
```
Scores: raw cosine in CLIP space, typically 0.15–0.35 on this dataset. No reranking, no diversity,
no cloud.

---

## 2. Phase 5 — Unified candidate model

### 2.1 Internal model — `app/services/candidates.py` (new)

```python
SourceType = Literal["local", "cloud"]
ScoreBasis = Literal["clip_visual_mean", "clip_thumbnail", "provider_rank"]

@dataclass(frozen=True)
class BrollCandidate:
    asset_key: str              # f"{provider}:{provider_asset_id}" — stable across machines (e.g. "pixabay:10447")
    source_type: SourceType     # "local" = in our indexed library; "cloud" = provider result at query time
    provider: str               # "pixabay", later "getty"
    provider_asset_id: str
    video_id: int | None        # local DB id (machine-specific; for /v1/videos/* URLs only); None for cloud
    display_name: str           # "Pixabay" (attribution)
    page_url: str
    creator: str | None
    title: str | None
    tags: tuple[str, ...]
    duration: float | None
    width: int | None
    height: int | None
    thumbnail_url: str          # local: /v1/videos/{id}/thumbnail ; cloud: /v1/remote/{provider}/{id}/thumbnail
    media_url: str | None       # local: /v1/videos/{id}/file ; cloud: provider URL if remote playback allowed, else None
    media_expires_at: datetime | None
    exportable: bool
    similarity: float | None    # comparable only among candidates with the same score_basis
    score_basis: ScoreBasis
    provider_rank: int | None
    matched_query: str          # query that produced the best score (local) / the cloud query sent
    query_scores: dict[str, float] = field(default_factory=dict)   # filled in Phase 6

def from_local_hit(hit: MultiQueryHit) -> BrollCandidate: ...
def from_cloud(candidate: VideoCandidate, provider: VideoSourceProvider, query: str) -> BrollCandidate: ...
```

`asset_key` is the identity used for deduplication, storyboards and timelines. `video_id` is never
persisted (it differs per machine; see DATA_MODEL_PLAN §3).

### 2.2 Candidate sources (small internal protocol, not a provider)

```python
class CandidateSource(Protocol):
    name: str                    # "local", "pixabay", ...
    source_type: SourceType
    def retrieve(self, session: Session, request: SourceRequest) -> SourceResult: ...

@dataclass
class SourceRequest:
    beat_id: str
    queries: list[str]           # CLIP captions (primary first)
    topic: str                   # for keyword queries
    shots: list[str]             # visual_description + filmable_visuals (for keyword queries)
    k: int

@dataclass
class SourceResult:
    candidates: list[BrollCandidate]
    status: Literal["ok", "not_configured", "error", "skipped_budget", "disabled"]
    detail: str | None           # client-safe
    requests: int = 0
    cache_hits: int = 0
    latency_ms: float = 0.0
```

- `LocalCandidateSource(search: SemanticSearchService)` — wraps the existing `multi_query_search`
  unchanged; `score_basis="clip_visual_mean"`.
- `CloudCandidateSource(provider, cache, limiter, budget)` — builds keyword queries
  (PROVIDER_PLAN §4.1), uses the cache, calls `provider.search`, normalises with `from_cloud`;
  `score_basis="provider_rank"` in Phase 5 (`"clip_thumbnail"` once Phase 6 scores thumbnails).

### 2.3 Orchestrator — `app/services/broll_retrieval.py` (new)

```python
@dataclass(frozen=True)
class RetrievalPolicy:
    local_k: int = 12                 # default = request top_k  → identical to today when cloud_k == 0
    cloud_k: int = 0                  # off unless requested/configured
    cloud_providers: tuple[str, ...] = ()
    fill: Literal["strict", "backfill"] = "backfill"   # backfill: unused cloud slots go to local and vice versa

class BrollRetrievalService:
    def __init__(self, local: LocalCandidateSource, clouds: dict[str, CloudCandidateSource | None],
                 executor: ThreadPoolExecutor): ...
    def retrieve(self, session, request: SourceRequest, policy: RetrievalPolicy) -> RetrievalOutcome:
        # 1. submit local + each enabled cloud source concurrently (cloud never blocks local)
        # 2. collect with per-source timeout; convert exceptions to SourceResult(status="error")
        # 3. dedupe (§3.4); 4. apply quotas (§3.5); 5. return candidates + per-source status + warnings

@dataclass
class RetrievalOutcome:
    candidates: list[BrollCandidate]          # local first by similarity, then cloud by provider rank (Phase 5)
    local_hits: list[MultiQueryHit]           # kept so BeatOut.broll_results stays byte-identical
    source_status: dict[str, SourceResult]
    warnings: list[str]
```

Integration point: `ScriptAnalysisService._process_beat` replaces its direct `multi_query_search`
call with `self.retrieval.retrieve(...)`. `BeatResult` gains `candidates` and `source_status`;
`hits` stays (populated from `local_hits`). `/v1/search` may opt in later via the same service.

Session safety: SQLAlchemy sessions are not thread-safe. The local source runs on the request
thread (or opens its own session from `get_engine()` inside the worker); cloud sources do not touch
the session except the cache, which uses its own short `engine.begin()` transaction.

---

## 3. Phase 5 — Local + cloud behaviour

### 3.1 Data flow

```
Beat (queries, topic, shots)
  ├─ LocalCandidateSource ── CLIP text emb ─→ pgvector ─→ MultiQueryHit ─→ BrollCandidate(local)
  └─ CloudCandidateSource(pixabay) ── keyword query ─→ cache? ─→ Pixabay API ─→ VideoCandidate ─→ BrollCandidate(cloud)
                    ↓ (all results)
            dedupe by asset_key (local wins) → quotas (local_k, cloud_k, fill) → labelled list + status
```

### 3.2 Defaults and configurability
The earlier idea "3 local + 2 cloud" becomes a **request option with config defaults**, not a constant:
- Request: `retrieval: {local_k, cloud_k, cloud_providers, fill}` (API_PLAN §4.1).
- Defaults: `RETRIEVAL_LOCAL_K` (falls back to `top_k`), `RETRIEVAL_CLOUD_K=0`, `CLOUD_PROVIDERS=""`.
- A frontend "mixed" preset can send `local_k=3, cloud_k=2`. With no `retrieval` block the endpoint
  behaves exactly as today (local only, `top_k`).

### 3.3 Error isolation
- Local failure (DB) → request fails as today (503). Local *query* failures → warnings (existing).
- Any cloud failure → that source's `status` is `error`/`not_configured`/`skipped_budget`; local
  candidates are always returned.
- Cloud timeout uses `future.result(timeout=...)`; a late result is discarded (not awaited).

### 3.4 Deduplication
1. Within a source: by `asset_key` (local already dedupes by `video.id`; cloud by provider id across
   the beat's cloud queries).
2. Across sources: same `asset_key` → keep the local candidate (playable, exportable, has a visual
   vector) and record `also_found_in=["pixabay"]` in debug metadata.
3. Near-duplicates (different ids, same shoot) are handled in Phase 6 with visual similarity.

### 3.5 Local/cloud ranking in Phase 5
Scores are **not comparable** across sources (CLIP cosine on 8-frame means vs. provider keyword rank).
Phase 5 therefore uses **quotas**, not a merged score:
- local: top `local_k` by similarity; cloud: top `cloud_k` by `provider_rank`, providers interleaved
  in the order of `cloud_providers`.
- `fill="backfill"`: if a source returns fewer than its quota, the other source fills the gap.
- The response lists local first, then cloud, each with `score_basis` so the client never compares
  a cosine with a rank.

### 3.6 Phase 5 definition of done (retrieval side)
- With cloud disabled, `/v1/script/analyze` responses are identical to today except for new additive fields.
- With `cloud_k=2` and Pixabay enabled: each beat has ≤ 2 cloud candidates, labelled, attributed,
  thumbnail proxied, no local duplicates; a mocked provider outage still yields local results.

---

## 4. Phase 6 — Reranking and diversity

### 4.1 Pipeline

```
candidate generation (pool)        local: top N_pool by best cosine (default 30); cloud: provider results
      → feature extraction          per-candidate signals (§4.2)
      → relevance score             weighted, normalised (§4.3)
      → near-duplicate filter       visual cosine ≥ τ_dup (§4.4)
      → diversity selection (MMR)   select k with coverage bonus (§4.5)
      → final candidates            with score components for explainability
```
Module: `app/services/ranking.py` (pure functions + a `RankingService` holding config). Called by
`BrollRetrievalService` after dedupe, before quotas are applied (quotas apply to the selected list).

### 4.2 Signals

| Signal | Symbol | Available now? | How |
|---|---|---|---|
| Best query similarity | `s_max(c)` | yes | max over queries of cosine (exists) |
| Primary-query similarity (editorial relevance proxy) | `s_0(c)` | needs per-query scores | cosine with the primary query; requires candidate vectors |
| Per-query scores | `s_q(c)` | needs vectors | fetch `embeddings.vector` for the pool by `entity_id` (one SQL query), dot with the beat's query vectors (already normalised) |
| Visual similarity between candidates | `v(c,d)` | needs vectors | dot product of `visual_mean` vectors; cloud: thumbnail vectors |
| Duration fit | `f_dur(c)` | metadata + Phase 8 | `min(1, duration / required_shot_seconds)`; 1.0 if Phase 8 absent |
| Technical quality | `f_q(c)` | metadata | resolution and orientation: `1.0` if width ≥ 1280 and landscape; `0.7` if ≥ 960; `0.4` otherwise; portrait × 0.5 for a 16:9 target |
| Vibe fit | `f_vibe(c)` | Phase 7 | §5.4 |
| Source preference | `f_src(c)` | metadata | `1.0` local/exportable, `CLOUD_PREFERENCE` (default 0.9) cloud |

All signals except vibe are **deterministic** and available from existing data or metadata.
No new model is required for Phase 6 except embedding cloud thumbnails with the *existing* CLIP model.

### 4.3 Relevance score

Similarities are normalised per beat pool (CLIP cosines are compressed; raw weights would be dominated
by metadata terms):

```
norm(x) = (x - min_pool) / (max_pool - min_pool)     # 0.5 if the pool has a single candidate

relevance(c) = w_sem · norm(s_max(c))
             + w_pri · norm(s_0(c))
             + w_dur · f_dur(c)
             + w_q   · f_q(c)
             + w_vib · f_vibe(c)                       # 0 until Phase 7
             (then × f_src(c))
```
Starting weights (configurable, **not tuned facts**): `w_sem=0.55, w_pri=0.20, w_dur=0.10, w_q=0.10,
w_vib=0.05` (vibe weight 0 until Phase 7 ships). Weights live in settings
(`RANK_WEIGHTS` JSON or one variable each) and are echoed in responses for traceability.

Cloud candidates in the same pool need a CLIP-space similarity: download the provider thumbnail
(server-side, allowed for Pixabay; cached), embed with the existing CLIP image encoder, store as
`embedding_type='thumbnail'`, `entity_type='remote_asset'` (DATA_MODEL_PLAN §4.2). Their
`score_basis` becomes `"clip_thumbnail"`. A single thumbnail is a noisier estimate than an 8-frame
mean, so cloud candidates are still **quota-limited**; within the cloud quota they are ordered by
relevance rather than provider rank.

### 4.4 Near-duplicate filter
Drop `c` if `v(c, d) ≥ τ_dup` for an already-kept `d` with higher relevance. `τ_dup = 0.93`
(dataset expansion found same-shoot pairs at 0.96–0.97 and distinct clips ≤ 0.893). Configurable;
re-check when the library grows.

### 4.5 Diversity: MMR with coverage bonus
Maximal Marginal Relevance is appropriate: simple, deterministic, explainable, one parameter.

```
S = []
while |S| < k and pool:
    c* = argmax_c  λ · relevance(c) − (1 − λ) · max_{d∈S} v(c, d)
                   + β · [best_query(c) ∉ {best_query(d) : d ∈ S}]      # coverage of distinct visual concepts
    S.append(c*); pool.remove(c*)
```
Defaults `λ = 0.7`, `β = 0.05`; ties broken by `asset_key` for reproducibility. The coverage term
encodes the product goal ("charging station, city traffic, person using an EV" rather than five
similar driving shots) using the query set the editorial analysis already produces.

### 4.6 Output (explainable)
Each selected candidate gets
`ranking = {final_score, relevance, components: {semantic, primary, duration_fit, quality, vibe_fit, source}, mmr_rank, redundancy, covered_query}`.
No opaque combined score: every number is reproducible from the components and the echoed weights.

### 4.7 Evaluation and overfitting control
- Golden relevance set (TESTING_PLAN §4.4) split into **dev** (tune λ, weights) and **test** (report).
- Report baseline (Phase 4.1 best-cosine) vs. reranked on P@K, nDCG@K, MRR, intra-list similarity,
  near-duplicate rate, query coverage. Ship as default (`RANKING_ENABLED=true`) only if relevance
  metrics do not drop by more than the agreed tolerance while diversity improves.
- Ablations: each component switched off once; keep components that help.
- No learned reranker until there are ≥ several hundred judged pairs; even then prefer a linear model
  whose coefficients replace the hand weights.

---

## 5. Phase 7 — Vibe / atmosphere

### 5.1 Schema (`app/services/vibe.py`)

```python
class Mood(StrEnum):
    NEUTRAL = "neutral"; SERIOUS = "serious"; HOPEFUL = "hopeful"; TENSE = "tense"; ENERGETIC = "energetic"
    WARM = "warm"; DRAMATIC = "dramatic"; NOSTALGIC = "nostalgic"; PLAYFUL = "playful"; CALM = "calm"

class Energy(StrEnum):   LOW = "low"; MEDIUM = "medium"; HIGH = "high"
class Lighting(StrEnum): ANY = "any"; BRIGHT = "bright"; NATURAL = "natural"; DARK = "dark"

class Vibe(BaseModel):
    mood: Mood
    energy: Energy
    lighting: Lighting = Lighting.ANY
    rationale: str = Field(max_length=200)     # short, for display/debug only
```
Field justification: **mood** can be scored with CLIP prompts; **energy** maps to a measurable clip
motion statistic and to pacing (Phase 8); **lighting** maps to measurable luminance. Fields such as
`visual_style`/`camera_feel` ("cinematic", "handheld") are excluded: no reliable signal exists for
them in this stack. "Cinematic" and "comedic" from the brief map to `dramatic` and `playful`.

### 5.2 Where vibe is generated
- **Script level (LLM, one call)**: `VibeAnalyzer.analyze(script) -> Vibe` using the full script
  (≤ 5000 chars), schema-constrained, validated, prompt `vibe-v1`.
- **Beat level (deterministic)**: inherit the script vibe, then apply small intent-based adjustments
  from a fixed table, e.g. `problem → mood=tense if script mood ∈ {neutral, serious}`,
  `conclusion → mood=hopeful if script mood=hopeful`, `process → energy=medium`. No per-beat LLM call.
- **Clip level (deterministic, offline)**: features computed at ingestion/backfill.
- **User override**: request field `vibe_override` replaces the script vibe.

### 5.3 Clip features (offline backfill; no new model) — `app/services/visual_stats.py`
Computed with FFmpeg from the local file (stored in `videos.extra["visual_stats"]`, no migration):
- `luma_mean`, `saturation_mean`: `signalstats` filter on the 8 already-defined sample timestamps.
- `motion`: mean absolute luma difference between frame pairs 0.5 s apart at 3 timestamps
  (`tblend=all_mode=difference` + `signalstats`). This measures movement, not content position.
- Script: `scripts/backfill_visual_stats.py` (idempotent; skips clips that have the stats).
- Cloud candidates: luma/saturation from the proxied thumbnail; motion unknown (`null`).

### 5.4 Vibe fit score (used by Phase 6 ranking; never appended to the CLIP query)
```
mood_fit(c)     = norm_pool( cos(E_clip(c), E_text(MOOD_PROMPTS[vibe.mood])) )
                  # e.g. "a dark, tense, dramatic video scene"; prompt embeddings cached at startup
energy_fit(c)   = 1 − |energy_level(vibe) − motion_bucket(c)| / 2      # buckets 0/1/2; 1.0 if motion unknown
lighting_fit(c) = 1.0 if lighting = any, else bucket match on luma_mean (thresholds tuned on the dataset)
f_vibe(c)       = 0.5·mood_fit + 0.25·energy_fit + 0.25·lighting_fit
```
Keeping vibe out of the retrieval query prevents abstract words ("tense", "hopeful") from pulling
semantically wrong clips; vibe only reorders candidates that are already relevant.

### 5.5 Validation, fallback, testing
- Validate CLIP mood prompts before relying on them: label ~60 clips by hand (mood, lighting, energy);
  report agreement of the prompt-based bucket with labels. If a mood is not separable by CLIP, drop
  it from `mood_fit` (weight 0) rather than ship noise.
- Vibe LLM failure → `vibe: null` + warning; `w_vib` effectively 0. Invalid enum → repair once, then null.
- Tests: schema validation, deterministic beat adjustments table, feature extraction on generated
  FFmpeg test clips (dark vs bright `color` sources, static vs `testsrc` motion), ranking with/without vibe.

### 5.6 Downstream use
- Phase 8: `energy` sets target shot length.
- Phase 9: storyboard records the effective vibe per beat; consistency penalty for clips whose
  `lighting` bucket contradicts the beat vibe.
