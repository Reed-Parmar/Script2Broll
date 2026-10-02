import httpx
import pytest
import respx
from google.genai import errors as genai_errors

from app.providers import factory
from app.providers.errors import ProviderError, ProviderNotConfigured
from app.providers.video_source.pixabay import PIXABAY_VIDEOS_URL, PixabayVideoProvider
from tests.conftest import FAKE_GEMINI_KEY, FAKE_PIXABAY_KEY, GEMINI_EMBEDDING, make_settings

PIXABAY_HIT = {
    "id": 125,
    "pageURL": "https://pixabay.com/videos/id-125/",
    "tags": "electric car, charging, ev",
    "user": "jdoe",
    "duration": 12,
    "videos": {
        "large": {"url": "https://cdn/large.mp4", "width": 1920, "height": 1080, "thumbnail": "https://cdn/l.jpg"},
        "medium": {"url": "https://cdn/medium.mp4", "width": 1280, "height": 720, "thumbnail": "https://cdn/m.jpg"},
        "tiny": {"url": "", "width": 0, "height": 0},
    },
}


# --- factory / initialisation -------------------------------------------------


def test_providers_require_keys():
    s = make_settings()
    with pytest.raises(ProviderNotConfigured):
        factory.build_llm_provider(s)
    with pytest.raises(ProviderNotConfigured):
        factory.build_embedding_provider(make_settings(**GEMINI_EMBEDDING))
    with pytest.raises(ProviderNotConfigured):
        factory.build_video_source(s)


def test_clip_is_the_default_and_needs_no_key():
    embedding = factory.build_embedding_provider(make_settings())
    assert (embedding.name, embedding.model_name, embedding.dim) == ("clip", "ViT-B-32/laion2b_s34b_b79k", 512)


def test_providers_initialise_with_keys():
    s = make_settings(gemini_api_key=FAKE_GEMINI_KEY, pixabay_api_key=FAKE_PIXABAY_KEY, **GEMINI_EMBEDDING)
    assert factory.build_llm_provider(s).name == "gemini"
    embedding = factory.build_embedding_provider(s)
    assert (embedding.model_name, embedding.dim) == ("gemini-embedding-2", 768)
    assert factory.build_video_source(s).name == "pixabay"


def test_unknown_embedding_provider():
    s = make_settings(gemini_api_key=FAKE_GEMINI_KEY, embedding_provider="nope")
    with pytest.raises(ProviderNotConfigured, match="nope"):
        factory.build_embedding_provider(s)


# --- Pixabay --------------------------------------------------------------------


@respx.mock
def test_pixabay_search_parses_hits():
    route = respx.get(PIXABAY_VIDEOS_URL).mock(
        return_value=httpx.Response(200, json={"totalHits": 1, "hits": [PIXABAY_HIT]})
    )
    [clip] = PixabayVideoProvider(FAKE_PIXABAY_KEY).search("ev charging", per_page=5)

    assert route.calls.last.request.url.params["key"] == FAKE_PIXABAY_KEY
    assert clip.source_id == "125"
    assert clip.video_url == "https://cdn/medium.mp4"  # medium preferred over large
    assert (clip.width, clip.height, clip.duration) == (1280, 720, 12)
    assert clip.tags == ["electric car", "charging", "ev"]
    assert clip.creator == "jdoe"


@respx.mock
def test_pixabay_prefers_720p_rendition():
    hit = {**PIXABAY_HIT, "videos": {**PIXABAY_HIT["videos"], "small": {"url": "https://cdn/small.mp4", "width": 1280, "height": 720}}}
    respx.get(PIXABAY_VIDEOS_URL).mock(return_value=httpx.Response(200, json={"totalHits": 1, "hits": [hit]}))
    [clip] = PixabayVideoProvider(FAKE_PIXABAY_KEY).search("ev")
    assert clip.video_url == "https://cdn/small.mp4"


@respx.mock
def test_pixabay_get_by_id():
    route = respx.get(PIXABAY_VIDEOS_URL).mock(return_value=httpx.Response(200, json={"totalHits": 1, "hits": [PIXABAY_HIT]}))
    clip = PixabayVideoProvider(FAKE_PIXABAY_KEY).get("125")
    assert route.calls.last.request.url.params["id"] == "125"
    assert (clip.source_id, clip.creator, clip.source_url) == ("125", "jdoe", "https://pixabay.com/videos/id-125/")


@respx.mock
def test_pixabay_get_unknown_id():
    respx.get(PIXABAY_VIDEOS_URL).mock(return_value=httpx.Response(200, json={"totalHits": 0, "hits": []}))
    assert PixabayVideoProvider(FAKE_PIXABAY_KEY).get("1") is None


def test_pixabay_hit_without_renditions_is_skipped():
    provider = PixabayVideoProvider(FAKE_PIXABAY_KEY)
    assert provider._to_candidate({"id": 1, "videos": {"tiny": {"url": ""}}}) is None


@respx.mock
@pytest.mark.parametrize("status", [400, 403, 429, 500])
def test_pixabay_http_errors_are_wrapped_without_key(status):
    respx.get(PIXABAY_VIDEOS_URL).mock(return_value=httpx.Response(status, text="err"))
    with pytest.raises(ProviderError) as info:
        PixabayVideoProvider(FAKE_PIXABAY_KEY).check()
    assert str(status) in str(info.value)
    assert FAKE_PIXABAY_KEY not in str(info.value)


@respx.mock
def test_pixabay_network_error_does_not_leak_key():
    respx.get(PIXABAY_VIDEOS_URL).mock(side_effect=httpx.ConnectError("boom"))
    with pytest.raises(ProviderError) as info:
        PixabayVideoProvider(FAKE_PIXABAY_KEY).check()
    assert "ConnectError" in str(info.value)
    assert FAKE_PIXABAY_KEY not in str(info.value)


# --- Gemini ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("code", "expected"),
    [(401, "API key"), (404, "not found"), (429, "rate limit"), (500, "HTTP 500")],
)
def test_gemini_api_errors_are_wrapped(monkeypatch, code, expected):
    provider = factory.build_llm_provider(make_settings(gemini_api_key=FAKE_GEMINI_KEY))

    def fail(**_):
        raise genai_errors.APIError(code, {"error": {"message": f"bad key {FAKE_GEMINI_KEY}"}})

    monkeypatch.setattr(provider._client.models, "get", fail)
    with pytest.raises(ProviderError, match=expected) as info:
        provider.check()
    assert FAKE_GEMINI_KEY not in str(info.value)


def test_gemini_check_success(monkeypatch):
    provider = factory.build_embedding_provider(make_settings(gemini_api_key=FAKE_GEMINI_KEY, **GEMINI_EMBEDDING))

    class Info:
        display_name = "Gemini Embedding 2"

    monkeypatch.setattr(provider._client.models, "get", lambda **_: Info())
    assert provider.check() == {"model": "gemini-embedding-2", "display_name": "Gemini Embedding 2", "dim": 768}
