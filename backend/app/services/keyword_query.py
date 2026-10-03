"""Deterministic keyword queries for keyword/tag-based cloud providers (e.g. Pixabay).

CLIP queries are captions ("healthcare costs, family reviewing bills at a kitchen table"); keyword
catalogues match tags and cap query length (Pixabay: 100 chars), so long captions return nothing.
"""

import re

STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "with", "by", "from", "into",
    "onto", "over", "under", "is", "are", "was", "were", "be", "being", "its", "their", "his", "her",
    "this", "that", "these", "those", "as", "while", "through", "near", "about", "up", "down", "out",
    "some", "many", "few", "very", "other", "each", "who", "which", "next", "than", "then",
}
SHOT_WORDS = {"shot", "close", "closeup", "wide", "aerial", "view", "footage", "scene", "showing", "image", "video"}


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z][a-z0-9-]*", text.lower())


def build_keyword_query(topic: str, shot: str, max_words: int = 4, max_chars: int = 100) -> str:
    """Topic words first (they anchor the subject), then shot words; stopwords/shot jargon dropped."""
    words: list[str] = []
    for w in _tokens(topic) + _tokens(shot):
        if w in STOPWORDS or w in SHOT_WORDS or len(w) < 3 or w in words:
            continue
        words.append(w)
        if len(words) == max_words:
            break
    return " ".join(words)[:max_chars].strip()


def keyword_fallbacks(topic: str, shot: str, max_chars: int = 100) -> list[str]:
    """4 words -> 2 words -> topic only; used in order until one returns hits. Deduplicated."""
    attempts = [build_keyword_query(topic, shot, 4, max_chars), build_keyword_query(topic, shot, 2, max_chars),
                build_keyword_query(topic, "", 2, max_chars)]
    return [q for q in dict.fromkeys(attempts) if q]
