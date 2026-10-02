"""Local CLIP (OpenCLIP): text and image towers trained into one shared vector space.

Runs on this machine (CPU, or CUDA when available); no API key or per-request cost. Weights
are downloaded once into the Hugging Face cache on first use, then loaded from disk.
"""

import math
import threading
from functools import lru_cache
from pathlib import Path

from app.providers.embedding.base import EmbeddingProvider, l2_normalize
from app.providers.errors import ProviderError

IMAGE_BATCH_SIZE = 16
TEXT_BATCH_SIZE = 64


def parse_model(model: str) -> tuple[str, str]:
    """'ViT-B-32/laion2b_s34b_b79k' -> ('ViT-B-32', 'laion2b_s34b_b79k').

    The pretrained tag is part of the model name because different weights for the same
    architecture produce incompatible vector spaces.
    """
    architecture, _, pretrained = model.partition("/")
    if not architecture or not pretrained:
        raise ProviderError(f"EMBEDDING_MODEL '{model}' must be '<architecture>/<pretrained tag>' for CLIP")
    return architecture, pretrained


class _LoadedModel:
    def __init__(self, model, preprocess, tokenizer, device: str):
        self.model = model
        self.preprocess = preprocess
        self.tokenizer = tokenizer
        self.device = device
        # A torch module is not safe to call from several request threads at once.
        self.lock = threading.Lock()


@lru_cache(maxsize=2)
def _load(architecture: str, pretrained: str) -> _LoadedModel:
    """Load once per process; the API builds a provider per request and must not reload weights."""
    import open_clip
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    try:
        model, _, preprocess = open_clip.create_model_and_transforms(architecture, pretrained=pretrained, device=device)
        tokenizer = open_clip.get_tokenizer(architecture)
    except Exception as exc:  # unknown model, failed weight download, corrupt cache
        raise ProviderError(f"Could not load CLIP model '{architecture}/{pretrained}' ({type(exc).__name__})") from None
    model.eval()
    return _LoadedModel(model, preprocess, tokenizer, device)


class ClipEmbeddingProvider(EmbeddingProvider):
    """OpenCLIP: the text encoder embeds queries, the image encoder embeds frames."""

    name = "clip"

    def __init__(self, model: str, dim: int):
        self.model_name = model
        self.dim = dim
        self._architecture, self._pretrained = parse_model(model)

    def _model(self) -> _LoadedModel:
        return _load(self._architecture, self._pretrained)

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        loaded = self._model()
        vectors: list[list[float]] = []
        for start in range(0, len(texts), TEXT_BATCH_SIZE):
            tokens = loaded.tokenizer(texts[start : start + TEXT_BATCH_SIZE])
            vectors.extend(self._encode(loaded, loaded.model.encode_text, tokens))
        return vectors

    def embed_images(self, image_paths: list[Path]) -> list[list[float]]:
        import torch
        from PIL import Image

        loaded = self._model()
        vectors: list[list[float]] = []
        for start in range(0, len(image_paths), IMAGE_BATCH_SIZE):
            batch = []
            for path in image_paths[start : start + IMAGE_BATCH_SIZE]:
                with Image.open(path) as image:
                    batch.append(loaded.preprocess(image.convert("RGB")))
            vectors.extend(self._encode(loaded, loaded.model.encode_image, torch.stack(batch)))
        return vectors

    def check(self) -> dict:
        loaded = self._model()
        [vector] = self.embed_texts(["health check"])  # proves the weights load and run
        return {"model": self.model_name, "dim": len(vector), "device": loaded.device}

    def _encode(self, loaded: _LoadedModel, encode, inputs) -> list[list[float]]:
        import torch

        with loaded.lock, torch.inference_mode():
            output = encode(inputs.to(loaded.device)).float().cpu()
        return [self._validated(row.tolist()) for row in output]

    def _validated(self, vector: list[float]) -> list[float]:
        if len(vector) != self.dim:
            raise ProviderError(f"CLIP returned a {len(vector)}-dim vector, expected {self.dim} (check EMBEDDING_DIM)")
        if not all(math.isfinite(x) for x in vector) or not any(vector):
            raise ProviderError("CLIP returned an invalid (non-finite or zero) vector")
        # CLIP outputs are not unit length; cosine search assumes they are.
        return l2_normalize(vector)
