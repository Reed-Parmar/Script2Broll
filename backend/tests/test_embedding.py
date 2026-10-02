import math
from types import SimpleNamespace

import pytest
from google.genai import errors as genai_errors

from app.providers import factory
from app.providers.embedding import gemini
from app.providers.embedding.base import l2_normalize, mean_vector
from app.providers.errors import ProviderError
from tests.conftest import FAKE_GEMINI_KEY, GEMINI_EMBEDDING, make_settings

DIM = 768


def unit(i: int, dim: int = DIM) -> list[float]:
    v = [0.0] * dim
    v[i] = 1.0
    return v


# --- aggregation ----------------------------------------------------------------


def test_l2_normalize():
    assert l2_normalize([3.0, 4.0]) == pytest.approx([0.6, 0.8])
    assert l2_normalize([0.0, 0.0]) == [0.0, 0.0]


def test_mean_vector_is_normalised_centroid():
    v = mean_vector([[1.0, 0.0], [0.0, 1.0]])
    assert v == pytest.approx([1 / math.sqrt(2), 1 / math.sqrt(2)])
    assert math.hypot(*v) == pytest.approx(1.0)


def test_mean_vector_rejects_empty_and_ragged():
    with pytest.raises(ValueError):
        mean_vector([])
    with pytest.raises(ValueError):
        mean_vector([[1.0, 0.0], [1.0]])


# --- Gemini provider (SDK mocked) ------------------------------------------------


@pytest.fixture
def provider():
    return factory.build_embedding_provider(make_settings(gemini_api_key=FAKE_GEMINI_KEY, **GEMINI_EMBEDDING))


class FakeModels:
    """Stands in for client.models; records calls and returns one vector per Content."""

    def __init__(self, vector=None, fail_with=None):
        self.calls = []
        self.vector = vector or [2.0] + [0.0] * (DIM - 1)  # unnormalised on purpose
        self.fail_with = list(fail_with or [])

    def embed_content(self, *, model, contents, config):
        self.calls.append((model, contents, config))
        if self.fail_with:
            raise self.fail_with.pop(0)
        return SimpleNamespace(embeddings=[SimpleNamespace(values=self.vector) for _ in contents])


def test_embed_texts_one_vector_per_text_with_query_prefix(provider, monkeypatch):
    fake = FakeModels()
    monkeypatch.setattr(provider._client.models, "embed_content", fake.embed_content)

    vectors = provider.embed_texts(["people charging an electric vehicle", "office"])

    assert len(vectors) == 2
    assert vectors[0] == pytest.approx(unit(0))  # normalised
    model, contents, config = fake.calls[0]
    assert model == "gemini-embedding-2"
    assert config.output_dimensionality == DIM
    # One Content per text (not one Content with two Parts, which would aggregate).
    assert [len(c.parts) for c in contents] == [1, 1]
    assert contents[0].parts[0].text == "task: search result | query: people charging an electric vehicle"


def test_embed_images_batches_of_six(provider, monkeypatch, tmp_path):
    fake = FakeModels()
    monkeypatch.setattr(provider._client.models, "embed_content", fake.embed_content)
    frames = []
    for i in range(8):
        frames.append(tmp_path / f"f{i}.jpg")
        frames[-1].write_bytes(b"\xff\xd8fake-jpeg")

    vectors = provider.embed_images(frames)

    assert len(vectors) == 8
    assert [len(call[1]) for call in fake.calls] == [6, 2]
    part = fake.calls[0][1][0].parts[0]
    assert part.inline_data.mime_type == "image/jpeg"


def test_wrong_dimension_is_rejected(provider, monkeypatch):
    monkeypatch.setattr(provider._client.models, "embed_content", FakeModels(vector=[1.0] * 3072).embed_content)
    with pytest.raises(ProviderError, match="3072-dim"):
        provider.embed_texts(["x"])


def test_zero_vector_is_rejected(provider, monkeypatch):
    monkeypatch.setattr(provider._client.models, "embed_content", FakeModels(vector=[0.0] * DIM).embed_content)
    with pytest.raises(ProviderError, match="invalid"):
        provider.embed_texts(["x"])


def test_count_mismatch_is_rejected(provider, monkeypatch):
    class OneOnly(FakeModels):
        def embed_content(self, *, model, contents, config):
            return SimpleNamespace(embeddings=[SimpleNamespace(values=self.vector)])

    monkeypatch.setattr(provider._client.models, "embed_content", OneOnly().embed_content)
    with pytest.raises(ProviderError, match="1 embeddings for 2"):
        provider.embed_texts(["a", "b"])


def _api_error(code: int) -> genai_errors.APIError:
    return genai_errors.APIError(code, {"error": {"message": f"key {FAKE_GEMINI_KEY} problem"}})


def test_rate_limit_is_retried(provider, monkeypatch):
    monkeypatch.setattr(gemini.time, "sleep", lambda _: None)
    fake = FakeModels(fail_with=[_api_error(429), _api_error(503)])
    monkeypatch.setattr(provider._client.models, "embed_content", fake.embed_content)
    assert len(provider.embed_texts(["x"])) == 1
    assert len(fake.calls) == 3


@pytest.mark.parametrize(("code", "expected"), [(402, "credits are depleted"), (403, "rejected"), (429, "rate limit")])
def test_api_errors_are_wrapped_without_key(provider, monkeypatch, code, expected):
    monkeypatch.setattr(gemini.time, "sleep", lambda _: None)
    monkeypatch.setattr(provider._client.models, "embed_content", FakeModels(fail_with=[_api_error(code)] * gemini.MAX_ATTEMPTS).embed_content)
    with pytest.raises(ProviderError, match=expected) as info:
        provider.embed_texts(["x"])
    assert FAKE_GEMINI_KEY not in str(info.value)


def test_network_errors_are_wrapped(provider, monkeypatch):
    monkeypatch.setattr(provider._client.models, "embed_content", FakeModels(fail_with=[TimeoutError(f"url?key={FAKE_GEMINI_KEY}")]).embed_content)
    with pytest.raises(ProviderError, match="TimeoutError") as info:
        provider.embed_texts(["x"])
    assert FAKE_GEMINI_KEY not in str(info.value)
