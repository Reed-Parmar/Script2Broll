# Script2Broll — Provider Plan (Phase 5 provider layer)

Part of the planning package. Master document: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).
Retrieval orchestration (how providers are combined with local search) is in
[RETRIEVAL_PLAN.md](RETRIEVAL_PLAN.md).

---

## 1. Current provider architecture (verified)

| Interface | File | Implementations | Selected by |
|---|---|---|---|
| `EmbeddingProvider` (`embed_texts`, `embed_images`, `check`, `model_name`, `dim`) | `providers/embedding/base.py` | `ClipEmbeddingProvider` (default), `GeminiEmbeddingProvider` | `EMBEDDING_PROVIDER` |
| `LLMProvider` (`generate(prompt, json_schema)`, `check`, `model`) | `providers/llm/base.py` | `OllamaLLMProvider`, `GeminiLLMProvider` | `LLM_PROVIDER` |
| `VideoSourceProvider` (`search(query, per_page, page)`, `get(source_id)`, `check`, `name`) | `providers/video_source/base.py` | `PixabayVideoProvider` | hard-wired in `factory.build_video_source` |
| `VectorStore` (`upsert`, `search`) | `vectorstore/base.py` | `PgVectorStore` | `factory.build_vector_store` |

`VideoCandidate` (frozen dataclass): `source_provider, source_id, source_url, video_url,
thumbnail_url, duration, width, height, tags, creator`.

`PixabayVideoProvider` today: `GET https://pixabay.com/api/videos/` with `key, q, per_page, page,
safesearch=true`; rendition preference `small → medium → tiny → large`; errors mapped to
client-safe `ProviderError` (400/401/403, 429, other, non-JSON, network); used **only by ingestion**
(download into `DATA_DIR`). `get(id)` is used by `ingest --local` to fetch attribution metadata.

**Decision: keep all four interfaces.** They map to genuinely replaceable systems. Do not add new
abstract layers below them.

---

## 2. Verified external facts (and what still needs verification)

### Pixabay (verified from https://pixabay.com/api/docs/ on 2026-10-03)
- Rate limit: **100 requests / 60 s** by default; headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- "**Requests must be cached for 24 hours.**"
- Videos: "**Videos may be embedded directly in your applications. Yet, we recommend storing them on your server.**"
- Images: "Permanent hotlinking of images … is not allowed … download them to your server first." Video
  hit thumbnails are images → **proxy and cache them on the backend** (conservative reading).
- Attribution: "Show your users where the images and videos are from, whenever search results are displayed."
- `q` may not exceed **100 characters**; `per_page` **3–200** (default 20).
- Video params: `video_type`, `category`, `min_width`, `min_height`, `order` (popular/latest), `safesearch`, `id`.
- Hit fields: `id, pageURL, type, tags, duration, videos.{large,medium,small,tiny}.{url,width,height,size,thumbnail}, views, downloads, likes, comments, user_id, user, userImageURL`. **There is no title field** (use tags).
- **Still verify**: content licence terms for using downloaded clips in exported videos; whether
  rendition URLs are long-lived (treat as possibly expiring and re-resolvable via `id`).

### Getty Images (verified from https://developer.gettyimages.com/docs/ on 2026-10-03)
- Video search endpoints exist: `/v3/search/videos/creative`, `/v3/search/videos/editorial` (`phrase`, `page`, `page_size`).
- Auth: `api-key` header **plus** OAuth client-credentials token (`authentication.gettyimages.com/oauth2/token`);
  access requires contacting a Getty account representative.
- Rate limits are configured per customer; 429 on excess. Download URLs are not permalinks and expire within 24 h.
- **Not stated / must verify before implementation**: which preview/thumbnail fields are returned for
  videos, whether previews may be embedded or shown in a third-party UI, watermark requirements,
  licensing cost, whether unlicensed comps may appear in exports (assume **no**).

