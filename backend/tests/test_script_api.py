"""POST /v1/script/analyze with the LLM and search mocked; regressions for the existing search modes."""

import json

import pytest
from sqlalchemy.exc import OperationalError

from app.api import search as search_api
from app.db.session import get_session
from app.providers import factory
from app.providers.errors import ProviderError
from app.services.script import MAX_SCRIPT_CHARS, MAX_SENTENCES
from tests.test_script import EV_SCRIPT, FakeSearch, ScriptedLLM, analysis_for
from tests.test_search_api import FakeService, SearchHit, video


@pytest.fixture
def install(client, monkeypatch):
    def _install(llm=None, search=None):
        llm = llm or ScriptedLLM()
        search = search or FakeSearch()
        monkeypatch.setattr(factory, "build_llm_provider", lambda _: llm)
        client.app.dependency_overrides[search_api.get_search_service] = lambda: search
        client.app.dependency_overrides[get_session] = lambda: None
        return llm, search

    return _install


def test_analyze_script_returns_beats_with_intent_query_and_broll(client, install):
    _, search = install()
    response = client.post("/v1/script/analyze", json={"script": f"\n {EV_SCRIPT} \n", "top_k": 3})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["script"] == EV_SCRIPT
    assert (body["model"], body["top_k"]) == ("fake-clip", 3)
    assert set(body["timings_ms"]) == {"segmentation", "beats", "total"}
    first = body["beats"][0]
    assert first == {
        "beat_id": "beat-1",
        "order": 1,
        "text": "Electric vehicles are becoming increasingly popular.",
        "status": "ok",
        "error": None,
        "editorial_intent": "context",
        "topic": "electric vehicles",
        "visual_role": "show the subject",
        "visual_description": "shot of electric scene",
        "retrieval_query": "electric vehicles, shot of electric scene",
        "broll_results": [
            {
                "video_id": 1, "score": 0.3, "source": "Pixabay", "source_id": "1001",
                "source_url": "https://pixabay.com/videos/id-1/", "creator": "jdoe",
                "tags": ["electric car", "charging"], "duration": 8.4, "width": 1280, "height": 720,
                "video_url": "/v1/videos/1/file", "thumbnail_url": "/v1/videos/1/thumbnail",
            }
        ],
    }
    assert [b["editorial_intent"] for b in body["beats"]] == ["context", "problem", "context"]
    assert [k for _, k in search.queries] == [3, 3, 3]  # top_k passed through to every beat's search


def test_default_top_k_matches_search(client, install):
    _, search = install()
    assert client.post("/v1/script/analyze", json={"script": EV_SCRIPT}).json()["top_k"] == 12
    assert {k for _, k in search.queries} == {12}


def test_partial_failure_is_explicit_per_beat(client, install):
    def editorial(text):
        return "garbage" if "However" in text else json.dumps(analysis_for(text))

    install(llm=ScriptedLLM(editorial=editorial))
    body = client.post("/v1/script/analyze", json={"script": EV_SCRIPT}).json()

    assert [b["status"] for b in body["beats"]] == ["ok", "error", "ok"]
    failed = body["beats"][1]
    assert failed["beat_id"] == "beat-2" and failed["text"].startswith("However")
    assert failed["error"] == "The language model returned malformed JSON"
    assert failed["editorial_intent"] is None and failed["retrieval_query"] is None and failed["broll_results"] == []


@pytest.mark.parametrize(
    "payload",
    [{}, {"script": ""}, {"script": " \n\n "}, {"script": 5}, {"script": "x" * (MAX_SCRIPT_CHARS + 1)},
     {"script": EV_SCRIPT, "top_k": 0}, {"script": EV_SCRIPT, "top_k": 51}],
)
def test_invalid_requests_are_422(client, install, payload):
    llm, search = install()
    assert client.post("/v1/script/analyze", json=payload).status_code == 422
    assert llm.calls == [] and search.queries == []


def test_too_many_sentences_is_422(client, install):
    llm, _ = install()
    script = " ".join(f"Sentence {i}." for i in range(MAX_SENTENCES + 1))
    response = client.post("/v1/script/analyze", json={"script": script})
    assert response.status_code == 422
    assert "sentences" in response.json()["detail"]
    assert llm.calls == []


def test_invalid_segmentation_is_502(client, install):
    install(llm=ScriptedLLM(segmentation={"beats": [{"sentences": [1]}, {"sentences": [3]}]}))
    response = client.post("/v1/script/analyze", json={"script": EV_SCRIPT})
    assert response.status_code == 502
    assert "cover sentences 1-3" in response.json()["detail"]


def test_llm_unavailable_is_502(client, install):
    install(llm=ScriptedLLM(segmentation_error=ProviderError("Ollama is not reachable at http://localhost:11434 (ConnectError)")))
    response = client.post("/v1/script/analyze", json={"script": EV_SCRIPT})
    assert (response.status_code, response.json()["detail"]) == (502, "Ollama is not reachable at http://localhost:11434 (ConnectError)")


def test_llm_not_configured_is_503(client):
    # Default test settings: Gemini LLM without a key; fails before any beat is processed.
    client.app.dependency_overrides[search_api.get_search_service] = lambda: FakeSearch()
    client.app.dependency_overrides[get_session] = lambda: None
    response = client.post("/v1/script/analyze", json={"script": EV_SCRIPT})
    assert (response.status_code, response.json()) == (503, {"detail": "GEMINI_API_KEY is not set"})


def test_database_failure_is_503(client, install):
    class BrokenSearch(FakeSearch):
        def search(self, session, query, top_k):
            raise OperationalError("SELECT", {}, Exception("db down"))

    install(search=BrokenSearch())
    response = client.post("/v1/script/analyze", json={"script": EV_SCRIPT})
    assert (response.status_code, response.json()) == (503, {"detail": "Database unavailable"})


# --- regressions: the Phase 2 and Phase 3 modes are unchanged -------------------------------------


def test_semantic_search_still_works_and_never_calls_the_llm(client, monkeypatch):
    def no_llm(_):
        raise AssertionError("semantic search must not build an LLM")

    monkeypatch.setattr(factory, "build_llm_provider", no_llm)
    service = FakeService([SearchHit(video(1), 0.5)])
    client.app.dependency_overrides[search_api.get_search_service] = lambda: service
    client.app.dependency_overrides[get_session] = lambda: None

    body = client.post("/v1/search", json={"query": "busy city traffic"}).json()
    assert (body["mode"], body["retrieval_query"], [r["video_id"] for r in body["results"]]) == ("semantic", "busy city traffic", [1])


def test_editorial_search_still_works(client, install):
    llm, _ = install()
    service = FakeService([SearchHit(video(2), 0.4)])
    client.app.dependency_overrides[search_api.get_search_service] = lambda: service

    body = client.post("/v1/search", json={"query": "Charging remains a challenge.", "mode": "editorial"}).json()
    assert body["mode"] == "editorial" and body["editorial"]["editorial_intent"] == "problem"
    assert service.calls == [(body["retrieval_query"], 12)]
