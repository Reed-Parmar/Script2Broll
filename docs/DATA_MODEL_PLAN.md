# Script2Broll — Data Model Plan

Part of the planning package. Master document: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

---

## 1. Current schema (verified in `backend/app/db/models.py` and the live database)

### `videos`
| column | type | notes |
|---|---|---|
| id | BIGINT PK | machine-specific (assigned at ingestion) |
| source_provider | VARCHAR(32) | `pixabay` (all 209 rows) |
| source_id | VARCHAR(128) | provider id |
| source_url | TEXT | provider page (attribution) |
| creator | TEXT NULL | added later via `ALTER ... IF NOT EXISTS` in `init_db` |
| video_url | TEXT | provider rendition URL used for download |
| local_path | TEXT NULL | relative to `DATA_DIR` (`videos/pixabay_<id>.mp4`) |
| thumbnail_url | TEXT NULL | provider thumbnail URL (not used for serving) |
| duration, width, height | FLOAT/INT NULL | probed from the file |
| tags | TEXT NULL | comma-separated |
| status | VARCHAR(16) | pending → downloaded → embedded \| failed |
| extra | JSONB | `queries`, `embedding {model, dim, frames, aggregation}`, `error` |
| created_at | TIMESTAMPTZ | |

Constraints/indexes: `videos_pkey`, `UNIQUE (source_provider, source_id)` (idempotent ingestion).

### `embeddings`
| column | type | notes |
|---|---|---|
| id | BIGINT PK | |
| entity_type | VARCHAR(32) | `video` |
| entity_id | BIGINT (indexed) | `videos.id` — **no foreign key** |
| embedding_type | VARCHAR(32) | `visual_mean` |
| model_name | VARCHAR(128) | `ViT-B-32/laion2b_s34b_b79k` |
| vector | vector(512) | fixed at table creation |
| created_at | TIMESTAMPTZ | |

Constraints/indexes: `UNIQUE (entity_type, entity_id, embedding_type, model_name)`,
`ix_embeddings_vector_hnsw` (HNSW, `vector_cosine_ops`), `ix_embeddings_entity_id`.

Live state: 209 videos, 209 embeddings (one model, one type).

