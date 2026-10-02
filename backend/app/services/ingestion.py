"""Builds the searchable library: provider search -> download -> frames -> embedding -> vector store.

Idempotent and resumable: clips are keyed by (provider, source_id), downloads are reused,
and only clips without an embedding for the current model are (re)processed.
"""

import logging
import re
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Embedding, Video
from app.providers.embedding.base import EmbeddingProvider, mean_vector
from app.providers.errors import ProviderError
from app.providers.video_source.base import VideoCandidate, VideoSourceProvider
from app.services.frames import FrameExtractionError, probe_video, sample_frames
from app.vectorstore.base import VectorStore

log = logging.getLogger(__name__)

ENTITY_VIDEO = "video"
# One vector per clip: the normalised mean of its sampled frame embeddings.
VISUAL_MEAN = "visual_mean"
# Stock B-roll is short; skip long clips to keep downloads and embedding cost bounded.
MAX_CLIP_SECONDS = 60
# Downloads are stored as DATA_DIR/videos/<provider>_<source id>.mp4.
LOCAL_FILE_NAME = re.compile(r"^(?P<provider>[a-z]+)_(?P<source_id>[A-Za-z0-9-]+)$")


def thumbnail_path(data_dir: Path, video_id: int) -> Path:
    return data_dir / "thumbnails" / f"{video_id}.jpg"


@dataclass
class IngestReport:
    found: int = 0
    new: int = 0
    skipped_too_long: int = 0
    embedded: int = 0
    already_embedded: int = 0
    failed: list[str] = field(default_factory=list)
    # Seconds spent per stage, summed over the clips processed in this run.
    timings: dict[str, float] = field(default_factory=lambda: {"download": 0.0, "frames": 0.0, "embed": 0.0})


