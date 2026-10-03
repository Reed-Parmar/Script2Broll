"""Phase 5 retrieval orchestrator: local CLIP/pgvector search + optional cloud providers.

    beat queries ─┬─ LocalCandidateSource  (existing multi_query_search, unchanged)
                  └─ CloudCandidateSource  (keyword query → cache → provider.search)
                → dedupe by asset_key (local wins) → quotas (local_k, cloud_k, fill) → labelled list

Cloud problems never fail the request: they become a per-source status. Scores from different
sources are not merged (quotas instead), see docs/RETRIEVAL_PLAN.md §3.5.
"""

import logging
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Literal

from sqlalchemy.orm import Session

from app.providers.errors import ProviderError
from app.providers.video_source.base import VideoCandidate, VideoSourceProvider
from app.providers.video_source.cache import ProviderCache
from app.services.candidates import BrollCandidate, from_cloud, from_local_hit
from app.services.keyword_query import keyword_fallbacks
from app.services.retrieval import MultiQueryHit, SemanticSearchService, multi_query_search

log = logging.getLogger(__name__)

MAX_CLIP_SECONDS = 60  # same limit as ingestion

# Remote thumbnail URLs seen in cloud results, for the backend thumbnail proxy (asset_key -> url).
REMOTE_THUMBNAILS: dict[str, str] = {}


@dataclass(frozen=True)
class RetrievalPolicy:
    local_k: int = 12
    cloud_k: int = 0
    cloud_providers: tuple[str, ...] = ()
    fill: Literal["strict", "backfill"] = "backfill"
    # Phase 7: fetch at least this many local candidates so vibe re-ranking can choose among them
    # (quotas still apply afterwards). 0 = no extra pool.
    vibe_pool: int = 0


@dataclass
class SourceStatus:
    status: Literal["ok", "not_configured", "error", "skipped_budget", "disabled"]
    count: int = 0
    detail: str | None = None
    requests: int = 0
    cache_hits: int = 0
    latency_ms: float = 0.0


@dataclass
class BeatRequest:
    queries: list[str]  # CLIP captions, primary first
    topic: str
    shots: list[str]  # visual_description + filmable visuals (for keyword queries)


@dataclass
class RetrievalOutcome:
    candidates: list[BrollCandidate]
    local_hits: list[MultiQueryHit]
    source_status: dict[str, SourceStatus]
    warnings: list[str] = field(default_factory=list)
    local_pool: list[BrollCandidate] = field(default_factory=list)  # all fetched local candidates, by relevance


class CloudBudget:
    """Per-request cap on provider calls (Pixabay allows 100 requests / 60 s)."""

    def __init__(self, max_requests: int):
        self.remaining = max_requests
        self._lock = threading.Lock()  # beats are processed concurrently

    def take(self) -> bool:
        with self._lock:
            if self.remaining <= 0:
                return False
            self.remaining -= 1
            return True


