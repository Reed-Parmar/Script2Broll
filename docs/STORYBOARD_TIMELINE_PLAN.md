# Script2Broll — Pacing, Storyboard, Timeline & Export Plan (Phases 8, 9, 10)

Part of the planning package. Master document: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).
Schemas/tables: [DATA_MODEL_PLAN.md](DATA_MODEL_PLAN.md). Endpoints: [API_PLAN.md](API_PLAN.md).

**Scope guard**: pacing decides *how long a selected clip stays on screen*. It never searches for a
moment inside a source video. In-points are fixed, content-agnostic rules (§1.5).

---

## 1. Phase 8 — Pacing (deterministic baseline)

### 1.1 Inputs
beat text, sentence count, editorial intent, effective vibe energy (Phase 7, optional),
`words_per_minute` (request or config), optional explicit narration durations per beat (future: VO timing).

### 1.2 Model — `app/services/pacing.py`

```python
class PacingConfig(BaseModel):
    words_per_minute: float = 150          # starting assumption for narration speed; calibrate per voice
    sentence_pause_s: float = 0.3
    min_shot_s: float = 1.5
    max_shot_s: float = 8.0
    max_shots_per_beat: int = 3
    target_shot_s: dict[Energy, float] = {LOW: 5.0, MEDIUM: 3.5, HIGH: 2.5}   # heuristics, tune via benchmark
    intent_multiplier: dict[EditorialIntent, float] = {PROCESS: 1.2, EVIDENCE: 1.2, TRANSITION: 0.8}  # others 1.0

class BeatPacing(BaseModel):
    narration_seconds: float               # estimated (or provided) time the narration takes
    basis: Literal["words_per_minute", "provided"]
    shot_durations: list[float]            # sums to narration_seconds (rounded to 0.1 s)
```

### 1.3 Algorithm
```
words = len(re.findall(r"\w+", beat.text))
narration = words / wpm * 60 + sentence_pause_s * sentences          (or provided duration)
target = target_shot_s[energy or MEDIUM] * intent_multiplier.get(intent, 1.0)
n = clamp(round(narration / target), 1, max_shots_per_beat)
while narration / n > max_shot_s and n < max_shots_per_beat: n += 1
while narration / n < min_shot_s and n > 1: n -= 1
shot_durations = equal split of narration into n (last one absorbs rounding)
if narration < min_shot_s: one shot of min_shot_s, warning "beat shorter than minimum shot"
```
All constants are configuration with documented defaults; no LLM.

### 1.4 Clip duration vs. required shot duration
- Clip ≥ shot duration: use it (in-point rule §1.5).
- Clip shorter: (a) ranking prefers longer clips via `duration_fit` (Phase 6); (b) selection splits the
  slot into an extra shot if `max_shots_per_beat` allows; (c) otherwise mark the shot
  `underfilled=true` with a warning; export holds the last frame (`tpad=stop_mode=clone`) rather than
  looping. Looping is not allowed by default.
- Clip much longer: only the first `duration` seconds after the in-point are used.

### 1.5 In-point rule (not temporal localization)
`in_point = min(1.0, 0.1 · clip_duration)` seconds, clamped so `in_point + duration ≤ clip_duration`
(when possible). This skips fade-ins in the same spirit as the frame sampler skipping segment edges.
It never inspects content. The editor may change it manually.

### 1.6 Transitions
Metadata only in Phase 8/9: `cut` (default) or `crossfade` (0.5 s) at beat boundaries whose next beat
intent is `transition` or `conclusion`. Export implements both (Phase 10); everything else is out of scope.

### 1.7 Reuse constraint
A clip (asset_key) is not reused within a storyboard unless the candidate pools are exhausted; then
reuse is allowed only if ≥ `REUSE_MIN_GAP_BEATS` (default 3) beats apart, with a warning.

### 1.8 Output and API
`BeatOut.pacing: BeatPacing` (additive) in `/v1/script/analyze`; request `pacing: {words_per_minute}`.
Pacing is also the first step of storyboard generation.

---

## 2. Phase 9 — Storyboard

### 2.1 Responsibilities
| Step | Deterministic or LLM |
|---|---|
| beats, intent, visuals, queries | existing LLM steps (Phase 4.1) |
| script vibe | LLM, once (Phase 7) |
| candidates per beat | Phase 5 retrieval + Phase 6 ranking |
| shot plan (count, durations) | Phase 8, deterministic |
| shot selection across beats | **deterministic** (§2.3) |
| shot purpose text | deterministic: beat `visual_role` + the matched query |
| transitions | deterministic rule (§1.6) |

