import httpx
import pytest
import respx
from sqlalchemy import create_engine

from app.api import health
from app.providers import factory
from app.providers.errors import ProviderError
from app.providers.video_source.pixabay import PIXABAY_VIDEOS_URL
from tests.conftest import FAKE_PIXABAY_KEY, GEMINI_EMBEDDING, make_settings


def test_liveness(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


class FakeEmbedder:
    def __init__(self, error=None):
        self.error = error

    def check(self):
        if self.error:
            raise self.error
        return {"model": "ViT-B-32/laion2b_s34b_b79k", "dim": 512, "device": "cpu"}


def test_ai_reports_the_configured_embedding_provider(client, monkeypatch):
    # Local CLIP needs no Gemini key; the unused LLM's state is reported without failing the check.
    monkeypatch.setattr(factory, "build_embedding_provider", lambda _: FakeEmbedder())
    response = client.get("/health/ai")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "embedding": {"provider": "clip", "model": "ViT-B-32/laion2b_s34b_b79k", "dim": 512, "device": "cpu"},
        "llm": {"status": "not_configured", "detail": "GEMINI_API_KEY is not set"},
    }


def test_ai_embedding_failure(client, monkeypatch):
    monkeypatch.setattr(factory, "build_embedding_provider", lambda _: FakeEmbedder(ProviderError("Could not load CLIP model")))
    response = client.get("/health/ai")
    assert response.status_code == 503
    assert response.json() == {"status": "error", "detail": "Could not load CLIP model"}


@pytest.mark.parametrize("settings", [make_settings(**GEMINI_EMBEDDING)])
def test_ai_gemini_embeddings_not_configured(client):
    response = client.get("/health/ai")
    assert response.status_code == 503
    assert response.json() == {"status": "not_configured", "detail": "GEMINI_API_KEY is not set"}


def test_pixabay_not_configured(client):
    response = client.get("/health/pixabay")
    assert response.status_code == 503
    assert response.json()["status"] == "not_configured"


@pytest.mark.parametrize("settings", [make_settings(pixabay_api_key=FAKE_PIXABAY_KEY)])
@respx.mock
def test_pixabay_ok(client):
    respx.get(PIXABAY_VIDEOS_URL).mock(return_value=httpx.Response(200, json={"totalHits": 500, "hits": []}))
    response = client.get("/health/pixabay")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "total_hits": 500}
    assert FAKE_PIXABAY_KEY not in response.text


def test_database_unreachable(client, monkeypatch):
    secret_url = "postgresql+psycopg://user:db-password-SHOULD-NOT-LEAK@127.0.0.1:1/x"
    monkeypatch.setattr(health, "get_engine", lambda: create_engine(secret_url, connect_args={"connect_timeout": 2}))
    response = client.get("/health/database")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "error"
    assert "SHOULD-NOT-LEAK" not in response.text