**Rule**: no code may assume a Getty capability that is not in this section. The Getty adapter is
built only after the team has credentials and written confirmation of preview-display terms.

---

## 3. Interface evolution (additive only)

### 3.1 `VideoCandidate` — add optional fields with defaults (backward compatible)

```python
@dataclass(frozen=True)
class VideoCandidate:
    source_provider: str
    source_id: str
    source_url: str              # provider page (attribution)
    video_url: str               # rendition used for download (ingestion) and, if allowed, playback
    thumbnail_url: str | None
    duration: float | None
    width: int | None
    height: int | None
    tags: list[str] = field(default_factory=list)
    creator: str | None = None
    # --- Phase 5 additions ---
    title: str | None = None                 # Pixabay: None (no title field)
    preview_url: str | None = None           # browser-playable rendition; Pixabay: "tiny"/"small" url
    media_expires_at: datetime | None = None # when the provider says URLs expire (Getty: <=24 h)
    provider_rank: int | None = None         # 1-based position in the provider's response
```

### 3.2 Provider capability flags (class attributes, not a new abstraction)

```python
class VideoSourceProvider(ABC):
    name: str
    display_name: str                    # "Pixabay"; replaces SOURCE_NAMES dict in api/search.py
    supports_remote_playback: bool = False
    supports_download: bool = False      # may clips be downloaded for ingestion/export?
    exportable_by_default: bool = False  # may clips appear in exported videos without a licence step?
    max_query_chars: int | None = None
```

| Provider | remote playback | download | exportable | max query |
|---|---|---|---|---|
| Pixabay | True (verified) | True | True (*verify licence terms*) | 100 |
| Getty | False until verified | False until licensed | False | unknown |

### 3.3 Factory changes (`providers/factory.py`)

```python
def build_video_source(settings) -> VideoSourceProvider:          # unchanged: ingestion default (Pixabay)
    ...

def build_cloud_sources(settings) -> dict[str, VideoSourceProvider]:
    """Enabled query-time cloud providers, from CLOUD_PROVIDERS (comma list). Misconfigured
    providers are returned as None-valued entries so callers can report 'not_configured'."""
    sources = {}
    for name in settings.cloud_providers:          # e.g. ["pixabay"]
        try:
            sources[name] = _build_named_source(name, settings)
        except ProviderNotConfigured:
            sources[name] = None
    return sources
```
Provider instances are cached per settings (connection reuse); see ARCHITECTURE_PLAN §4.3.5.

### 3.4 Why there is no `LocalVideoProvider`
Local retrieval is **vector search over our indexed library** (`SemanticSearchService`), whereas
`VideoSourceProvider` is a **keyword catalogue search used to download clips into the library**.
Wrapping pgvector as a `VideoSourceProvider` would break `IngestionService` assumptions (it downloads
whatever a provider returns). The uniform treatment of local and cloud happens one level up, in the
retrieval orchestrator (`LocalCandidateSource` / `CloudCandidateSource`, RETRIEVAL_PLAN §3).

---

## 4. Pixabay as a query-time cloud source

### 4.1 Keyword query construction (deterministic) — `app/services/keyword_query.py`
CLIP queries are captions ("healthcare costs, family reviewing medical bills at a kitchen table");
Pixabay is a tag/keyword search limited to 100 characters. Sending captions verbatim would mostly
return nothing. Build keyword queries deterministically:

```python
STOPWORDS = {...}             # English stopwords
SHOT_WORDS = {"shot", "close", "closeup", "close-up", "wide", "aerial", "view", "footage", "scene", "showing"}

def build_keyword_query(topic: str, shot: str, max_words: int = 4, max_chars: int = 100) -> str:
    words = []
    for w in tokenize(topic) + tokenize(shot):           # topic words first: they anchor the subject
        if w in STOPWORDS or w in SHOT_WORDS or len(w) < 3 or w in words:
            continue
        words.append(w)
        if len(words) == max_words:
            break
    return " ".join(words)[:max_chars]

def keyword_fallbacks(topic, shot) -> list[str]:
    """Cascade used only when the previous query returned 0 hits: 4 words -> 2 words -> topic only."""
```
Each fallback attempt costs one API request → bounded by the request budget (§4.4). Hit rate is a
benchmark metric (TESTING_PLAN §4.6). If hit rate is poor, an optional LLM-produced `search_keywords`
field may be added to `EditorialAnalysis` later (additive, validated, capped) — not in Phase 5.

