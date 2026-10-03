"""DB-backed provider response cache (survives restarts). Pixabay: "Requests must be cached for 24 hours"."""

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import Engine, delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from app.db.models import ProviderCache as ProviderCacheRow

log = logging.getLogger(__name__)


def request_key(params: dict) -> str:
    return hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()


class ProviderCache:
    def __init__(self, engine: Engine, ttl_hours: float = 24.0, clock=lambda: datetime.now(timezone.utc)):
        self._engine = engine
        self._ttl = timedelta(hours=ttl_hours)
        self._clock = clock

    def get(self, provider: str, params: dict) -> dict | None:
        """Cached response, or None if missing/expired. Cache errors are non-fatal (treated as a miss)."""
        try:
            with self._engine.connect() as conn:
                row = conn.execute(
                    select(ProviderCacheRow.response, ProviderCacheRow.fetched_at).where(
                        ProviderCacheRow.provider == provider, ProviderCacheRow.request_key == request_key(params)
                    )
                ).first()
        except SQLAlchemyError as exc:
            log.warning("Provider cache read failed: %s", type(exc).__name__)
            return None
        if row is None or row.fetched_at < self._clock() - self._ttl:
            return None
        return row.response

    def put(self, provider: str, params: dict, response: dict) -> None:
        """Params must never contain the API key."""
        statement = insert(ProviderCacheRow).values(
            provider=provider, request_key=request_key(params), params=params, response=response, fetched_at=self._clock()
        )
        statement = statement.on_conflict_do_update(
            index_elements=["provider", "request_key"],
            set_={"response": statement.excluded.response, "fetched_at": statement.excluded.fetched_at},
        )
        try:
            with self._engine.begin() as conn:
                conn.execute(statement)
                conn.execute(delete(ProviderCacheRow).where(ProviderCacheRow.fetched_at < self._clock() - self._ttl))
        except SQLAlchemyError as exc:
            log.warning("Provider cache write failed: %s", type(exc).__name__)