### Schema management
`scripts/init_db.py`: `CREATE EXTENSION IF NOT EXISTS vector` → `Base.metadata.create_all`
(creates missing tables only) → additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` → dimension check.
No migration tool.

---

## 2. Known data issues (fix in Phase 5.0)

| Issue | Evidence | Fix |
|---|---|---|
| Thumbnails keyed by `videos.id` | `ingestion.thumbnail_path(data_dir, video_id)` → `thumbnails/<id>.jpg`; ids differ per machine (current ids 7–244 with gaps) | H2: name thumbnails `thumbnails/<provider>_<source_id>.jpg`; endpoint looks up the new name, falls back to the legacy name; one-off idempotent `scripts/migrate_thumbnails.py` renames using the DB mapping |
| Embedding identity omits frames/pooling | `extra.embedding.frames` only | H3: refuse to ingest/init when `FRAMES_PER_VIDEO` ≠ stored frames (no schema change) |
| `embeddings.entity_id` has no FK | by design (generic table) | keep; deletion code must delete embeddings explicitly (already done in tests/cleanup) |
| Dataset not in Git (D1) | `.gitignore: data/` | H1: team decision; add tracked `data/manifest.json` either way (§7) |

---

## 3. Stable asset identity (applies to Phases 5–10)

```
asset_key = f"{provider}:{provider_asset_id}"     # e.g. "pixabay:10447"
```
- Local clips: `provider = videos.source_provider`, `provider_asset_id = videos.source_id`.
- Cloud clips: the provider's id. The same Pixabay clip has the same key locally and in the cloud.
- **Persisted documents (storyboards, timelines) store `asset_key`, never `videos.id`.**
  `video_id`, thumbnail and media URLs are resolved at read time:
  ```python
  def resolve_asset(session, asset_key) -> AssetRef:
      provider, pid = asset_key.split(":", 1)
      video = session.scalar(select(Video).where(Video.source_provider == provider, Video.source_id == pid))
      if video and video.local_path and video.status == "embedded": return local AssetRef (URLs by video.id)
      return cloud AssetRef from remote_assets / provider_cache / provider.get(pid)
  ```
- Existing unique constraint `(source_provider, source_id)` already supports this lookup.

---

## 4. Schema changes by phase

Legend: **REQUIRED** = the phase cannot meet its definition of done without it. **OPTIONAL** = useful,
build only if the stated condition occurs.

### 4.1 Phase 5 — `provider_cache` (REQUIRED: Pixabay "requests must be cached for 24 hours")

```python
class ProviderCache(Base):
    __tablename__ = "provider_cache"
    provider: Mapped[str] = mapped_column(String(32), primary_key=True)
    request_key: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256 hex of normalised params (no API key)
    params: Mapped[dict] = mapped_column(JSONB)                               # for debugging; never contains secrets
    response: Mapped[dict] = mapped_column(JSONB)                             # raw provider JSON
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
```
Upsert on conflict `(provider, request_key)`. Purge `fetched_at < now() - TTL`.

### 4.2 Phase 6 — `remote_assets` (REQUIRED if cloud thumbnails are CLIP-scored, which the Phase 6 design recommends)

```python
class RemoteAsset(Base):
    __tablename__ = "remote_assets"
    __table_args__ = (UniqueConstraint("provider", "provider_asset_id"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    provider: Mapped[str] = mapped_column(String(32))
    provider_asset_id: Mapped[str] = mapped_column(String(128))
    meta: Mapped[dict] = mapped_column(JSONB)                   # normalised VideoCandidate snapshot
    thumbnail_path: Mapped[str | None] = mapped_column(Text)    # relative to DATA_DIR/cache
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```
Thumbnail vectors go in the existing `embeddings` table:
`entity_type='remote_asset', entity_id=remote_assets.id, embedding_type='thumbnail', model_name=<CLIP>`.
They never match local searches because `PgVectorStore.search` filters `embedding_type='visual_mean'`.
(Python attribute must not be named `metadata` on a declarative model; use `meta`.)

### 4.3 Phase 7 — no table (REQUIRED: none)
Clip visual statistics → `videos.extra["visual_stats"] = {luma_mean, saturation_mean, motion, version}`.
Vibe prompt embeddings are computed at startup (in memory).
OPTIONAL: a `video_features` table only if feature queries become SQL-heavy.

### 4.4 Phase 8 — none.

### 4.5 Phase 9 — `projects`, `storyboards` (REQUIRED for 9B persistence; 9A needs nothing)

```python
class Project(Base):
    __tablename__ = "projects"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    script: Mapped[str] = mapped_column(Text)                    # ≤ MAX_SCRIPT_CHARS, validated in API
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class StoryboardRow(Base):
    __tablename__ = "storyboards"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True)  # one current storyboard
    version: Mapped[int] = mapped_column(Integer, default=1)
    schema_version: Mapped[int] = mapped_column(Integer)
    document: Mapped[dict] = mapped_column(JSONB)               # Storyboard model (STORYBOARD_TIMELINE_PLAN §2.2)
    created_at / updated_at: ...
```
Why JSONB documents instead of normalised beat/shot tables: the editor loads and saves the whole
document, there are no cross-project queries, validation lives in Pydantic, and versioning is a single
integer. Normalise later only if a concrete query needs it.

Index: `projects (updated_at DESC)` for listing.

### 4.6 Phase 10 — `timelines`, `export_jobs` (REQUIRED)

```python
class TimelineRow(Base):
    __tablename__ = "timelines"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    schema_version: Mapped[int] = mapped_column(Integer)
    built_from_storyboard_version: Mapped[int | None] = mapped_column(Integer)
    document: Mapped[dict] = mapped_column(JSONB)               # Timeline model
    created_at / updated_at: ...

class ExportJob(Base):
    __tablename__ = "export_jobs"
    __table_args__ = (CheckConstraint("status IN ('queued','running','succeeded','failed')"),
                      Index("ix_export_jobs_project_created", "project_id", "created_at"))
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    timeline_version: Mapped[int] = mapped_column(Integer)      # pinned
    status: Mapped[str] = mapped_column(String(16), default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    output_path: Mapped[str | None] = mapped_column(Text)       # relative to DATA_DIR
    error: Mapped[str | None] = mapped_column(Text)             # client-safe
    created_at / started_at / finished_at: ...
```
Deletion: deleting a project cascades to storyboard, timeline and job rows; export files are removed
by the delete handler (best effort, logged).

OPTIONAL: `timeline_versions` (history for undo across sessions) — only if the editor needs it.

### 4.7 Not planned
No users/auth tables (single-user local tool), no separate tables for beats/shots, no new vector tables.

---

## 5. Concurrency/versioning rule
Every mutable document (`storyboards`, `timelines`) uses optimistic concurrency:
```sql
UPDATE timelines SET document = :doc, version = version + 1, updated_at = now()
WHERE project_id = :pid AND version = :client_version
-- 0 rows updated → 409 Conflict with the current version
```

---

## 6. Migration approach
- All changes above are **new tables** (created by `create_all`) or JSONB keys — compatible with the
  existing `init_db` approach. Each phase adds its models to `db/models.py` and, if a new column is
  ever added to an existing table, an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` line in `init_db`.
- `gen_random_uuid()` is not needed (UUIDs generated in Python).
- **Adopt Alembic only if** a non-additive change becomes necessary (rename, type change, data
  migration on large tables). Not expected in Phases 5–10.
- Embedding model/dimension changes follow ARCHITECTURE_PLAN §5.3.

---

## 7. Dataset (local library) plan

Current: 209 clips (~1.3 GB) + 209 thumbnails on disk; database rebuilt from files with
`ingest --local` (embeds all clips in minutes, fetches attribution from Pixabay by id).

### 7.1 Decision required (H1) — how teammates get the dataset
| Option | Pros | Cons |
|---|---|---|
| A. Track `data/` in Git again (matches the stated intent) | simplest for teammates; blobs already in history, so no extra clone cost | large clones (history already ~1.5 GB); every new clip grows history permanently; GitHub warns on files > 50 MB (largest here 51 MB) and rejects > 100 MB — verify current GitHub limits |
| B. Git LFS for `*.mp4`/`*.jpg` | small Git history for new files | LFS storage/bandwidth quotas (verify plan); teammates must install LFS; existing blobs stay in history unless rewritten |
| C. Keep `data/` ignored + tracked manifest + fetch script | small repo going forward; reproducible | needs Pixabay key and download time per teammate; Pixabay renditions may change over time |

Regardless of the choice, add a **tracked** `data/manifest.json` (needs a `.gitignore` exception
`!data/manifest.json`) listing `{asset_key, file, sha256, bytes, duration, width, height}` so every
teammate can verify their copy (`scripts/dataset_manifest.py --verify`). Shrinking history (rewrite)
is destructive and needs explicit team agreement — not planned here.

### 7.2 Future expansion rules (only when benchmarks show coverage gaps)
- Target the categories the evaluation flags as weak (Phase 4.1 found: EV variety, household
  finances, packaging/shipping, healthcare beyond clinics).
- Reuse `scripts/ingest.py --queries ... --per-query N` (idempotent, Pixabay terms respected via the
  same provider); run the near-duplicate check (cosine ≥ 0.93) and size check (skip > 50 MB) afterwards.
- Budget: ~7.5 MB/clip average; each 100 clips ≈ 0.75 GB and ≈ 3–5 min CPU embedding.
- Keep metadata consistent: every clip must have `source_url`, `creator`, `tags`, `extra.embedding`.
- Update `data/manifest.json` in the same change.