### 4.2 Which queries go to the cloud
Per beat: the **primary query only** by default (`CLOUD_QUERIES_PER_BEAT=1`), optionally the first
alternative (`=2`). Rationale: 40 beats × 4 queries = 160 requests would exceed 100/min.

### 4.3 Request parameters
`q=<keyword query>, per_page=max(3, cloud_k*3) (≤ 20), safesearch=true, video_type=film` (excludes
animations by default; configurable), `min_width=1280` (configurable; avoids tiny clips).
Client-side filters after the response: `duration ≤ MAX_CLIP_SECONDS (60)` (same as ingestion).

### 4.4 Rate limiting and request budget — `app/providers/video_source/rate_limit.py`
- In-process token bucket per provider: capacity/refill from `PIXABAY_RATE_LIMIT_PER_MINUTE`
  (default **90**, headroom under the verified 100). If `X-RateLimit-Remaining` is 0, block until
  `X-RateLimit-Reset` *only if* that fits the request budget; otherwise skip.
- Per-request budget: `CLOUD_MAX_REQUESTS_PER_SCRIPT` (default 20). Exceeding it marks remaining
  beats `skipped_budget` (reported, not an error).
- Single process assumption (uvicorn, one worker). If multiple workers are ever used, the cache
  table (§4.5) still prevents most duplicate calls; the limiter becomes approximate (documented).

### 4.5 Caching (required by Pixabay terms) — `app/providers/video_source/cache.py`
DB-backed so it survives `--reload` restarts:

```python
class ProviderCache:
    def get(self, provider: str, params: dict) -> dict | None: ...   # None if missing or older than TTL
    def put(self, provider: str, params: dict, response: dict) -> None: ...
    # key = sha256(json.dumps(params_without_key, sort_keys=True))
```
- Table `provider_cache` (DATA_MODEL_PLAN §4.1). TTL `PROVIDER_CACHE_TTL_HOURS=24`.
- **Never store the API key** in params or response. Cache the raw provider JSON (minus key) so the
  normaliser can evolve without refetching.
- Purge rows older than TTL opportunistically (on write, at most once per hour) or via
  `scripts/purge_cache.py`.
- Cache hits are counted per request and reported in `provider_status`.

### 4.6 Timeouts and retries
- `CLOUD_TIMEOUT_SECONDS` (default 5) per HTTP call; overall per-beat cloud budget = 2× that.
- Retry **once** on timeout or 5xx with 0.5–1 s jittered backoff. **No retry** on 429 (respect the
  limit; mark error), 400/401/403 (configuration problem).
- All failures become `ProviderError` with existing client-safe messages; the orchestrator converts
  them into `provider_status` entries — they never fail the request.

### 4.7 Media URLs returned to clients
- `media_url` (video): the Pixabay rendition URL (direct embedding allowed). Prefer `tiny`/`small`
  for browser preview; keep `small` (~720p) for export download.
- `thumbnail_url`: backend proxy path `/v1/remote/pixabay/{id}/thumbnail` (fetched once, cached on
  disk under `DATA_DIR/cache/remote_thumbnails/pixabay_{id}.jpg`, TTL 24 h–7 days; git-ignored
  because `data/` is ignored).
- `page_url` + `creator` + `display_name` for attribution.
- `media_expires_at`: `null` for Pixabay (not stated); the asset resolver can refresh a URL via `get(id)`.