class IngestionService:
    def __init__(
        self,
        source: VideoSourceProvider | None,
        embedder: EmbeddingProvider,
        store: VectorStore,
        engine: Engine,
        data_dir: Path,
        frames_per_video: int = 8,
        http: httpx.Client | None = None,
    ):
        self.source = source
        self.embedder = embedder
        self.store = store
        self.data_dir = data_dir
        self.frames_per_video = frames_per_video
        self._sessions = sessionmaker(bind=engine, expire_on_commit=False)
        self._http = http or httpx.Client(timeout=120, follow_redirects=True)

    def ingest_query(self, query: str, limit: int = 20) -> IngestReport:
        """Search the provider for `query` and add up to `limit` hits to the searchable library."""
        report = IngestReport()
        # Pixabay accepts 3..200 results per page; over-fetch a little to make up for skipped clips.
        hits = self.source.search(query, per_page=max(3, min(limit * 2, 200)))
        candidates = []
        for hit in hits:
            if hit.duration and hit.duration > MAX_CLIP_SECONDS:
                report.skipped_too_long += 1
            elif len(candidates) < limit:
                candidates.append(hit)
        report.found = len(candidates)
        with self._sessions() as session:
            videos = []
            for candidate in candidates:
                video, created = self._register(session, candidate, query)
                report.new += created
                videos.append(video)
            session.commit()
            for video in videos:
                self._process(session, video, report)
        return report

    def ingest_local(self, limit: int | None = None) -> IngestReport:
        """Register and index clips already in DATA_DIR/videos, without downloading them again.

        Attribution metadata (page URL, creator, tags) is looked up by id from the source
        provider when one is configured; the video file itself is never re-fetched.
        """
        report = IngestReport()
        files = sorted((self.data_dir / "videos").glob("*.mp4"))
        with self._sessions() as session:
            videos = []
            for path in files:
                if limit is not None and len(videos) >= limit:
                    break
                match = LOCAL_FILE_NAME.match(path.stem)
                if match is None:
                    log.warning("Skipping %s: name is not <provider>_<source id>.mp4", path.name)
                    continue
                video, created = self._register(session, self._local_candidate(match["provider"], match["source_id"]))
                report.new += created
                videos.append(video)
            session.commit()
            report.found = len(videos)
            for video in videos:
                self._process(session, video, report)
        return report

    def _local_candidate(self, provider: str, source_id: str) -> VideoCandidate:
        if self.source is not None and self.source.name == provider:
            try:
                candidate = self.source.get(source_id)
            except ProviderError as exc:
                log.warning("No metadata for %s/%s: %s", provider, source_id, exc)
            else:
                if candidate is not None:
                    return candidate
        return VideoCandidate(
            source_provider=provider, source_id=source_id, source_url="", video_url="",
            thumbnail_url=None, duration=None, width=None, height=None,
        )

    def embed_pending(self) -> IngestReport:
        """(Re)process registered clips that have no embedding for the current model."""
        report = IngestReport()
        with self._sessions() as session:
            videos = session.scalars(select(Video).order_by(Video.id)).all()
            report.found = len(videos)
            for video in videos:
                self._process(session, video, report)
        return report

    def _register(self, session: Session, candidate: VideoCandidate, query: str | None = None) -> tuple[Video, bool]:
        video = session.scalar(
            select(Video).where(
                Video.source_provider == candidate.source_provider,
                Video.source_id == candidate.source_id,
            )
        )
        created = video is None
        if created:
            video = Video(
                source_provider=candidate.source_provider,
                source_id=candidate.source_id,
                source_url=candidate.source_url,
                creator=candidate.creator,
                video_url=candidate.video_url,
                thumbnail_url=candidate.thumbnail_url,
                duration=candidate.duration,
                width=candidate.width,
                height=candidate.height,
                tags=", ".join(candidate.tags),
                status="pending",
                extra={},
            )
            session.add(video)
        # Remember which ingestion queries surfaced the clip (shown by the validation script).
        queries = list(video.extra.get("queries", []))
        if query is not None and query not in queries:
            video.extra = {**video.extra, "queries": [*queries, query]}
        session.flush()
        return video, created

    def _has_embedding(self, session: Session, video: Video) -> bool:
        return session.scalar(
            select(Embedding.id).where(
                Embedding.entity_type == ENTITY_VIDEO,
                Embedding.entity_id == video.id,
                Embedding.embedding_type == VISUAL_MEAN,
                Embedding.model_name == self.embedder.model_name,
            )
        ) is not None

    def _process(self, session: Session, video: Video, report: IngestReport) -> None:
        if self._has_embedding(session, video):
            report.already_embedded += 1
            return
        try:
            started = time.perf_counter()
            local = self._download(session, video)
            report.timings["download"] += time.perf_counter() - started

            started = time.perf_counter()
            info = probe_video(local)  # validates the file; corrupt downloads fail here
            video.duration, video.width, video.height = round(info.duration, 2), info.width, info.height
            with tempfile.TemporaryDirectory() as tmp:
                frames = sample_frames(local, Path(tmp), self.frames_per_video, info.duration)
                report.timings["frames"] += time.perf_counter() - started

                started = time.perf_counter()
                # Raises ProviderError on quota/auth/billing problems: those affect every clip,
                # so the run stops and the clip stays "downloaded" for the next run to pick up.
                vector = mean_vector(self.embedder.embed_images(frames))
                report.timings["embed"] += time.perf_counter() - started

                thumb = thumbnail_path(self.data_dir, video.id)
                thumb.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(frames[len(frames) // 2], thumb)
            self.store.upsert(ENTITY_VIDEO, video.id, VISUAL_MEAN, self.embedder.model_name, vector)
        except (FrameExtractionError, httpx.HTTPError, OSError) as exc:
            reason = _describe(exc)
            log.warning("Clip %s/%s failed: %s", video.source_provider, video.source_id, reason)
            video.status = "failed"
            video.extra = {**video.extra, "error": reason}
            session.commit()
            report.failed.append(f"{video.source_provider}/{video.source_id}: {reason}")
            return
        except ProviderError:
            session.commit()
            raise
        video.status = "embedded"
        extra = {k: v for k, v in video.extra.items() if k != "error"}
        extra["embedding"] = {
            "model": self.embedder.model_name,
            "dim": self.embedder.dim,
            "frames": len(frames),
            "aggregation": "mean",
        }
        video.extra = extra
        session.commit()
        report.embedded += 1
        log.info("Embedded %s/%s (%d frames)", video.source_provider, video.source_id, len(frames))

    def _download(self, session: Session, video: Video) -> Path:
        relative = Path("videos") / f"{video.source_provider}_{video.source_id}.mp4"
        target = self.data_dir / relative
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = target.with_suffix(".part")
            with self._http.stream("GET", video.video_url) as response:
                response.raise_for_status()
                with partial.open("wb") as f:
                    for chunk in response.iter_bytes():
                        f.write(chunk)
            partial.replace(target)
        video.local_path = relative.as_posix()  # relative to DATA_DIR, so the library can move
        if video.status in ("pending", "failed"):
            video.status = "downloaded"
        session.commit()
        return target


def _describe(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"download failed (HTTP {exc.response.status_code})"
    if isinstance(exc, httpx.HTTPError):
        return f"download failed ({type(exc).__name__})"
    return str(exc) or type(exc).__name__
