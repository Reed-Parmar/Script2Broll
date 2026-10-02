"""Manual retrieval validation and performance baseline.

Runs the validation queries through the real search service and prints, for each, the top-k
clips with score, the Pixabay topic that surfaced the clip during ingestion, tags and the
local thumbnail path, so a person can open the thumbnails and judge each result as
relevant / partially relevant / irrelevant. It does not compute an accuracy figure: there
is no labelled ground truth, only these manual judgements.

Usage (from backend/):  uv run python -m scripts.evaluate [--k 5] [query ...]
"""

import argparse
import statistics
import sys

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Embedding
from app.db.session import get_engine
from app.providers import factory
from app.providers.errors import ProviderError
from app.services.ingestion import VISUAL_MEAN, thumbnail_path
from app.services.retrieval import SemanticSearchService

VALIDATION_QUERIES = [
    "people charging an electric vehicle",
    "people working in a modern office",
    "busy city traffic",
    "factory production line",
    "doctor treating a patient",
    "person using a laptop",
    "financial market",
    "mountain landscape",
    "people exercising",
    "technology development",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("queries", nargs="*", help="Queries to run (default: VALIDATION_QUERIES)")
    args = parser.parse_args()

    settings = get_settings()
    try:
        service = SemanticSearchService(factory.build_embedding_provider(settings), factory.build_vector_store())
    except ProviderError as exc:
        print(f"Cannot run: {exc}", file=sys.stderr)
        return 1

    embed_ms, search_ms = [], []
    with Session(get_engine()) as session:
        indexed = session.scalar(
            select(func.count()).select_from(Embedding).where(
                Embedding.model_name == service.embedder.model_name, Embedding.embedding_type == VISUAL_MEAN
            )
        )
        print(f"model={service.embedder.model_name} dim={service.embedder.dim} indexed clips={indexed}\n")
        for query in args.queries or VALIDATION_QUERIES:
            try:
                outcome = service.search(session, query, args.k)
            except ProviderError as exc:
                print(f"Stopped: {exc}", file=sys.stderr)
                return 1
            embed_ms.append(outcome.timings_ms["embedding"])
            search_ms.append(outcome.timings_ms["search"])
            print(f"## {query}   (embed {outcome.timings_ms['embedding']:.0f} ms, search {outcome.timings_ms['search']:.0f} ms)")
            if not outcome.hits:
                print("   (no results)")
            for rank, hit in enumerate(outcome.hits, 1):
                v = hit.video
                topic = ", ".join((v.extra or {}).get("queries", []))
                print(f"   {rank}. {hit.score:.3f}  id={v.id:<4} pixabay={v.source_id:<8} topic=[{topic}]  tags=[{v.tags}]")
                print(f"      thumb: {thumbnail_path(settings.data_dir, v.id)}")
            print()

    if embed_ms:
        print(f"query embedding ms: median {statistics.median(embed_ms):.0f}, max {max(embed_ms):.0f}")
        print(f"vector search ms:   median {statistics.median(search_ms):.1f}, max {max(search_ms):.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