### 2.2 Representation — `app/services/storyboard.py` (Pydantic models, also the API schema)

```python
class AssetRef(BaseModel):            # stable, portable reference to a clip (DATA_MODEL_PLAN §3)
    asset_key: str                    # "pixabay:10447"
    source_type: Literal["local", "cloud"]
    provider: str
    provider_asset_id: str
    display_name: str
    page_url: str
    creator: str | None
    duration: float | None
    width: int | None
    height: int | None
    thumbnail_url: str                # resolved at read time (local ids differ per machine)
    media_url: str | None
    exportable: bool

class Shot(BaseModel):
    shot_id: str                      # f"{beat_id}-s{n}"
    asset: AssetRef
    in_point: float
    duration: float
    purpose: str                      # e.g. visual_role + " — " + matched query
    matched_query: str
    ranking: dict | None              # score components copied from Phase 6 (explainability)
    transition_in: Literal["cut", "crossfade"] = "cut"
    locked: bool = False              # user-pinned; regeneration keeps it
    underfilled: bool = False

class StoryboardBeat(BaseModel):
    beat_id: str
    order: int
    text: str
    status: Literal["ok", "error"]
    error: str | None
    editorial: EditorialIntentResult | None
    vibe: Vibe | None
    pacing: BeatPacing | None
    shots: list[Shot]
    alternates: list[AssetRef]        # next-best candidates (default 5) for one-click replacement
    warnings: list[str]

class GenerationMeta(BaseModel):
    embedding_model: str
    llm_provider: str
    llm_model: str
    prompt_versions: dict[str, str]
    ranking_weights: dict[str, float]
    pacing: PacingConfig
    retrieval: RetrievalPolicy
    created_at: datetime

class Storyboard(BaseModel):
    schema_version: Literal[1] = 1
    storyboard_id: UUID | None        # set when persisted (Phase 9B)
    version: int = 1
    script: str
    segmentation: SegmentationOut
    vibe: Vibe | None
    beats: list[StoryboardBeat]
    total_seconds: float
    meta: GenerationMeta
```

### 2.3 Selection algorithm (deterministic, greedy, left to right)
For each beat, for each shot slot `j` with duration `d_j`, choose from the beat's ranked pool:
```
slot_score(c) = final_score(c)                                   # Phase 6 (or similarity if ranking off)
              + 0.10 · min(1, c.duration / d_j)                   # duration fit for this slot
              − 1.00 · [c.asset_key used earlier in storyboard]   # reuse (hard unless pool exhausted)
              − 0.30 · max(0, v(c, previous_shot) − 0.85)          # avoid near-identical consecutive shots
              + 0.05 · [c.matched_query not yet covered in this beat]
```
Ties → `asset_key` order. Locked shots are fixed first; selection fills the rest. Weights are
configuration and are recorded in `GenerationMeta`. A later optional improvement is beam search over
the whole storyboard; greedy first.

### 2.4 Pipelines
- **9A stateless**: `POST /v1/storyboards/generate {script, options}` → full `Storyboard` (no DB).
  Lets the frontend teammate integrate before persistence exists.
- **9B persisted**: projects own one current storyboard (`projects`, `storyboards` tables).
  Operations: generate, get, replace shots of a beat, regenerate a beat (selection only by default;
  `reanalyze=true` re-runs editorial + retrieval for that beat), lock/unlock shots.
- Every mutating call carries the `version` the client has; mismatch → 409.

### 2.5 Reproducibility
Persisted storyboards store the LLM outputs, candidates (as `AssetRef` snapshots) and
`GenerationMeta`. Re-opening a project never re-runs the LLM. Regeneration with the same stored
candidates and weights produces the same selection (deterministic).

### 2.6 Validation
- Shot durations per beat sum to `pacing.narration_seconds` (± 0.1 s).
- Every `asset_key` resolves (local row or provider `get`) at generation time; unresolved → beat warning.
- No asset reused within `REUSE_MIN_GAP_BEATS` unless flagged.
- Pydantic validation on every PUT (the client cannot inject unknown assets: the server re-resolves
  `asset_key` and rejects unknown providers/ids with 422).

---

## 3. Phase 10 — Timeline, editor contract, export

### 3.1 Concepts
| Concept | Meaning | Storage |
|---|---|---|
| Project | title + script; owns storyboard, timeline, exports | `projects` row |
| Storyboard | beats → shots (Phase 9) | `storyboards.document` JSONB |
| Timeline | concrete placement of clips in project time | `timelines.document` JSONB |
| TimelineClip | one clip instance on the timeline | inside the timeline document |
| SourceAsset | the clip itself, referenced by `AssetRef.asset_key` | `videos` (local) / provider (cloud) |
| ExportJob | one render of a timeline version | `export_jobs` row |

