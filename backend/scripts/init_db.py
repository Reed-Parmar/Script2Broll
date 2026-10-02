"""Create the pgvector extension and MVP tables. Idempotent.

Usage (from backend/):  uv run python -m scripts.init_db
"""

import sys

from sqlalchemy import text

from app.config import get_settings
from app.db.models import Base
from app.db.session import get_engine, vector_column_dim


def main() -> int:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        # Columns added after the first schema version (create_all never alters tables).
        conn.execute(text("ALTER TABLE videos ADD COLUMN IF NOT EXISTS creator TEXT"))
        dim = vector_column_dim(conn)
    print("Database initialised:", ", ".join(sorted(Base.metadata.tables)), f"(embedding dim {dim})")

    expected = get_settings().embedding_dim
    if dim != expected:
        print(
            f"EMBEDDING_DIM={expected} but embeddings.vector is vector({dim}). Vectors from different "
            "spaces must not be mixed: drop the embeddings table (or migrate) and re-ingest.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
