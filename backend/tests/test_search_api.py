"""POST /v1/search contract and error handling, with the search service and DB session faked."""

import pytest
from sqlalchemy.exc import OperationalError

from app.api import search as search_api
from app.db.models import Video
from app.db.session import get_session
from app.providers.errors import ProviderError, ProviderNotConfigured
from app.services.retrieval import SearchHit, SearchOutcome
from tests.conftest import FAKE_GEMINI_KEY


class FakeService:
    def __init__(self, hits=None, error=None):
        self.embedder = type("E", (), {"model_name": "fake-model"})()
        self.hits = hits or []
        self.error = error
        self.calls = []

    def search(self, session, query, top_k):
        self.calls.append((query, top_k))
        if self.error:
            raise self.error
        return SearchOutcome(self.hits, {"embedding": 1.0, "search": 2.0})


@pytest.fixture
def use_service(client):
    def install(service):
        client.app.dependency_overrides[search_api.get_search_service] = lambda: service
        client.app.dependency_overrides[get_session] = lambda: None
        return service

    return install


def video(id_: int) -> Video:
    return Video(
        id=id_, source_provider="pixabay", source_id=str(1000 + id_), source_url=f"https://pixabay.com/videos/id-{id_}/",
        creator="jdoe", tags="electric car, charging", duration=8.4, width=1280, height=720,
        local_path="videos/x.mp4", video_url="https://cdn/x.mp4", extra={},
    )


def test_valid_query_returns_ranked_results(client, use_service):
    service = use_service(FakeService([SearchHit(video(2), 0.91234), SearchHit(video(1), 0.5)]))

    response = client.post("/v1/search", json={"query": "  people charging   an electric vehicle ", "top_k": 5})

    assert response.status_code == 200, response.text
    body = response.json()
    assert service.calls == [("people charging an electric vehicle", 5)]  # whitespace normalised
    assert body["query"] == "people charging an electric vehicle"
    assert body["model"] == "fake-model"
    assert set(body["timings_ms"]) == {"embedding", "search", "total"}
    first = body["results"][0]
    assert first == {
        "video_id": 2, "score": 0.9123, "source": "Pixabay", "source_id": "1002",
        "source_url": "https://pixabay.com/videos/id-2/", "creator": "jdoe",
        "tags": ["electric car", "charging"], "duration": 8.4, "width": 1280, "height": 720,
        "video_url": "/v1/videos/2/file", "thumbnail_url": "/v1/videos/2/thumbnail",
    }
    assert [r["video_id"] for r in body["results"]] == [2, 1]
    assert "local_path" not in response.text  # no filesystem details exposed


def test_default_top_k(client, use_service):
    service = use_service(FakeService())
    client.post("/v1/search", json={"query": "office"})
    assert service.calls == [("office", 12)]


@pytest.mark.parametrize("payload", [{"query": ""}, {"query": "   "}, {}, {"query": "x" * 501}, {"query": 5}])
def test_invalid_query_rejected(client, use_service, payload):
    service = use_service(FakeService())
    assert client.post("/v1/search", json=payload).status_code == 422
    assert service.calls == []


@pytest.mark.parametrize("top_k", [0, -1, 51, "many"])
def test_invalid_top_k_rejected(client, use_service, top_k):
    use_service(FakeService())
    assert client.post("/v1/search", json={"query": "office", "top_k": top_k}).status_code == 422


def test_no_results(client, use_service):
    use_service(FakeService([]))
    response = client.post("/v1/search", json={"query": "underwater volcano"})
    assert response.status_code == 200
    assert response.json()["results"] == []


def test_embedding_provider_failure(client, use_service):
    use_service(FakeService(error=ProviderError("Gemini quota or rate limit exceeded (HTTP 429)")))
    response = client.post("/v1/search", json={"query": "office"})
    assert response.status_code == 502
    assert response.json() == {"detail": "Gemini quota or rate limit exceeded (HTTP 429)"}


def test_embedding_provider_not_configured(client):
    # No dependency override: the real factory runs with settings that have no Gemini key.
    client.app.dependency_overrides[get_session] = lambda: None
    response = client.post("/v1/search", json={"query": "office"})
    assert response.status_code == 503
    assert response.json() == {"detail": "GEMINI_API_KEY is not set"}


def test_database_failure_is_generic(client, use_service):
    secret = f"postgresql://user:pw-{FAKE_GEMINI_KEY}@db"
    use_service(FakeService(error=OperationalError("SELECT 1", {}, Exception(f"could not connect {secret}"))))
    response = client.post("/v1/search", json={"query": "office"})
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}
    assert FAKE_GEMINI_KEY not in response.text
