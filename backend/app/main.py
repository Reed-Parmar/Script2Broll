import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api import editorial, export, health, remote, script, search
from app.config import get_settings
from app.providers.errors import ProviderError, ProviderNotConfigured

log = logging.getLogger(__name__)
# httpx logs full request URLs at INFO, and Pixabay puts the API key in the query string.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


async def _provider_error(_: Request, exc: ProviderError) -> JSONResponse:
    # ProviderError messages are written to be safe for clients (no keys, no raw upstream text).
    status = 503 if isinstance(exc, ProviderNotConfigured) else 502
    return JSONResponse({"detail": str(exc)}, status_code=status)


async def _database_error(_: Request, exc: SQLAlchemyError) -> JSONResponse:
    # Driver messages can contain the connection string; log the class, return a generic message.
    log.error("Database error: %s", type(exc).__name__)
    return JSONResponse({"detail": "Database unavailable"}, status_code=503)


@asynccontextmanager
async def _lifespan(_: FastAPI):
    # Warm the CLIP model and the cached prompt vectors (hubness bank, vibe tag directions) once at
    # startup, so the first request does not pay for them (and concurrent beats don't race to build them).
    try:
        from app.api.search import get_search_service
        from app.services.vibe import VibeScorer

        service = get_search_service(get_settings())
        service.query_vector("warm up")
        VibeScorer(service.embedder)._tag_directions()
    except Exception as exc:  # noqa: BLE001 - warm-up is best effort; requests report real errors
        log.warning("Warm-up skipped: %s", type(exc).__name__)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Script2Broll API", version="0.1.0", lifespan=_lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.add_exception_handler(ProviderError, _provider_error)
    app.add_exception_handler(SQLAlchemyError, _database_error)
    app.include_router(health.router)
    app.include_router(search.router)
    app.include_router(editorial.router)
    app.include_router(script.router)
    app.include_router(remote.router)
    app.include_router(export.router)
    return app


app = create_app()
