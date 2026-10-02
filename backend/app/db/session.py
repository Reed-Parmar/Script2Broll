from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(
        get_settings().database_url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 5},
    )


def get_session() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session."""
    factory = sessionmaker(bind=get_engine(), expire_on_commit=False)
    with factory() as session:
        yield session


def vector_column_dim(conn) -> int | None:
    """Dimension of embeddings.vector as created in the database (None if the table is missing)."""
    return conn.execute(
        text(
            "SELECT atttypmod FROM pg_attribute "
            "WHERE attrelid = to_regclass('embeddings') AND attname = 'vector'"
        )
    ).scalar_one_or_none()


def check_database(engine: Engine) -> dict:
    """Verify connectivity and report pgvector and the stored embedding dimension."""
    with engine.connect() as conn:
        server_version = conn.execute(text("SHOW server_version")).scalar_one()
        pgvector_version = conn.execute(
            text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
        ).scalar_one_or_none()
        embedding_dim = vector_column_dim(conn)
    return {"server_version": server_version, "pgvector_version": pgvector_version, "embedding_dim": embedding_dim}
