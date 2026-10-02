"""Build the B-roll library from Pixabay: search -> download -> 8 frames -> embeddings -> pgvector.

Idempotent: re-running never duplicates clips and only embeds clips that have no embedding
for the current EMBEDDING_MODEL. If it stops (e.g. Gemini quota), re-run to resume.

Usage (from backend/):
  uv run python -m scripts.ingest                                    # dev dataset: SEED_TOPICS x 3
  uv run python -m scripts.ingest --queries "ev charging, city traffic" --per-query 5
  uv run python -m scripts.ingest --pending                          # only resume registered clips
"""

import argparse
import logging
import sys
import time

from app.config import get_settings
from app.db.session import get_engine, vector_column_dim
from app.providers import factory
from app.providers.errors import ProviderError
from app.services.ingestion import IngestionService

# Deliberately distinct categories (people, business, tech, transport, nature, science,
# industry, sport, travel) so retrieval quality is easy to judge. ~42 clips at 3 per topic.
SEED_TOPICS = [
    "electric car charging",
    "office meeting",
    "city traffic",
    "factory production",
    "doctor patient",
    "laptop typing",
    "stock market",
    "mountain landscape",
    "gym workout",
    "ocean waves",
    "laboratory scientist",
    "airplane airport",
    "soccer football",
    "circuit board electronics",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--queries", help="Comma-separated search queries (default: SEED_TOPICS)")
    parser.add_argument("--per-query", type=int, default=3, help="Clips to ingest per query (default 3)")
    parser.add_argument("--pending", action="store_true", help="Only embed already-registered clips")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    # httpx logs full request URLs at INFO, and Pixabay URLs carry the API key.
    logging.getLogger("httpx").setLevel(logging.WARNING)

    settings = get_settings()
    engine = get_engine()
    with engine.connect() as conn:
        stored_dim = vector_column_dim(conn)
    if stored_dim != settings.embedding_dim:
        print(
            f"embeddings.vector is vector({stored_dim}) but EMBEDDING_DIM={settings.embedding_dim}. "
            "Run scripts.init_db and resolve the mismatch before ingesting.",
            file=sys.stderr,
        )
        return 1

    started = time.perf_counter()
    try:
        service = IngestionService(
            source=factory.build_video_source(settings),
            embedder=factory.build_embedding_provider(settings),
            store=factory.build_vector_store(),
            engine=engine,
            data_dir=settings.data_dir,
            frames_per_video=settings.frames_per_video,
        )
        if args.pending:
            print(service.embed_pending())
        else:
            queries = [q.strip() for q in args.queries.split(",")] if args.queries else SEED_TOPICS
            for query in filter(None, queries):
                print(f"{query!r}: {service.ingest_query(query, args.per_query)}")
    except ProviderError as exc:
        print(f"Stopped: {exc}. Re-run to resume; finished clips are kept.", file=sys.stderr)
        return 1
    finally:
        print(f"Elapsed: {time.perf_counter() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
