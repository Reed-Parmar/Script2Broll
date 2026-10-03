"""MVP schema: source videos plus a generic embeddings table.

The embedding dimension is fixed at table-creation time (pgvector HNSW indexes need a
fixed dimension). Switching to a model with a different dimension requires a migration
and re-embedding.
"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import get_settings


class Base(DeclarativeBase):
    pass


class Video(Base):
    __tablename__ = "videos"
    __table_args__ = (UniqueConstraint("source_provider", "source_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_provider: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[str] = mapped_column(String(128))
    source_url: Mapped[str] = mapped_column(Text)  # provider page, for attribution
    creator: Mapped[str | None] = mapped_column(Text)  # provider username, for attribution
    video_url: Mapped[str] = mapped_column(Text)  # direct file URL used for playback
    local_path: Mapped[str | None] = mapped_column(Text)
    thumbnail_url: Mapped[str | None] = mapped_column(Text)
    duration: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    tags: Mapped[str | None] = mapped_column(Text)
    # pending -> downloaded -> embedded | failed. created_at is the ingestion timestamp.
    status: Mapped[str] = mapped_column(String(16), default="pending")
    extra: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProviderCache(Base):
    """Cached cloud-provider responses (Pixabay requires caching requests for 24 hours)."""

    __tablename__ = "provider_cache"

    provider: Mapped[str] = mapped_column(String(32), primary_key=True)
    request_key: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256 of params (no API key)
    params: Mapped[dict] = mapped_column(JSONB)
    response: Mapped[dict] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Embedding(Base):
    __tablename__ = "embeddings"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", "embedding_type", "model_name"),
        Index(
            "ix_embeddings_vector_hnsw",
            "vector",
            postgresql_using="hnsw",
            postgresql_ops={"vector": "vector_cosine_ops"},
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32))  # e.g. "video"
    entity_id: Mapped[int] = mapped_column(BigInteger, index=True)
    embedding_type: Mapped[str] = mapped_column(String(32))  # e.g. "visual_mean"
    model_name: Mapped[str] = mapped_column(String(128))
    vector: Mapped[list[float]] = mapped_column(Vector(get_settings().embedding_dim))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
