"""Editorial-intent analysis of a script line, independent of search."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from app.config import Settings, get_settings
from app.providers import factory
from app.services.editorial import INTENT_GUIDE, EditorialIntentAnalyzer, EditorialIntentResult

router = APIRouter(prefix="/v1/editorial", tags=["editorial"])

MAX_TEXT_LENGTH = 500


def clean_text(value: str) -> str:
    """Collapse whitespace; reject blank input. Shared by the search and editorial requests."""
    value = " ".join(value.split())
    if not value:
        raise ValueError("text must not be empty")
    return value


def get_editorial_analyzer(settings: Settings = Depends(get_settings)) -> EditorialIntentAnalyzer:
    return EditorialIntentAnalyzer(factory.build_llm_provider(settings))


class AnalyzeRequest(BaseModel):
    text: str = Field(max_length=MAX_TEXT_LENGTH)

    @field_validator("text")
    @classmethod
    def _clean(cls, value: str) -> str:
        return clean_text(value)


@router.post("/analyze")
def analyze(
    request: AnalyzeRequest,
    analyzer: EditorialIntentAnalyzer = Depends(get_editorial_analyzer),
) -> EditorialIntentResult:
    return analyzer.analyze(request.text)


@router.get("/intents")
def intents() -> list[dict[str, str]]:
    """Allowed editorial intents (backend enum) with one-line meanings, for intent selectors."""
    return [{"value": intent.value, "description": meaning} for intent, meaning in INTENT_GUIDE.items()]
