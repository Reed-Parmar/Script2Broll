"""Runs against the real DATABASE_URL. Skipped automatically when no database is reachable."""

import pytest
from sqlalchemy import text

from app.config import get_settings
from app.db.models import Base
from app.db.session import check_database

pytestmark = pytest.mark.integration


@pytest.fixture
def engine(db_engine):
    return db_engine


def test_pgvector_available(engine):
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    assert check_database(engine)["pgvector_version"]


def test_schema_and_cosine_search(engine):
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        result = conn.execute(text("SELECT '[1,0,0]'::vector <=> '[0,1,0]'::vector")).scalar_one()
    assert result == pytest.approx(1.0)


def test_health_database_ok(engine, client):
    response = client.get("/health/database")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["pgvector_version"]
    assert body["embedding_dim"] == get_settings().embedding_dim
