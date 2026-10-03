# Script2Broll — API Plan

Part of the planning package. Master document: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).
Schemas referenced here are defined in [RETRIEVAL_PLAN.md](RETRIEVAL_PLAN.md),
[STORYBOARD_TIMELINE_PLAN.md](STORYBOARD_TIMELINE_PLAN.md) and [DATA_MODEL_PLAN.md](DATA_MODEL_PLAN.md).

The frontend is built by a teammate. This document is the contract: field names, types, errors and
compatibility rules. It does not describe UI.

---

## 1. Current endpoints (verified in `backend/app/api/*`)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/health` | liveness | |
| GET | `/health/database` | DB + pgvector + embedding dim | 503 on failure |
| GET | `/health/ai` | embedding provider status + LLM status | |
| GET | `/health/pixabay` | Pixabay key/search check | |
| POST | `/v1/search` | `{query ≤500, top_k 1–50 (12), mode: semantic\|editorial}` → `{query, mode, retrieval_query, editorial?, model, results: SearchResult[], timings_ms}` | editorial mode: single primary query, no context |
| GET | `/v1/videos/{video_id}` | `VideoOut` | |
| GET | `/v1/videos/{video_id}/file` | mp4, HTTP Range supported | containment-checked |
| GET | `/v1/videos/{video_id}/thumbnail` | JPEG | by DB id |
| POST | `/v1/editorial/analyze` | `{text ≤500}` → `EditorialIntentResult` | |
| POST | `/v1/script/analyze` | `{script ≤5000 chars/40 sentences, top_k 1–50 (12)}` → `ScriptResponse` | |

`SearchResult` = `VideoOut` (`video_id, source, source_id, source_url, creator, tags, duration, width,
height, video_url, thumbnail_url`) + `score`. `BeatClip` = `SearchResult` + `matched_query`.
`ScriptResponse` = `{script, segmentation{method, error}, model, top_k, beats: BeatOut[], timings_ms}`.
`BeatOut` = `{beat_id, order, text, status, error, editorial_intent, topic, visual_role,
visual_description, retrieval_query, filmable_visuals, alternative_queries, warnings, broll_results}`.

Error conventions (existing, keep): 422 validation; 404 missing resource; 502 `ProviderError`
(client-safe `detail`); 503 `ProviderNotConfigured` or `Database unavailable`. Body: `{"detail": "..."}`.

---

## 2. Compatibility rules

1. **Additive only** for existing endpoints: new optional request fields with defaults that reproduce
   today's behaviour; new response fields; never rename/remove/retype existing fields.
2. `broll_results` (local, `BeatClip`) keeps its exact semantics; the unified list is a **new** field
   `candidates`. `broll_results` can be deprecated only after the frontend migrates (announce in README).
3. Semantic `/v1/search` responses keep exactly their current keys unless the caller opts in to cloud.
4. New resources live under `/v1/...`; no `/v2` is needed for Phases 5–10.
5. CORS: add `PUT`, `PATCH`, `DELETE` to `allow_methods` when Phase 9B ships.
6. Every new response that depends on models includes `analysis_meta`
   `{llm_provider, llm_model, embedding_model, prompt_versions}` (Phase 5.0 H4).

---

## 3. Phase 5.0 additions

| Method | Path | Change |
|---|---|---|
| POST | `/v1/script/analyze` | response adds `analysis_meta` |
| POST | `/v1/editorial/analyze` | response adds `analysis_meta` |
| GET | `/v1/videos/{video_id}/thumbnail` | serves `<provider>_<source_id>.jpg`, falls back to legacy `<id>.jpg` (no contract change) |

---

## 4. Phase 5 — local + cloud retrieval

### 4.1 `POST /v1/script/analyze` (extended)
Request (new optional block):
```json
{
  "script": "…",
  "top_k": 12,
  "retrieval": {
    "local_k": 3,
    "cloud_k": 2,
    "cloud_providers": ["pixabay"],
    "fill": "backfill"
  }
}
```
- `retrieval` omitted → `{local_k: top_k, cloud_k: 0}` → identical behaviour to today.
- `local_k` 0–50, `cloud_k` 0–10, `cloud_providers` ⊆ configured `CLOUD_PROVIDERS` (unknown → 422),
  `fill` ∈ {`strict`, `backfill`}. When `retrieval` is present, `top_k` is ignored (documented).

