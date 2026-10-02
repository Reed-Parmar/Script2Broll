import httpx
import pytest
import respx
from sqlalchemy import create_engine

from app.api import health
from app.providers.video_source.pixabay import PIXABAY_VIDEOS_URL
from tests.conftest import FAKE_PIXABAY_KEY, make_settings


def test_liveness(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ai_not_configured(client):
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
