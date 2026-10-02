"""Real PostgreSQL + pgvector (and FFmpeg) with a deterministic fake embedder; no external APIs.

Rows are isolated from the real library by model name and source provider, and removed afterwards.
"""

from pathlib import Path

import httpx
import pytest
import respx
from sqlalchemy import delete, func, select

from app.api import search as search_api
from app.config import get_settings
from app.db.models import Embedding, Video
from app.providers.embedding.base import EmbeddingProvider
from app.providers.video_source.base import VideoCandidate, VideoSourceProvider
from app.services.ingestion import ENTITY_VIDEO, VISUAL_MEAN, IngestionService, thumbnail_path
from app.services.retrieval import SemanticSearchService
from app.vectorstore.pgvector import PgVectorStore
from tests.conftest import make_settings, make_test_video, requires_ffmpeg

pytestmark = pytest.mark.integration

DIM = get_settings().embedding_dim  # the dimension the real embeddings table was created with
TEST_MODEL = "test-embedder"
TEST_PROVIDER = "test"


def unit(i: int) -> list[float]:
    v = [0.0] * DIM
    v[i] = 1.0
    return v


class FakeEmbedder(EmbeddingProvider):
    """Concept vectors: 'car' texts and all frames -> axis 0, 'office' -> axis 1, other -> axis 2."""

    name = "fake"
    model_name = TEST_MODEL
    dim = DIM

    def __init__(self):
        self.image_calls = 0

    def embed_texts(self, texts):
        return [unit(0) if "car" in t else unit(1) if "office" in t else unit(2) for t in texts]

    def embed_images(self, image_paths):
        self.image_calls += 1
        return [unit(0) for _ in image_paths]

    def check(self):
        return {}


class FakeSource(VideoSourceProvider):
    name = TEST_PROVIDER

    def __init__(self, candidates):
        self.candidates = candidates

    def search(self, query, per_page=20, page=1):
        return self.candidates

    def get(self, source_id):
        return next((c for c in self.candidates if c.source_id == source_id), None)

    def check(self):
        return {}


def candidate(source_id: str, duration: float = 4) -> VideoCandidate:
    return VideoCandidate(
        source_provider=TEST_PROVIDER, source_id=source_id, source_url=f"https://example.test/{source_id}",
        video_url=f"https://cdn.example.test/{source_id}.mp4", thumbnail_url=None,
        duration=duration, width=1, height=1, tags=["car", "charging"], creator="tester",
    )


@pytest.fixture
def store(db_engine):
    yield PgVectorStore(db_engine)
    with db_engine.begin() as conn:
        conn.execute(delete(Embedding).where(Embedding.model_name.like(f"{TEST_MODEL}%")))
        conn.execute(delete(Video).where(Video.source_provider == TEST_PROVIDER))


@pytest.fixture
def settings(tmp_path):
    return make_settings(data_dir=tmp_path / "data")


# --- vector store -----------------------------------------------------------------


def test_vector_store_insert_search_and_upsert(store, db_engine):
    store.upsert(ENTITY_VIDEO, 900_000_001, VISUAL_MEAN, TEST_MODEL, unit(0))
    store.upsert(ENTITY_VIDEO, 900_000_002, VISUAL_MEAN, TEST_MODEL, unit(1))
    near = [0.0] * DIM
    near[0], near[1] = 0.6, 0.8
    store.upsert(ENTITY_VIDEO, 900_000_003, VISUAL_MEAN, TEST_MODEL, near)

    matches = store.search(unit(0), TEST_MODEL, VISUAL_MEAN, top_k=3)
    assert [m.entity_id for m in matches] == [900_000_001, 900_000_003, 900_000_002]
    assert [round(m.score, 3) for m in matches] == [1.0, 0.6, 0.0]

    # Same key again replaces the vector instead of adding a row.
    store.upsert(ENTITY_VIDEO, 900_000_001, VISUAL_MEAN, TEST_MODEL, unit(2))
    with db_engine.connect() as conn:
        count = conn.scalar(select(func.count()).select_from(Embedding).where(Embedding.model_name == TEST_MODEL))
    assert count == 3
    assert store.search(unit(0), TEST_MODEL, VISUAL_MEAN, top_k=1)[0].entity_id == 900_000_003

    # Different model = different embedding space: never mixed into results.
    assert store.search(unit(0), TEST_MODEL + "-other", VISUAL_MEAN) == []


