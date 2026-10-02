"""POST /v1/editorial/analyze and the editorial mode of POST /v1/search, with the LLM mocked."""

import json

import pytest

from app.api.editorial import get_editorial_analyzer
from app.providers import factory
from app.providers.errors import ProviderError
from app.services.editorial import EditorialIntentAnalyzer
from tests.test_editorial import EV_ANALYSIS, EV_SENTENCE, FakeLLM
from tests.test_search_api import FakeService, SearchHit, video

EV_QUERY = "cars waiting in a queue at a busy electric vehicle charging station"


@pytest.fixture
def use_llm(client, monkeypatch):
    """Route every LLM the app builds to a FakeLLM (both the analyze endpoint and editorial search)."""

    def install(llm):
        monkeypatch.setattr(factory, "build_llm_provider", lambda _: llm)
        return llm

    return install


@pytest.fixture
def use_service(client):
    from app.api import search as search_api
    from app.db.session import get_session

    def install(service):
        client.app.dependency_overrides[search_api.get_search_service] = lambda: service
        client.app.dependency_overrides[get_session] = lambda: None
        return service

    return install


# --- /v1/editorial/analyze ------------------------------------------------------------------


def test_analyze_returns_structured_intent(client, use_llm):
    use_llm(FakeLLM())
    response = client.post("/v1/editorial/analyze", json={"text": f"  {EV_SENTENCE}  "})
    assert response.status_code == 200, response.text
    assert response.json() == {
        "original_text": EV_SENTENCE,
        **EV_ANALYSIS,
        "retrieval_query": EV_QUERY,
    }


def test_analyze_dependency_can_be_overridden(client):
    client.app.dependency_overrides[get_editorial_analyzer] = lambda: EditorialIntentAnalyzer(FakeLLM())
    assert client.post("/v1/editorial/analyze", json={"text": "x"}).json()["editorial_intent"] == "problem"


@pytest.mark.parametrize("payload", [{"text": ""}, {"text": "  "}, {}, {"text": "x" * 501}, {"text": 3}])
def test_analyze_invalid_input(client, use_llm, payload):
    llm = use_llm(FakeLLM())
    assert client.post("/v1/editorial/analyze", json=payload).status_code == 422
    assert llm.calls == []


@pytest.mark.parametrize(
    ("reply", "detail"),
    [
        ("not json", "The language model returned malformed JSON"),
        (json.dumps({**EV_ANALYSIS, "editorial_intent": "vibe"}), "The language model returned an invalid editorial analysis (editorial_intent)"),
    ],
)
def test_analyze_invalid_llm_output_is_502(client, use_llm, reply, detail):
    use_llm(FakeLLM(reply=reply))
    response = client.post("/v1/editorial/analyze", json={"text": EV_SENTENCE})
    assert response.status_code == 502
    assert response.json() == {"detail": detail}


def test_analyze_llm_failure_is_502(client, use_llm):
    use_llm(FakeLLM(error=ProviderError("Ollama request timed out")))
    response = client.post("/v1/editorial/analyze", json={"text": EV_SENTENCE})
    assert (response.status_code, response.json()) == (502, {"detail": "Ollama request timed out"})


def test_analyze_llm_not_configured_is_503(client):
    # Default test settings: Gemini LLM without a key.
    response = client.post("/v1/editorial/analyze", json={"text": EV_SENTENCE})
    assert (response.status_code, response.json()) == (503, {"detail": "GEMINI_API_KEY is not set"})


# --- /v1/search mode=editorial -------------------------------------------------------------


def test_editorial_search_searches_the_retrieval_query(client, use_llm, use_service):
    use_llm(FakeLLM())
    service = use_service(FakeService([SearchHit(video(3), 0.31)]))

    response = client.post("/v1/search", json={"query": EV_SENTENCE, "top_k": 4, "mode": "editorial"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert service.calls == [(EV_QUERY, 4)]  # CLIP sees the visual query, not the sentence
    assert (body["mode"], body["query"], body["retrieval_query"]) == ("editorial", EV_SENTENCE, EV_QUERY)
    assert body["editorial"]["editorial_intent"] == "problem"
    assert body["editorial"]["retrieval_query"] == EV_QUERY
    assert [r["video_id"] for r in body["results"]] == [3]
    assert set(body["timings_ms"]) == {"analysis", "embedding", "search", "total"}


def test_semantic_search_is_the_default_and_never_calls_the_llm(client, use_service, monkeypatch):
    def no_llm(_):
        raise AssertionError("semantic search must not build an LLM")

    monkeypatch.setattr(factory, "build_llm_provider", no_llm)
    service = use_service(FakeService([SearchHit(video(1), 0.5)]))

    body = client.post("/v1/search", json={"query": "busy city traffic"}).json()

    assert service.calls == [("busy city traffic", 12)]
    assert (body["mode"], body["retrieval_query"], body["editorial"]) == ("semantic", "busy city traffic", None)
    assert set(body["timings_ms"]) == {"embedding", "search", "total"}


def test_unknown_mode_is_rejected(client, use_service):
    service = use_service(FakeService())
    assert client.post("/v1/search", json={"query": "x", "mode": "vibe"}).status_code == 422
    assert service.calls == []


def test_editorial_search_llm_failure_does_not_search(client, use_llm, use_service):
    use_llm(FakeLLM(reply="{}"))
    service = use_service(FakeService())
    response = client.post("/v1/search", json={"query": EV_SENTENCE, "mode": "editorial"})
    assert response.status_code == 502
    assert "invalid editorial analysis" in response.json()["detail"]
    assert service.calls == []