Response additions per beat:
```json
{
  "candidates": [
    {
      "asset_key": "pixabay:200682",
      "source_type": "local",
      "provider": "pixabay",
      "provider_asset_id": "200682",
      "video_id": 19,
      "display_name": "Pixabay",
      "page_url": "https://pixabay.com/videos/id-200682/",
      "creator": "…",
      "title": null,
      "tags": ["charging plug", "electric car"],
      "duration": 23.5, "width": 960, "height": 540,
      "thumbnail_url": "/v1/videos/19/thumbnail",
      "media_url": "/v1/videos/19/file",
      "media_expires_at": null,
      "exportable": true,
      "similarity": 0.3121,
      "score_basis": "clip_visual_mean",
      "provider_rank": null,
      "matched_query": "electric vehicles, family charging electric car at home"
    },
    {
      "asset_key": "pixabay:123456",
      "source_type": "cloud",
      "video_id": null,
      "thumbnail_url": "/v1/remote/pixabay/123456/thumbnail",
      "media_url": "https://cdn.pixabay.com/video/…/tiny.mp4",
      "similarity": null,
      "score_basis": "provider_rank",
      "provider_rank": 1,
      "matched_query": "electric vehicle charging"
    }
  ],
  "source_status": {
    "local": {"status": "ok", "count": 3},
    "pixabay": {"status": "ok", "count": 2, "requests": 1, "cache_hits": 0, "latency_ms": 412.0}
  }
}
```
Status values: `ok | not_configured | error | skipped_budget | disabled`, plus a client-safe `detail`
when not ok. Script-level `timings_ms` adds `cloud`. Paths in `thumbnail_url`/`media_url` that start
with `/` are relative to the API root (same convention as today).

### 4.2 `POST /v1/search` (extended, optional)
Same optional `retrieval` block; when present the response adds `candidates` and `source_status`.
`results` unchanged.

### 4.3 New endpoints
| Method | Path | Request | Response | Errors | Purpose |
|---|---|---|---|---|---|
| GET | `/v1/remote/{provider}/{asset_id}/thumbnail` | path params; `provider` ∈ enabled providers; `asset_id` `^[A-Za-z0-9_-]{1,128}$` | JPEG (cached on disk) | 404 unknown provider/asset or not cached-and-unfetchable; 502 provider error | serve cloud thumbnails without exposing provider image URLs (Pixabay image hotlinking rule) |
| GET | `/health/providers` | — | `{status, providers: {name: {status, detail?}}}` | 200 always (per-provider status inside) | operational view of all cloud providers |

The thumbnail proxy only fetches URLs that the backend itself obtained from the provider (looked up
from `provider_cache`/`remote_assets` or via `provider.get(asset_id)`); it never fetches client URLs.

Dependencies: `BrollRetrievalService`, `ProviderCache`, provider factory.

---

## 5. Phase 6 — reranking

Request (optional): `"ranking": {"enabled": true}` (default from `RANKING_ENABLED`).
Each candidate adds:
```json
"ranking": {
  "final_score": 0.712,
  "relevance": 0.734,
  "components": {"semantic": 0.91, "primary": 0.66, "duration_fit": 1.0, "quality": 1.0, "vibe_fit": null, "source": 1.0},
  "mmr_rank": 2,
  "redundancy": 0.41,
  "covered_query": "electric vehicles, couple installing charging station in garage"
}
```
Script-level adds `ranking_config: {weights, mmr_lambda, coverage_bonus, near_duplicate_threshold}`.
Cloud candidates scored on thumbnails report `score_basis: "clip_thumbnail"`.

---

## 6. Phase 7 — vibe

