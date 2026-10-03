"""The controlled vibe vocabulary (single source of truth) and the validated tag model.

Each tag is defined by what it LOOKS like (positive descriptions) and what visibly CONTRADICTS it
(negative descriptions). The scorer uses the contrast between the two in CLIP space, so "tense"
actively prefers worried faces / danger / dark drama and actively penalises happy smiling scenes.
Keywords match provider tags (metadata) for clips without a visual vector (cloud results).

To add a tag: add one VibeTagDef here. Prompt, LLM schema, validation and scoring all derive from it.
"""

from dataclasses import dataclass

from pydantic import BaseModel, field_validator


@dataclass(frozen=True)
class VibeTagDef:
    positive: tuple[str, ...]  # what footage with this feel looks like
    negative: tuple[str, ...] = ()  # what visibly contradicts it (empty -> compared with generic footage)
    keywords: tuple[str, ...] = ()  # provider-tag words that suggest the feel


VIBE_VOCABULARY: dict[str, dict[str, VibeTagDef]] = {
    "mood": {
        "serious": VibeTagDef(
            ("a serious focused person at work", "a sober formal documentary scene", "a person with a serious expression"),
            ("a person laughing", "a silly playful cartoon", "people partying"),
            ("serious", "business", "work"),
        ),
        "dramatic": VibeTagDef(
            ("a dramatic intense scene with strong contrast", "storm clouds and dramatic light", "a dramatic emotional moment"),
            ("a calm ordinary everyday scene", "a plain evenly lit room", "a cute cheerful cartoon"),
            ("dramatic", "storm", "fire", "lightning"),
        ),
        "hopeful": VibeTagDef(
            ("a hopeful sunrise", "a person looking optimistic about the future", "light breaking through clouds"),
            ("a dark depressing scene", "a worried sad person", "a destroyed ruined place"),
            ("hope", "sunrise", "future", "dawn"),
        ),
        "tense": VibeTagDef(
            ("a worried anxious person", "a tense confrontation between people", "a dangerous risky situation",
             "an urgent emergency", "a dark suspenseful scene"),
            ("a person smiling happily", "a relaxed cheerful scene", "a calm peaceful landscape", "people laughing together"),
            ("tense", "stress", "crisis", "danger", "emergency", "fear", "anxiety"),
        ),
        "calm": VibeTagDef(
            ("a calm peaceful scene", "still water and soft light", "a quiet relaxing moment"),
            ("a chaotic busy crowd", "a tense emergency", "fast moving traffic"),
            ("calm", "peaceful", "relax", "quiet"),
        ),
        "nostalgic": VibeTagDef(
            ("an old vintage film scene", "faded old photographs", "a retro scene from the past"),
            ("a modern futuristic city", "a sleek new technology product", "a computer generated graphic"),
            ("vintage", "retro", "old", "nostalgia"),
        ),
        "playful": VibeTagDef(
            ("children playing and laughing", "a fun colorful cartoon", "people having fun"),
            ("a serious business meeting", "a grim dark scene", "a worried person"),
            ("fun", "play", "children", "toy"),
        ),
        "uplifting": VibeTagDef(
            ("people celebrating success", "a joyful smiling person", "a bright beautiful landscape"),
            ("a sad worried person", "a gloomy dark scene", "a disaster"),
            ("joy", "success", "celebration", "happy"),
        ),
    },
    "energy": {
        "slow": VibeTagDef(
            ("a slow still quiet shot", "a static calm landscape"),
            ("fast moving traffic", "a busy energetic crowd", "people running"),
            ("slow", "still", "static"),
        ),
        "moderate": VibeTagDef(("an ordinary everyday scene with some movement",)),
        "energetic": VibeTagDef(
            ("a fast moving energetic scene", "people running and exercising", "busy traffic at speed"),
            ("a still quiet calm scene", "a slow peaceful landscape"),
            ("busy", "crowd", "traffic", "sport", "fast", "speed"),
        ),
    },
    "visual_style": {
        "cinematic": VibeTagDef(
            ("a cinematic film shot with shallow depth of field", "a beautiful cinematic wide shot"),
            ("a plain screenshot of a computer screen", "a simple flat animation"),
            ("cinematic", "film"),
        ),
        "documentary": VibeTagDef(
            ("a realistic documentary shot of real people", "real life footage"),
            ("a cartoon animation", "an abstract computer graphic"),
            ("documentary", "people", "work"),
        ),
        "minimal": VibeTagDef(
            ("a minimal clean simple composition", "a plain uncluttered background"),
            ("a cluttered busy scene", "a crowded street"),
            ("minimal", "clean", "background"),
        ),
        "atmospheric": VibeTagDef(
            ("fog, haze and mist", "atmospheric moody light"),
            ("a flat brightly lit office", "a plain white background"),
            ("fog", "mist", "atmosphere", "haze"),
        ),
    },
    "atmosphere": {
        "bright": VibeTagDef(
            ("a bright well lit scene in daylight", "a sunny day"),
            ("a dark scene at night", "a dim low light room"),
            ("bright", "day", "sunny", "sun"),
        ),
        "dark": VibeTagDef(
            ("a dark low light scene at night", "deep shadows and darkness"),
            ("a bright sunny day", "a brightly lit white room"),
            ("dark", "night", "shadow"),
        ),
        "warm": VibeTagDef(
            ("warm golden light", "a sunset glow"),
            ("cold blue light", "a snowy winter scene"),
            ("warm", "sunset", "golden"),
        ),
        "cool": VibeTagDef(
            ("cool blue tones", "a cold winter scene"),
            ("warm golden sunset light", "a hot sunny beach"),
            ("blue", "cold", "winter", "ice"),
        ),
        "natural": VibeTagDef(
            ("natural outdoor light in nature", "a landscape in daylight"),
            ("an indoor office under artificial light", "a computer generated graphic"),
            ("nature", "outdoor", "landscape"),
        ),
    },
}
MAX_TAGS_PER_CATEGORY = 2


def vocabulary() -> dict[str, list[str]]:
    """Allowed tags per category (for the API / frontend)."""
    return {category: list(tags) for category, tags in VIBE_VOCABULARY.items()}


def vibe_json_schema() -> dict:
    """JSON-schema fragment: one enum-constrained array per category."""
    return {
        "type": "object",
        "properties": {
            category: {"type": "array", "items": {"type": "string", "enum": list(tags)}}
            for category, tags in VIBE_VOCABULARY.items()
        },
        "required": list(VIBE_VOCABULARY),
    }


def vocabulary_prompt() -> str:
    return "\n".join(f"- {category}: {', '.join(tags)}" for category, tags in VIBE_VOCABULARY.items())


class VibeTags(BaseModel):
    """Tags per category; anything outside the vocabulary is removed, never accepted."""

    mood: list[str] = []
    energy: list[str] = []
    visual_style: list[str] = []
    atmosphere: list[str] = []

    @field_validator("mood", "energy", "visual_style", "atmosphere", mode="before")
    @classmethod
    def _clean(cls, values, info):
        if values is None:
            return []
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, list):
            raise ValueError("tags must be a list of strings")
        allowed = VIBE_VOCABULARY[info.field_name]
        cleaned = []
        for value in values:
            if isinstance(value, str):
                tag = value.strip().lower().replace(" ", "_").replace("-", "_")
                if tag in allowed and tag not in cleaned:
                    cleaned.append(tag)
        return cleaned[:MAX_TAGS_PER_CATEGORY]

    def flat(self) -> list[tuple[str, str]]:
        return [(c, t) for c in VIBE_VOCABULARY for t in getattr(self, c)]

    def is_empty(self) -> bool:
        return not self.flat()
