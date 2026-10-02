import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api import health, search
from app.config import get_settings
from app.providers.errors import ProviderError, ProviderNotConfigured

log = logging.getLogger(__name__)


async def _provider_error(_: Request, exc: ProviderError) -> JSONResponse:
    # ProviderError messages are written to be safe for clients (no keys, no raw upstream text).
    status = 503 if isinstance(exc, ProviderNotConfigured) else 502
    return JSONResponse({"detail": str(exc)}, status_code=status)


async def _database_error(_: Request, exc: SQLAlchemyError) -> JSONResponse:
    # Driver messages can contain the connection string; log the class, return a generic message.
    log.error("Database error: %s", type(exc).__name__)
    return JSONResponse({"detail": "Database unavailable"}, status_code=503)


def create_app() -> FastAPI:
    app = FastAPI(title="Script2Broll API", version="0.1.0")
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
    return app


app = create_app()