def test_vector_store_rejects_wrong_dimension(store):
    with pytest.raises(Exception, match="dimension"):
        store.upsert(ENTITY_VIDEO, 900_000_009, VISUAL_MEAN, TEST_MODEL, [1.0, 0.0, 0.0])


# --- ingestion ---------------------------------------------------------------------


@pytest.fixture
def ingest(store, db_engine, settings, tmp_path):
    """Runs ingestion against a fake source whose downloads are served by respx."""
    clip_bytes = make_test_video(tmp_path / "clip.mp4").read_bytes()
    embedder = FakeEmbedder()
    source = FakeSource([candidate("good"), candidate("corrupt"), candidate("long", duration=600)])

    with respx.mock(assert_all_called=False) as router:
        good = router.get("https://cdn.example.test/good.mp4").mock(return_value=httpx.Response(200, content=clip_bytes))
        router.get("https://cdn.example.test/corrupt.mp4").mock(return_value=httpx.Response(200, content=b"not a video"))
        service = IngestionService(source, embedder, store, db_engine, settings.data_dir, frames_per_video=8, http=httpx.Client())
        yield service, embedder, good


@requires_ffmpeg
def test_ingestion_is_complete_and_idempotent(ingest, db_engine, settings):
    service, embedder, good_route = ingest

    first = service.ingest_query("electric car", limit=5)
    assert (first.found, first.new, first.embedded, first.skipped_too_long) == (2, 2, 1, 1)
    assert len(first.failed) == 1 and "corrupt" in first.failed[0]

    second = service.ingest_query("ev charging", limit=5)
    assert (second.new, second.embedded, second.already_embedded) == (0, 0, 1)
    assert embedder.image_calls == 1  # not re-embedded
    assert good_route.call_count == 1  # download reused

    with db_engine.connect() as conn:
        videos = conn.execute(select(Video).where(Video.source_provider == TEST_PROVIDER)).all()
        embeddings = conn.scalar(select(func.count()).select_from(Embedding).where(Embedding.model_name == TEST_MODEL))
    assert len(videos) == 2  # no duplicate rows
    assert embeddings == 1
    by_id = {v.source_id: v for v in videos}
    good, bad = by_id["good"], by_id["corrupt"]
    assert good.status == "embedded" and bad.status == "failed"
    assert (good.width, good.height) == (320, 240)  # probed from the file, not provider metadata
    assert good.duration == pytest.approx(4.0, abs=0.2)
    assert good.creator == "tester"
    assert good.local_path == "videos/test_good.mp4"
    assert good.extra["embedding"] == {"model": TEST_MODEL, "dim": DIM, "frames": 8, "aggregation": "mean"}
    assert good.extra["queries"] == ["electric car", "ev charging"]
    assert thumbnail_path(settings.data_dir, good.id).is_file()


@requires_ffmpeg
def test_local_files_are_indexed_without_downloading(store, db_engine, settings):
    videos_dir = settings.data_dir / "videos"
    videos_dir.mkdir(parents=True)
    make_test_video(videos_dir / f"{TEST_PROVIDER}_local1.mp4")
    (videos_dir / "unnamed.mp4").write_bytes(b"skipped: not <provider>_<id>")
    embedder = FakeEmbedder()

    with respx.mock:  # no routes: any download attempt would fail the run
        service = IngestionService(FakeSource([candidate("local1")]), embedder, store, db_engine, settings.data_dir, http=httpx.Client())
        first = service.ingest_local()
        second = service.ingest_local()

    assert (first.found, first.new, first.embedded, first.failed) == (1, 1, 1, [])
    assert (second.new, second.embedded, second.already_embedded) == (0, 0, 1)
    assert embedder.image_calls == 1
    with db_engine.connect() as conn:
        [video] = conn.execute(select(Video).where(Video.source_provider == TEST_PROVIDER)).all()
    assert (video.status, video.local_path, video.creator) == ("embedded", "videos/test_local1.mp4", "tester")
    assert thumbnail_path(settings.data_dir, video.id).is_file()