### 3.2 Timeline schema — `app/services/timeline.py`

```python
class Transition(BaseModel):
    type: Literal["cut", "crossfade"] = "cut"
    duration: float = Field(0.0, ge=0, le=2.0)

class TimelineClip(BaseModel):
    clip_id: str                       # stable within the timeline (uuid4 hex)
    track: Literal["broll"] = "broll"  # single video track in the MVP
    asset: AssetRef
    start: float = Field(ge=0)         # seconds from project start
    duration: float = Field(gt=0)
    in_point: float = Field(ge=0)      # seconds into the source clip (trim, not search)
    playback_rate: float = 1.0         # fixed at 1.0 in the MVP; field reserved
    beat_id: str | None
    shot_id: str | None
    transition_in: Transition = Transition()
    muted: bool = True

class Timeline(BaseModel):
    schema_version: Literal[1] = 1
    version: int
    fps: int = 30
    width: int = 1920
    height: int = 1080
    clips: list[TimelineClip]          # sorted by start; no overlaps on the broll track except crossfades
    total_seconds: float
    built_from_storyboard_version: int | None
    narration_audio: str | None = None # reserved (optional future: uploaded VO file id)
```

Build from storyboard: walk beats in order, place shots back-to-back (`start` = running sum),
`transition_in` from the shot, `in_point` from the shot.

Server-side validation on save: sorted, non-overlapping (crossfade overlap = its duration), `in_point
+ duration ≤ asset.duration` when known (else warning), assets resolvable, `total_seconds` recomputed
by the server (client value ignored).

### 3.3 Editing operations (backend contract)
The editor sends the **whole timeline document** with its `version` (`PUT`). This single operation
covers replace clip, reorder, change duration, change in-point and delete. Rationale: simplest
correct contract for one editor at a time; diffs/patch operations are an optional later optimisation.
Autosave = debounced PUT from the client; the server keeps the latest version (history table optional).

### 3.4 Preview
No server-side preview render in the MVP. The editor plays clips individually using `media_url`
(local backend URL or permitted provider URL) and the timeline's in/out values.

### 3.5 Export pipeline — `app/services/export.py`
Triggered by `POST /v1/projects/{id}/exports` → `export_jobs` row `queued` → FastAPI
`BackgroundTasks` runs the job in-process (one at a time, guarded by a lock; `EXPORT_MAX_CONCURRENT=1`).

```
1. Load timeline (pinned version) → resolve every clip's asset:
     local  → DATA_DIR/videos/<file>; missing → job failed (list of missing assets)
     cloud  → if not exportable → job failed ("asset requires licensing: getty:…")
              else re-resolve URL via provider.get(id) if expired/unknown, download to
              DATA_DIR/cache/remote/<provider>_<id>.mp4 (reused; size cap EXPORT_CACHE_MAX_GB)
2. Normalise each clip (FFmpeg): -ss in_point -t duration, scale+pad to W×H, fps, yuv420p,
   silent stereo audio track (anullsrc) so concat is uniform; underfilled → tpad clone
3. Join: concat demuxer for cut-only timelines; xfade filter chain when crossfades exist
4. Output DATA_DIR/exports/<job_id>.mp4 (H.264/AAC); update job: succeeded / failed (sanitised stderr tail)
5. Temp files under DATA_DIR/tmp/<job_id>/ removed on success and failure
```
- Progress: per-clip step count → `export_jobs.progress` (0–1).
- Timeouts: per FFmpeg call proportional to duration (e.g. 30 s + 5× clip duration).
- Narration audio mux is an optional extension (`narration_audio`), not MVP.
- Downloading cloud assets for export happens only for providers with `supports_download` and
  `exportable`. **Verify Pixabay's content licence** for redistribution in exported videos.
- Exported files are local artefacts under `DATA_DIR` (git-ignored); served by
  `GET /v1/exports/{job_id}/file` with the existing containment check.

### 3.6 Failure handling (Phase 10)
| Failure | Behaviour |
|---|---|
| Local file missing | job failed, `error` lists asset keys; timeline unchanged |
| Cloud URL expired | refresh via `get(id)` once; still failing → job failed |
| Provider down during export | job failed with provider status; retry endpoint re-queues |
| FFmpeg error | job failed, sanitised stderr tail (last 300 chars, existing `_run` pattern) |
| Server restart mid-export | on startup, jobs left `running` are marked `failed` ("interrupted") |
| Timeline changed during export | export uses the pinned `timeline_version`; unaffected |