class CloudCandidateSource:
    def __init__(self, name: str, provider: VideoSourceProvider | None, cache: ProviderCache | None, queries_per_beat: int = 1):
        self.name = name
        self.provider = provider
        self.cache = cache
        self.queries_per_beat = queries_per_beat

    def retrieve(self, request: BeatRequest, k: int, budget: CloudBudget) -> tuple[list[BrollCandidate], SourceStatus]:
        if self.provider is None:
            return [], SourceStatus("not_configured", detail=f"{self.name} is not configured")
        started = time.perf_counter()
        status = SourceStatus("ok")
        found: dict[str, BrollCandidate] = {}
        per_page = max(3, min(20, k * 3))
        for shot in request.shots[: self.queries_per_beat]:
            for q in keyword_fallbacks(request.topic, shot):
                hits = self._search(q, per_page, status, budget)
                if hits is None:  # error or budget: stop this source
                    status.latency_ms = round((time.perf_counter() - started) * 1000, 1)
                    return list(found.values())[:k], status
                usable = [h for h in hits if not h.duration or h.duration <= MAX_CLIP_SECONDS]
                for rank, hit in enumerate(usable, 1):
                    cand = from_cloud(hit, rank, q)
                    found.setdefault(cand.asset_key, cand)
                    if hit.thumbnail_url:
                        REMOTE_THUMBNAILS[cand.asset_key] = hit.thumbnail_url
                if usable:
                    break  # no need for broader fallback queries
        status.count = min(len(found), k)
        status.latency_ms = round((time.perf_counter() - started) * 1000, 1)
        return list(found.values())[:k], status

    def _search(self, q: str, per_page: int, status: SourceStatus, budget: CloudBudget) -> list[VideoCandidate] | None:
        params = {"q": q, "per_page": per_page}
        if self.cache is not None:
            cached = self.cache.get(self.name, params)
            if cached is not None:
                status.cache_hits += 1
                return [VideoCandidate(**c) for c in cached["candidates"]]
        if not budget.take():
            status.status, status.detail = "skipped_budget", "cloud request budget for this script is used up"
            return None
        status.requests += 1
        try:
            hits = self.provider.search(q, per_page=per_page)
        except ProviderError as exc:
            status.status, status.detail = "error", str(exc)
            log.warning("Cloud provider %s failed: %s", self.name, exc)
            return None
        if self.cache is not None:
            self.cache.put(self.name, params, {"candidates": [asdict(h) for h in hits]})
        return hits


class BrollRetrievalService:
    def __init__(self, search: SemanticSearchService, clouds: dict[str, CloudCandidateSource] | None = None,
                 max_cloud_requests: int = 20):
        self.search = search  # the existing local search (embedder + pgvector)
        self.clouds = clouds or {}
        self.max_cloud_requests = max_cloud_requests

    def new_budget(self) -> CloudBudget:
        return CloudBudget(self.max_cloud_requests)

    def retrieve(self, session: Session, request: BeatRequest, policy: RetrievalPolicy,
                 budget: CloudBudget | None = None) -> RetrievalOutcome:
        budget = budget or self.new_budget()
        warnings: list[str] = []
        status: dict[str, SourceStatus] = {}

        # Local: unchanged Phase 4.1 behaviour. Fetch enough for backfill when cloud comes up short.
        local_fetch = max(policy.local_k + (policy.cloud_k if policy.fill == "backfill" else 0), policy.vibe_pool)
        local_outcome = multi_query_search(self.search, session, request.queries, max(local_fetch, 1))
        warnings += [f"Query '{q}' failed: {err}" for q, err in local_outcome.failed_queries.items()]
        local = [from_local_hit(h) for h in local_outcome.hits]
        status["local"] = SourceStatus("ok", count=len(local))

        cloud: list[BrollCandidate] = []
        if policy.cloud_k > 0:
            for name in policy.cloud_providers:
                source = self.clouds.get(name)
                if source is None:
                    status[name] = SourceStatus("disabled", detail=f"{name} is not enabled (CLOUD_PROVIDERS)")
                    continue
                found, st = source.retrieve(request, policy.cloud_k * 2, budget)
                status[name] = st
                cloud += found

        # Dedupe across sources: the same Pixabay clip may be both local and cloud; local wins.
        local_keys = {c.asset_key for c in local}
        cloud = [c for c in dict((c.asset_key, c) for c in cloud).values() if c.asset_key not in local_keys]

        # Quotas (scores are not comparable across sources).
        chosen_cloud = cloud[: policy.cloud_k]
        local_quota = policy.local_k
        if policy.fill == "backfill":
            local_quota += policy.cloud_k - len(chosen_cloud)
        chosen_local = local[:local_quota]
        if policy.fill == "backfill" and len(chosen_local) < policy.local_k:
            chosen_cloud = cloud[: policy.cloud_k + policy.local_k - len(chosen_local)]
        for name, st in status.items():
            if name != "local":
                st.count = sum(1 for c in chosen_cloud if c.provider == name)
        status["local"].count = len(chosen_local)

        return RetrievalOutcome(
            candidates=chosen_local + chosen_cloud,
            local_hits=local_outcome.hits[: policy.local_k],
            source_status=status,
            warnings=warnings,
            local_pool=local,
        )
