"""Phase 8 pacing (deterministic baseline): how long each selected B-roll clip stays on screen.

Not temporal localization: durations come from the narration estimate only; no timestamps inside
source videos are searched. Steps per beat:

    words → narration_seconds (words / wpm + sentence pauses)
          → shot count (target shot length × intent, clamped to min/max shot and max shots)
          → selected clips = top-ranked candidates, one per shot
          → allocate narration_seconds across them (equal split, clamped to each clip's real length;
            any shortfall moves to clips that have footage to spare)
"""

import math
import re
from typing import Literal

from pydantic import BaseModel

from app.services.editorial import EditorialIntent

TARGET_SHOT_SECONDS = 3.5  # medium energy; low/high energy arrive with Phase 7 vibe
INTENT_MULTIPLIER = {EditorialIntent.PROCESS: 1.2, EditorialIntent.EVIDENCE: 1.2, EditorialIntent.TRANSITION: 0.8}
SENTENCE_PAUSE_SECONDS = 0.3
EPSILON = 0.05  # seconds; rounding tolerance

ClipStatus = Literal["ok", "clip_shorter", "unknown_duration"]


class ClipPacing(BaseModel):
    """One selected clip and how long it is displayed for this beat."""

    beat_id: str
    asset_key: str  # stable clip id, e.g. "pixabay:10447"
    source_type: str  # local | cloud
    provider: str
    clip_duration: float | None  # real source length; None if missing/invalid
    display_seconds: float
    status: ClipStatus  # clip_shorter: capped at the clip's real length


class ClipRef(BaseModel):
    beat_id: str
    asset_key: str
    source_type: str
    provider: str
    duration: float | None


class BeatPacing(BaseModel):
    narration_seconds: float
    basis: str = "words_per_minute"
    shot_durations: list[float]  # planned slots (kept for compatibility)
    clips: list[ClipPacing] = []  # per selected clip display durations
    visual_seconds: float = 0.0  # sum of clip display durations (≈ narration_seconds)
    warnings: list[str] = []


def _valid_duration(value) -> float | None:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) and value > 0 else None


def narration_seconds(text: str, words_per_minute: float) -> float:
    words = len(re.findall(r"\w+", text))
    if words == 0:
        return 0.0
    sentences = max(1, len(re.findall(r"[.!?]+", text)))
    return words / max(words_per_minute, 1.0) * 60 + SENTENCE_PAUSE_SECONDS * sentences


def plan_shots(narration: float, intent: EditorialIntent | None, min_shot: float, max_shot: float, max_shots: int) -> list[float]:
    """Equal-length shot slots summing to the narration (one min_shot slot for very short beats)."""
    if narration < min_shot:
        return [min_shot]
    target = TARGET_SHOT_SECONDS * INTENT_MULTIPLIER.get(intent, 1.0)
    n = min(max(round(narration / target), 1), max_shots)
    while narration / n > max_shot and n < max_shots:
        n += 1
    while narration / n < min_shot and n > 1:
        n -= 1
    each = round(narration / n, 1)
    return [each] * (n - 1) + [round(narration - each * (n - 1), 1)]


def allocate(total: float, clips: list[ClipRef], min_shot: float) -> tuple[list[ClipPacing], list[str]]:
    """Split `total` seconds across clips: equal shares, capped at each clip's real length, with the
    shortfall redistributed to clips that have footage left. Deterministic; never zero/negative."""
    warnings: list[str] = []
    if not clips:
        return [], ["no clips selected for this beat"]
    lengths = [_valid_duration(c.duration) for c in clips]
    alloc = [0.0] * len(clips)
    open_idx = list(range(len(clips)))
    remaining = total
    while remaining > EPSILON and open_idx:
        share = remaining / len(open_idx)
        still_open = []
        for i in open_idx:
            room = math.inf if lengths[i] is None else lengths[i] - alloc[i]
            add = min(share, room)
            alloc[i] += add
            remaining -= add
            if room - add > EPSILON:
                still_open.append(i)
        if still_open == open_idx:
            break  # everyone took a full share
        open_idx = still_open
    result = []
    for i, c in enumerate(clips):
        seconds = round(max(alloc[i], 0.1), 1)
        if lengths[i] is None:
            status: ClipStatus = "unknown_duration"
        elif lengths[i] < max(total / len(clips), min_shot) - EPSILON:
            status = "clip_shorter"
        else:
            status = "ok"
        result.append(ClipPacing(beat_id=c.beat_id, asset_key=c.asset_key, source_type=c.source_type,
                                 provider=c.provider, clip_duration=lengths[i], display_seconds=seconds, status=status))
    # Rounding remainder goes to the last clip that still has footage to spare.
    # (Only when the clips covered the whole total; a real shortfall is reported below, not hidden.)
    fully_covered = abs(total - sum(alloc)) <= EPSILON
    diff = round(round(sum(alloc), 1) - sum(r.display_seconds for r in result), 1) if fully_covered else 0.0
    for r, length in zip(reversed(result), reversed(lengths)):
        if diff and r.status != "clip_shorter" and (length is None or r.display_seconds + diff <= length) and r.display_seconds + diff > 0:
            r.display_seconds = round(r.display_seconds + diff, 1)
            break
    shown = sum(r.display_seconds for r in result)
    if shown < total - 0.2:
        warnings.append(f"selected clips cover {shown:.1f}s of {total:.1f}s narration (clips too short)")
    if any(r.status == "unknown_duration" for r in result):
        warnings.append("some clips have no valid duration; their display time is not checked")
    return result, warnings


def estimate_pacing(text: str, intent: EditorialIntent | None, words_per_minute: float, min_shot: float,
                    max_shot: float, max_shots: int, candidates: list[ClipRef] | None = None) -> BeatPacing:
    narration = narration_seconds(text, words_per_minute)
    warnings = []
    if narration == 0:
        warnings.append("empty beat: no narration to cover")
        return BeatPacing(narration_seconds=0.0, shot_durations=[], warnings=warnings)
    if narration < min_shot:
        warnings.append("beat shorter than the minimum shot length")
    slots = plan_shots(narration, intent, min_shot, max_shot, max_shots)
    # One clip per planned shot, in ranked order; the visual total follows the slots (≥ min_shot).
    selected = (candidates or [])[: len(slots)]
    clips, clip_warnings = allocate(sum(slots), selected, min_shot)
    return BeatPacing(
        narration_seconds=round(narration, 1),
        shot_durations=slots,
        clips=clips,
        visual_seconds=round(sum(c.display_seconds for c in clips), 1),
        warnings=warnings + clip_warnings,
    )