Request (optional): `"vibe_override": {"mood": "tense", "energy": "high", "lighting": "dark"}`.
Response: script-level `vibe: Vibe | null` (+ `vibe_source: "llm" | "override" | null`), per beat
`vibe` (effective), candidate `ranking.components.vibe_fit`. Invalid enum values → 422.

---

## 7. Phase 8 — pacing

Request (optional): `"pacing": {"words_per_minute": 150}` (range 80–250).
Per beat: `"pacing": {"narration_seconds": 4.2, "basis": "words_per_minute", "shot_durations": [2.1, 2.1]}`.
Script-level: `total_narration_seconds`.

---

## 8. Phase 9 — storyboard

### 9A (stateless)
| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/v1/storyboards/generate` | `{script, retrieval?, ranking?, vibe_override?, pacing?, alternates: 0–10 (5)}` | `Storyboard` (no `storyboard_id`) | 422, 502 (segmentation/LLM unreachable), 503 |

### 9B (persisted)
| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/v1/projects` | `{title ≤200, script ≤5000}` | `Project {id, title, script, created_at, updated_at, has_storyboard, has_timeline}` | 422 |
| GET | `/v1/projects` | `?limit=50` | `Project[]` ordered by `updated_at desc` | |
| GET | `/v1/projects/{id}` | — | `Project` | 404 |
| PATCH | `/v1/projects/{id}` | `{title?, script?}` | `Project` (changing `script` marks storyboard `stale: true`) | 404, 422 |
| DELETE | `/v1/projects/{id}` | — | 204 | 404 |
| POST | `/v1/projects/{id}/storyboard` | generation options (as 9A); `?replace=true` to overwrite | `Storyboard` (persisted, `version` 1 or +1) | 404, 409 exists without `replace`, 502, 503 |
| GET | `/v1/projects/{id}/storyboard` | — | `Storyboard` (asset URLs resolved for this machine) | 404 |
| PUT | `/v1/projects/{id}/storyboard/beats/{beat_id}/shots` | `{version, shots: [{asset_key, in_point, duration, locked}]}` | `Storyboard` | 404, 409 version, 422 unknown asset / durations invalid |
| POST | `/v1/projects/{id}/storyboard/beats/{beat_id}/regenerate` | `{version, exclude_asset_keys: [], reanalyze: false}` | `Storyboard` | 404, 409, 502 (only with `reanalyze`) |

---

## 9. Phase 10 — timeline and export

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/v1/projects/{id}/timeline` | `{from_storyboard: true}` (`?replace=true` to overwrite) | `Timeline` | 404 (no storyboard), 409 |
| GET | `/v1/projects/{id}/timeline` | — | `Timeline` (resolved URLs) | 404 |
| PUT | `/v1/projects/{id}/timeline` | full `Timeline` incl. `version` | `Timeline` (`version`+1, server-computed totals) | 404, 409, 422 (overlaps, unknown assets, in/out out of range) |
| POST | `/v1/assets/resolve` | `{asset_keys: [...] ≤100}` | `{asset_key: AssetRef \| {error}}` | 422 | refresh media URLs (expired cloud URLs) |
| POST | `/v1/projects/{id}/exports` | `{}` (uses current timeline version) | `ExportJob {id, status:"queued", timeline_version, created_at}` (202) | 404 no timeline, 409 an export already running |
| GET | `/v1/exports/{job_id}` | — | `ExportJob {id, status, progress, error, output_url?}` | 404 |
| GET | `/v1/exports/{job_id}/file` | — | mp4 (Range) | 404 not finished / missing |

---

## 10. Frontend-facing notes (contract only)
- Display attribution (`display_name`, `creator`, `page_url`) wherever candidates are shown (Pixabay requirement).
- Never compare `similarity` across different `score_basis` values; use `ranking.final_score` (Phase 6) within a beat.
- `video_id` is machine-specific; persist `asset_key` only.
- Send `version` on every storyboard/timeline mutation; on 409 reload and re-apply.
- `media_url` may be `null` (provider forbids remote playback) — show thumbnail + page link instead.