### 4.8 Same clip, two sources
All 209 local clips came from Pixabay. A Pixabay cloud hit whose `id` matches a local
`videos.source_id` (provider `pixabay`) is the **same asset**: keep the local version (playable from
our server, exportable, has a visual_mean vector) and drop the cloud duplicate (RETRIEVAL_PLAN §3.4).

---

## 5. Getty adapter (gated, optional) — `app/providers/video_source/getty.py`

Build only after: (1) credentials exist, (2) preview-display and export terms are confirmed in
writing, (3) the team approves. Design (subject to verification):

```python
class GettyVideoProvider(VideoSourceProvider):
    name = "getty"
    display_name = "Getty Images"
    supports_remote_playback = False   # flip only after terms are verified
    supports_download = False
    exportable_by_default = False

    def __init__(self, api_key, api_secret, timeout, client=None): ...
    def _token(self) -> str:   # OAuth client credentials, cached in memory until expiry; never logged
    def search(self, query, per_page=20, page=1) -> list[VideoCandidate]:
        # GET /v3/search/videos/creative?phrase=...&page=...&page_size=... with api-key header + bearer token
        # Map only fields confirmed in the response; set media_expires_at when stated (<=24h for downloads)
    def get(self, source_id) -> VideoCandidate | None: ...
    def check(self) -> dict: ...   # cheap authenticated call
```
- Config: `GETTY_API_KEY`, `GETTY_API_SECRET` (SecretStr), enabled via `CLOUD_PROVIDERS=pixabay,getty`.
- Tests use recorded/mocked JSON fixtures only (respx). No live Getty calls in the normal suite.
- If previews cannot be displayed, Getty candidates are still useful as metadata-only suggestions
  (`media_url = null`, `exportable = false`) — the frontend shows attribution + page link only.

---

## 6. Health and configuration

- Keep `GET /health/pixabay` (existing contract).
- Add `GET /health/providers` → `{status, providers: {pixabay: {status, rate_limit_remaining?}, getty: {status: "not_configured"}}}`.
- New settings (all optional, backend-only):

| Variable | Default | Purpose |
|---|---|---|
| `CLOUD_PROVIDERS` | `""` (disabled) | comma list of query-time providers, e.g. `pixabay` |
| `CLOUD_QUERIES_PER_BEAT` | `1` | primary only; `2` adds the first alternative |
| `CLOUD_MAX_REQUESTS_PER_SCRIPT` | `20` | request budget per API call |
| `CLOUD_TIMEOUT_SECONDS` | `5` | per HTTP call |
| `PROVIDER_CACHE_TTL_HOURS` | `24` | Pixabay requires 24 h caching |
| `PIXABAY_RATE_LIMIT_PER_MINUTE` | `90` | headroom under verified 100 |
| `PIXABAY_VIDEO_TYPE` | `film` | `all` / `film` / `animation` |
| `PIXABAY_MIN_WIDTH` | `1280` | filter small clips |
| `GETTY_API_KEY`, `GETTY_API_SECRET` | empty | gated |

---

## 7. Provider tests (see TESTING_PLAN for the full matrix)

- `tests/test_providers.py` (extend): Pixabay `preview_url`, `provider_rank`, filters, `max_query_chars`.
- `tests/test_keyword_query.py`: stopwords, ordering, 100-char cap, fallback cascade, determinism.
- `tests/test_provider_cache.py`: put/get, TTL expiry with an injected clock, key excludes the API key.
- `tests/test_rate_limit.py`: token bucket with injected clock; header-driven back-off.
- `tests/test_cloud_source.py`: respx-mocked Pixabay — success, 429, timeout + one retry, 401, non-JSON, empty hits, budget exhaustion.
- `tests/test_getty_provider.py`: only when the adapter is built; fixtures, token caching, no key in errors.
- Opt-in live test: `RUN_PROVIDER_TESTS=1` → one real Pixabay search (respects cache).
