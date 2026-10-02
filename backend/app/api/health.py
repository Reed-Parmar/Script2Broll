"""Connectivity checks. Responses only describe integration state; they never echo secrets.

Each check returns 200 with status "ok", or 503 with status "not_configured" / "error".
"""

from collections.abc import Callable

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings, get_settings
from app.db.session import check_database, get_engine
from app.providers import factory
from app.providers.errors import ProviderError, ProviderNotConfigured

router = APIRouter(prefix="/health", tags=["health"])


def _result(check: Callable[[], dict]) -> JSONResponse:
    try:
        details = check()
    except ProviderNotConfigured as exc:
        return JSONResponse({"status": "not_configured", "detail": str(exc)}, status_code=503)
    except ProviderError as exc:
        return JSONResponse({"status": "error", "detail": str(exc)}, status_code=503)
    return JSONResponse({"status": "ok", **details})


@router.get("")
def health() -> dict:
    """Liveness: the API process is up. Does not touch external services."""
    return {"status": "ok", "service": "script2broll-backend"}


@router.get("/database")
def health_database() -> JSONResponse:
    def check() -> dict:
        try:
            details = check_database(get_engine())
        except SQLAlchemyError as exc:
            # Driver messages can contain the connection string; report the class only.
            raise ProviderError(f"Database unreachable ({type(exc.orig or exc).__name__})") from None
        if details["pgvector_version"] is None:
            raise ProviderError("Connected, but the pgvector extension is not installed (run scripts.init_db)")
        return details

    return _result(check)


def _llm_status(settings: Settings) -> dict:
    """The LLM is not used by Phase 1 search, so its state is reported without failing the check."""
    try:
        return {"status": "ok", **factory.build_llm_provider(settings).check()}
    except ProviderNotConfigured as exc:
        return {"status": "not_configured", "detail": str(exc)}
    except ProviderError as exc:
        return {"status": "error", "detail": str(exc)}


@router.get("/ai")
def health_ai(settings: Settings = Depends(get_settings)) -> JSONResponse:
    """Status follows the configured embedding provider (which search depends on)."""

    def check() -> dict:
        embedding = {"provider": settings.embedding_provider, **factory.build_embedding_provider(settings).check()}
        return {"embedding": embedding, "llm": _llm_status(settings)}

    return _result(check)


@router.get("/pixabay")
def health_pixabay(settings: Settings = Depends(get_settings)) -> JSONResponse:
    return _result(lambda: factory.build_video_source(settings).check())
