from sqlalchemy import Engine, select, text
from sqlalchemy.dialects.postgresql import insert

from app.db.models import Embedding
from app.vectorstore.base import VectorMatch, VectorStore


class PgVectorStore(VectorStore):
    """VectorStore over the `embeddings` table, ranked by cosine distance (HNSW index)."""

    def __init__(self, engine: Engine):
        self._engine = engine

    def upsert(
        self,
        entity_type: str,
        entity_id: int,
        embedding_type: str,
        model_name: str,
        vector: list[float],
    ) -> None:
        statement = insert(Embedding).values(
            entity_type=entity_type,
            entity_id=entity_id,
            embedding_type=embedding_type,
            model_name=model_name,
            vector=vector,
        )
        statement = statement.on_conflict_do_update(
            index_elements=["entity_type", "entity_id", "embedding_type", "model_name"],
            set_={"vector": statement.excluded.vector, "created_at": text("now()")},
        )
        with self._engine.begin() as conn:
            conn.execute(statement)

    def search(
        self,
        vector: list[float],
        model_name: str,
        embedding_type: str,
        top_k: int = 10,
    ) -> list[VectorMatch]:
        distance = Embedding.vector.cosine_distance(vector).label("distance")
        query = (
            select(Embedding.entity_type, Embedding.entity_id, distance)
            .where(Embedding.model_name == model_name, Embedding.embedding_type == embedding_type)
            .order_by(distance)
            .limit(top_k)
        )
        with self._engine.begin() as conn:
            # The model/type filter is applied after the HNSW scan; iterative scans keep
            # fetching candidates so a filtered query still returns up to top_k rows.
            conn.execute(text("SET LOCAL hnsw.iterative_scan = relaxed_order"))
            rows = conn.execute(query).all()
        matches = [VectorMatch(row.entity_type, row.entity_id, 1.0 - row.distance) for row in rows]
        return sorted(matches, key=lambda m: m.score, reverse=True)
