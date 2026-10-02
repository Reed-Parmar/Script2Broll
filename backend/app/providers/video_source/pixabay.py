import httpx

from app.providers.errors import ProviderError, ProviderNotConfigured
from app.providers.video_source.base import VideoCandidate, VideoSourceProvider

PIXABAY_VIDEOS_URL = "https://pixabay.com/api/videos/"

# Pixabay returns several renditions (large ~4K, medium ~1080p+, small ~720p, tiny ~540p).
# 720p is plenty for frame embeddings and browser previews, and keeps downloads small.
RENDITION_PREFERENCE = ("small", "medium", "tiny", "large")


class PixabayVideoProvider(VideoSourceProvider):
    name = "pixabay"

    def __init__(self, api_key: str | None, timeout_seconds: float = 10.0, client: httpx.Client | None = None):
        if not api_key:
            raise ProviderNotConfigured("PIXABAY_API_KEY is not set")
        self._api_key = api_key
        self._client = client or httpx.Client(timeout=timeout_seconds)

    def search(self, query: str, per_page: int = 20, page: int = 1) -> list[VideoCandidate]:
        data = self._get({"q": query, "per_page": per_page, "page": page, "safesearch": "true"})
        return [c for c in (self._to_candidate(hit) for hit in data.get("hits", [])) if c]

    def check(self) -> dict:
        data = self._get({"q": "nature", "per_page": 3})
        return {"total_hits": data.get("totalHits", 0)}

    def _get(self, params: dict) -> dict:
        try:
            response = self._client.get(PIXABAY_VIDEOS_URL, params={"key": self._api_key, **params})
        except httpx.HTTPError as exc:
            # httpx messages include the request URL, which contains the key.
            raise ProviderError(f"Pixabay request failed ({type(exc).__name__})") from None
        if response.status_code in (400, 401, 403):
            raise ProviderError(f"Pixabay rejected the request; check PIXABAY_API_KEY (HTTP {response.status_code})")
        if response.status_code == 429:
            raise ProviderError("Pixabay rate limit exceeded (HTTP 429)")
        if response.status_code != 200:
            raise ProviderError(f"Pixabay API error (HTTP {response.status_code})")
        try:
            return response.json()
        except ValueError:
            raise ProviderError("Pixabay returned a non-JSON response") from None

    def _to_candidate(self, hit: dict) -> VideoCandidate | None:
        videos = hit.get("videos") or {}
        rendition = next((videos[k] for k in RENDITION_PREFERENCE if videos.get(k, {}).get("url")), None)
        if rendition is None:
            return None
        return VideoCandidate(
            source_provider=self.name,
            source_id=str(hit["id"]),
            source_url=hit.get("pageURL", ""),
            video_url=rendition["url"],
            thumbnail_url=rendition.get("thumbnail"),
            duration=hit.get("duration"),
            width=rendition.get("width"),
            height=rendition.get("height"),
            tags=[t.strip() for t in hit.get("tags", "").split(",") if t.strip()],
            creator=hit.get("user") or None,
        )
