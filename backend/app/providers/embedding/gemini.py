import math
import time
from pathlib import Path

from google.genai import errors as genai_errors
from google.genai import types

from app.providers.embedding.base import EmbeddingProvider, l2_normalize
from app.providers.errors import ProviderError
from app.providers.gemini_client import check_model, describe_api_error, make_client

# gemini-embedding-2 accepts at most 6 images per request.
IMAGE_BATCH_SIZE = 6
TEXT_BATCH_SIZE = 100
RETRYABLE_CODES = (429, 500, 503)
MAX_ATTEMPTS = 4
# gemini-embedding-2 ignores task_type; the task is stated in the text instead.
QUERY_PREFIX = "task: search result | query: "


class GeminiEmbeddingProvider(EmbeddingProvider):
    """Gemini Embedding 2: multimodal (text/image/video) in a single vector space."""

    name = "gemini"

    def __init__(self, api_key: str | None, model: str, dim: int, timeout_seconds: float = 60.0):
        self.model_name = model
        self.dim = dim
        self._client = make_client(api_key, timeout_seconds)

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        contents = [types.Content(parts=[types.Part.from_text(text=QUERY_PREFIX + t)]) for t in texts]
        return self._embed_batched(contents, TEXT_BATCH_SIZE)

    def embed_images(self, image_paths: list[Path]) -> list[list[float]]:
        contents = [
            types.Content(parts=[types.Part.from_bytes(data=Path(p).read_bytes(), mime_type="image/jpeg")])
            for p in image_paths
        ]
        return self._embed_batched(contents, IMAGE_BATCH_SIZE)

    def check(self) -> dict:
        return check_model(self._client, self.model_name) | {"dim": self.dim}

    def _embed_batched(self, contents: list[types.Content], batch_size: int) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(contents), batch_size):
            vectors.extend(self._embed(contents[start : start + batch_size]))
        return vectors

    def _embed(self, contents: list[types.Content]) -> list[list[float]]:
        # Each item is its own Content (one entry in batchEmbedContents). A flat list of
        # Parts would be merged by the SDK into one Content and return a single aggregated vector.
        config = types.EmbedContentConfig(output_dimensionality=self.dim)
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = self._client.models.embed_content(
                    model=self.model_name, contents=contents, config=config
                )
                break
            except genai_errors.APIError as exc:
                if exc.code in RETRYABLE_CODES and attempt < MAX_ATTEMPTS:
                    time.sleep(2**attempt)
                    continue
                raise ProviderError(describe_api_error(exc, self.model_name)) from None
            except Exception as exc:  # network/timeouts; don't echo text that may hold the key
                raise ProviderError(f"Gemini embedding request failed ({type(exc).__name__})") from None

        embeddings = response.embeddings or []
        if len(embeddings) != len(contents):
            raise ProviderError(f"Gemini returned {len(embeddings)} embeddings for {len(contents)} inputs")
        return [self._validated(e.values) for e in embeddings]

    def _validated(self, values: list[float] | None) -> list[float]:
        vector = list(values or [])
        if len(vector) != self.dim:
            raise ProviderError(f"Gemini returned a {len(vector)}-dim vector, expected {self.dim}")
        if not all(math.isfinite(x) for x in vector) or not any(vector):
            raise ProviderError("Gemini returned an invalid (non-finite or zero) vector")
        # The API normalises truncated outputs; normalising again is cheap and makes the
        # cosine-search contract explicit regardless of provider behaviour.
        return l2_normalize(vector)
