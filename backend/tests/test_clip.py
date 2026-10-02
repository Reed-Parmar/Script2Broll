"""Local CLIP provider. Unit tests swap in a tiny fake model; the real-model test is opt-in."""

import math
import os

import pytest
import torch
from PIL import Image

from app.providers import factory
from app.providers.embedding import clip
from app.providers.errors import ProviderError
from tests.conftest import make_settings

DIM = 512


class FakeClipModel:
    """encode_text/encode_image return unnormalised vectors, like real CLIP."""

    def __init__(self, dim=DIM):
        self.dim = dim
        self.text_batches = []
        self.image_batches = []

    def encode_text(self, tokens):
        self.text_batches.append(len(tokens))
        out = torch.zeros(len(tokens), self.dim)
        out[:, 0] = 3.0
        return out

    def encode_image(self, pixels):
        self.image_batches.append(len(pixels))
        out = torch.zeros(len(pixels), self.dim)
        out[:, 1] = 5.0
        return out


@pytest.fixture
def fake_model(monkeypatch):
    model = FakeClipModel()
    loaded = clip._LoadedModel(
        model,
        preprocess=lambda image: torch.zeros(3, 4, 4),
        tokenizer=lambda texts: torch.zeros(len(texts), 77, dtype=torch.long),
        device="cpu",
    )
    monkeypatch.setattr(clip, "_load", lambda architecture, pretrained: loaded)
    return model


@pytest.fixture
def provider():
    return factory.build_embedding_provider(make_settings())


def frames(tmp_path, count):
    paths = []
    for i in range(count):
        paths.append(tmp_path / f"frame_{i:02d}.jpg")
        Image.new("RGB", (32, 18), (i * 10, 0, 0)).save(paths[-1])
    return paths


def test_parse_model():
    assert clip.parse_model("ViT-B-32/laion2b_s34b_b79k") == ("ViT-B-32", "laion2b_s34b_b79k")
    with pytest.raises(ProviderError, match="architecture"):
        clip.parse_model("ViT-B-32")


def test_text_vectors_are_normalised(provider, fake_model):
    vectors = provider.embed_texts(["people using laptops", "busy city traffic"])
    assert len(vectors) == 2
    assert vectors[0][0] == pytest.approx(1.0)
    assert math.fsum(x * x for x in vectors[1]) == pytest.approx(1.0)


def test_one_image_vector_per_frame_in_batches(provider, fake_model, tmp_path, monkeypatch):
    monkeypatch.setattr(clip, "IMAGE_BATCH_SIZE", 6)
    vectors = provider.embed_images(frames(tmp_path, 8))
    assert len(vectors) == 8
    assert fake_model.image_batches == [6, 2]
    assert all(v[1] == pytest.approx(1.0) and len(v) == DIM for v in vectors)


def test_wrong_dimension_is_rejected(fake_model):
    provider = factory.build_embedding_provider(make_settings(embedding_dim=768))
    with pytest.raises(ProviderError, match="512-dim"):
        provider.embed_texts(["x"])


def test_check_reports_model_and_dim(provider, fake_model):
    assert provider.check() == {"model": "ViT-B-32/laion2b_s34b_b79k", "dim": DIM, "device": "cpu"}


@pytest.mark.skipif(not os.environ.get("RUN_CLIP_MODEL_TESTS"), reason="set RUN_CLIP_MODEL_TESTS=1 (loads real weights)")
def test_real_model_shared_space(provider, tmp_path):
    red, blue = tmp_path / "red.jpg", tmp_path / "blue.jpg"
    Image.new("RGB", (224, 224), (220, 20, 20)).save(red)
    Image.new("RGB", (224, 224), (20, 20, 220)).save(blue)
    images = provider.embed_images([red, blue])
    [text] = provider.embed_texts(["a plain red square"])
    assert len(text) == DIM
    similarity = [sum(a * b for a, b in zip(text, image)) for image in images]
    assert similarity[0] > similarity[1]