# --- search service + API -----------------------------------------------------------------


@requires_ffmpeg
def test_search_request_end_to_end(ingest, client, store):
    service, embedder, _ = ingest
    service.ingest_query("electric car", limit=5)
    client.app.dependency_overrides[search_api.get_search_service] = lambda: SemanticSearchService(embedder, store)

    response = client.post("/v1/search", json={"query": "people charging an electric car", "top_k": 5})
    assert response.status_code == 200, response.text
    [hit] = response.json()["results"]  # the corrupt clip has no embedding, so is never returned
    assert hit["score"] == pytest.approx(1.0)
    assert hit["source_id"] == "good"

    unrelated = client.post("/v1/search", json={"query": "office"}).json()["results"]
    assert unrelated[0]["score"] == pytest.approx(0.0)

    # The result's media links are playable from the backend, including byte ranges for seeking.
    video = client.get(hit["video_url"])
    assert video.status_code == 200 and video.headers["content-type"] == "video/mp4"
    assert client.get(hit["video_url"], headers={"Range": "bytes=0-99"}).status_code == 206
    thumb = client.get(hit["thumbnail_url"])
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/jpeg"
    assert client.get(f"/v1/videos/{hit['video_id']}").json()["creator"] == "tester"


@requires_ffmpeg
def test_editorial_search_end_to_end(ingest, client, store, monkeypatch):
    """Script line -> (fake) LLM analysis -> retrieval query -> real pgvector search -> clip."""
    import json

    from app.providers import factory
    from tests.test_editorial import FakeLLM

    service, embedder, _ = ingest
    service.ingest_query("electric car", limit=5)
    client.app.dependency_overrides[search_api.get_search_service] = lambda: SemanticSearchService(embedder, store)
    # The script line never says "car"; only the LLM's visual description does (the fake embedder
    # maps "car" texts onto the clips' axis), so a hit proves the retrieval query was searched.
    llm = FakeLLM(reply=json.dumps({
        "topic": "charging infrastructure", "editorial_intent": "problem",
        "visual_role": "show the bottleneck", "visual_description": "a queue of cars at a charging station",
    }))
    monkeypatch.setattr(factory, "build_llm_provider", lambda _: llm)

    sentence = "Infrastructure has not kept pace with demand."
    semantic = client.post("/v1/search", json={"query": sentence}).json()["results"]
    editorial = client.post("/v1/search", json={"query": sentence, "mode": "editorial"}).json()

    assert semantic[0]["score"] == pytest.approx(0.0)
    assert editorial["retrieval_query"] == "charging infrastructure, a queue of cars at a charging station"
    [hit] = editorial["results"]
    assert (hit["source_id"], hit["score"]) == ("good", pytest.approx(1.0))


def test_unknown_video_404(client, db_engine):
    assert client.get("/v1/videos/987654321").status_code == 404
    assert client.get("/v1/videos/987654321/file").status_code == 404


def test_media_outside_data_dir_is_not_served(client, store, db_engine):
    from sqlalchemy.orm import Session

    with Session(db_engine) as session:
        video = Video(
            source_provider=TEST_PROVIDER, source_id="escape", source_url="", video_url="",
            local_path="../../../../Windows/win.ini", extra={},
        )
        session.add(video)
        session.commit()
        assert client.get(f"/v1/videos/{video.id}/file").status_code == 404
