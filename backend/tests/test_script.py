"""Phase 4: sentence splitting, LLM segmentation validation, and per-beat orchestration (LLM mocked)."""

import json
import os

import pytest

from app.config import get_settings
from app.providers import factory
from app.providers.errors import ProviderError
from app.providers.llm.base import LLMProvider
from app.services.editorial import LLM_RESPONSE_SCHEMA, EditorialIntentAnalyzer
from app.services.retrieval import SearchHit, SearchOutcome
from app.services.script import (
    MAX_SCRIPT_CHARS,
    MAX_SENTENCES,
    SEGMENTATION_SCHEMA,
    ScriptAnalysisService,
    ScriptSegmenter,
    ScriptTooLongError,
    SegmentationError,
    parse_segmentation,
    split_sentences,
)
from tests.test_search_api import video

EV_SCRIPT = (
    "Electric vehicles are becoming increasingly popular.\n"
    "However, charging infrastructure remains a major challenge.\n"
    "This could slow adoption in smaller cities."
)


def analysis_for(text: str) -> dict:
    """A valid editorial reply whose description is derived from the beat text."""
    return {
        "topic": "electric vehicles",
        "editorial_intent": "problem" if "challenge" in text else "context",
        "visual_role": "show the subject",
        "visual_description": f"shot of {text.split()[0].lower()} scene",
    }


class ScriptedLLM(LLMProvider):
    """Answers segmentation prompts with `segmentation`, editorial prompts with `editorial(beat_text)`."""

    name = "scripted"
    model = "scripted-llm"

    def __init__(self, segmentation=None, editorial=None, segmentation_error=None):
        self.segmentation = segmentation if segmentation is not None else {"beats": [{"sentences": [1]}, {"sentences": [2]}, {"sentences": [3]}]}
        self.editorial = editorial or (lambda text: json.dumps(analysis_for(text)))
        self.segmentation_error = segmentation_error
        self.calls = []

    def generate(self, prompt, json_schema=None):
        self.calls.append(json_schema)
        if json_schema is SEGMENTATION_SCHEMA:
            if self.segmentation_error:
                raise self.segmentation_error
            return self.segmentation if isinstance(self.segmentation, str) else json.dumps(self.segmentation)
        from app.services.editorial import LLM_RESPONSE_SCHEMA_WITH_VIBE
        from app.services.vibe import VIBE_SCHEMA

        if json_schema is VIBE_SCHEMA:  # stand-alone vibe suggestion: no tags, so candidate order is unchanged
            return "{}"
        # The script pipeline may ask for vibe tags in the editorial call; these replies have none.
        assert json_schema is LLM_RESPONSE_SCHEMA or json_schema is LLM_RESPONSE_SCHEMA_WITH_VIBE
        text = prompt.rsplit("<<<\n", 1)[1].rsplit("\n>>>", 1)[0]  # the beat text inside the editorial prompt
        reply = self.editorial(text)
        if isinstance(reply, Exception):
            raise reply
        return reply

    def check(self):
        return {}


class FakeSearch:
    """Stands in for SemanticSearchService: records queries, returns one hit per query."""

    def __init__(self, fail_on=None):
        self.embedder = type("E", (), {"model_name": "fake-clip"})()
        self.queries = []
        self.fail_on = fail_on

    def search(self, session, query, top_k):
        self.queries.append((query, top_k))
        if self.fail_on and self.fail_on in query:
            raise ProviderError("CLIP embedding failed")
        return SearchOutcome([SearchHit(video(len(self.queries)), 0.3)][:top_k])


def service(llm=None, search=None):
    llm = llm or ScriptedLLM()
    return ScriptAnalysisService(ScriptSegmenter(llm), EditorialIntentAnalyzer(llm), search or FakeSearch())


# --- sentence splitting ------------------------------------------------------------------


def test_split_sentences_normalises_line_breaks_inside_sentences():
    script = "Healthcare costs continue to rise.\nFor many families, a visit can create financial\npressure.\nThis matters."
    assert split_sentences(script) == [
        "Healthcare costs continue to rise.",
        "For many families, a visit can create financial pressure.",
        "This matters.",
    ]


def test_split_sentences_handles_quotes_decimals_abbreviations_and_paragraphs():
    script = 'He said "It works." Then he left! Did it cost $3.5 million? Dr. Smith agreed.\n\nA heading\n\nLast line'
    assert split_sentences(script) == [
        'He said "It works."', "Then he left!", "Did it cost $3.5 million?", "Dr. Smith agreed.", "A heading", "Last line",
    ]


def test_split_sentences_empty():
    assert split_sentences("  \n\n ") == []


# --- segmentation validation ---------------------------------------------------------------


def test_valid_segmentation_groups_consecutive_sentences():
    assert parse_segmentation('{"beats": [{"sentences": [1, 2]}, {"sentences": [3]}]}', 3) == [[1, 2], [3]]


def test_segmentation_in_code_fence_and_extra_fields():
    raw = '```json\n{"beats": [{"sentences": [1], "order": 1}, {"sentences": [2], "why": "x"}]}\n```'
    assert parse_segmentation(raw, 2) == [[1], [2]]


@pytest.mark.parametrize("raw", ["", "beats: 1, 2", '{"beats": [', "[1, 2]"])
def test_malformed_segmentation_is_rejected(raw):
    with pytest.raises(SegmentationError, match="malformed JSON|not an object"):
        parse_segmentation(raw, 2)


@pytest.mark.parametrize(
    "data",
    [
        {},  # missing beats
        {"beats": []},  # no beats
        {"beats": [{"sentences": []}, {"sentences": [1, 2]}]},  # empty beat
        {"beats": [{"sentences": ["one"]}]},  # wrong type
        {"beats": [{"text": "free text instead of numbers"}]},
    ],
)
def test_structurally_invalid_segmentation_is_rejected(data):
    with pytest.raises(SegmentationError, match="invalid segmentation"):
        parse_segmentation(json.dumps(data), 2)


@pytest.mark.parametrize(
    "groups",
    [
        [[1], [3]],  # sentence 2 dropped
        [[1, 2], [2, 3]],  # overlapping / duplicated sentence
        [[2], [1], [3]],  # out of order
        [[1, 3], [2]],  # non-consecutive grouping
        [[1], [2], [3], [4]],  # sentence that does not exist
        [[0], [1, 2]],
    ],
)
def test_segmentation_must_cover_every_sentence_once_in_order(groups):
    raw = json.dumps({"beats": [{"sentences": g} for g in groups]})
    with pytest.raises(SegmentationError, match="cover sentences 1-3 once each, in order"):
        parse_segmentation(raw, 3)


def test_segmenter_rebuilds_beat_text_from_the_script():
    llm = ScriptedLLM(segmentation={"beats": [{"sentences": [1]}, {"sentences": [2, 3]}]})
    beats = ScriptSegmenter(llm).segment(EV_SCRIPT)
    assert beats == [
        "Electric vehicles are becoming increasingly popular.",
        "However, charging infrastructure remains a major challenge. This could slow adoption in smaller cities.",
    ]


def test_single_sentence_script_skips_the_llm():
    llm = ScriptedLLM()
    assert ScriptSegmenter(llm).segment("The company announced a product, which launches next month.") == [
        "The company announced a product, which launches next month."
    ]
    assert llm.calls == []


def test_segmentation_prompt_numbers_the_sentences():
    prompts = []

    class Recorder(ScriptedLLM):
        def generate(self, prompt, json_schema=None):
            prompts.append(prompt)
            return super().generate(prompt, json_schema)

    ScriptSegmenter(Recorder()).segment(EV_SCRIPT)
    assert "1. Electric vehicles are becoming increasingly popular.\n2. However," in prompts[0]


def test_oversized_scripts_are_rejected_before_calling_the_llm():
    llm = ScriptedLLM()
    with pytest.raises(ScriptTooLongError, match="characters"):
        ScriptSegmenter(llm).segment("a" * (MAX_SCRIPT_CHARS + 1))
    with pytest.raises(ScriptTooLongError, match="sentences"):
        ScriptSegmenter(llm).segment(" ".join(f"Sentence {i}." for i in range(MAX_SENTENCES + 1)))
    assert llm.calls == []


# --- orchestration ---------------------------------------------------------------------------


def test_every_beat_gets_editorial_analysis_query_and_broll():
    search = FakeSearch()
    result = service(search=search).analyze(None, EV_SCRIPT, top_k=4)

    assert [b.beat_id for b in result.beats] == ["beat-1", "beat-2", "beat-3"]
    assert [b.order for b in result.beats] == [1, 2, 3]
    assert all(b.error is None and b.editorial and b.hits for b in result.beats)
    assert result.beats[1].editorial.editorial_intent == "problem"
    # The existing deterministic query builder is used (topic prepended when the description lacks it).
    assert result.beats[0].editorial.retrieval_query == "electric vehicles, shot of electric scene"
    assert search.queries == [(b.editorial.retrieval_query, 4) for b in result.beats]
    assert set(result.timings_ms) == {"segmentation", "analysis", "retrieval", "vibe", "beats", "total"}
    assert result.segmentation.method == "llm"


def test_one_llm_client_serves_segmentation_and_all_beats():
    llm = ScriptedLLM()
    service(llm=llm).analyze(None, EV_SCRIPT, top_k=2)
    assert llm.calls == [SEGMENTATION_SCHEMA] + [LLM_RESPONSE_SCHEMA] * 3


def test_invalid_editorial_reply_fails_only_that_beat():
    def editorial(text):
        return '{"topic": "x"}' if "However" in text else json.dumps(analysis_for(text))

    search = FakeSearch()
    beats = service(llm=ScriptedLLM(editorial=editorial), search=search).analyze(None, EV_SCRIPT, 3).beats

    assert [b.error is None for b in beats] == [True, False, True]
    failed = beats[1]
    assert "invalid editorial analysis" in failed.error
    assert failed.editorial is None and failed.hits == []
    assert failed.text.startswith("However")  # the failed beat is still returned, with its text
    assert len(search.queries) == 2  # no search for the beat without a query


def test_llm_failure_on_one_beat_is_reported_on_that_beat():
    def editorial(text):
        return ProviderError("Ollama request timed out") if "smaller cities" in text else json.dumps(analysis_for(text))

    beats = service(llm=ScriptedLLM(editorial=editorial)).analyze(None, EV_SCRIPT, 3).beats
    assert [b.error for b in beats] == [None, None, "Ollama request timed out"]


def test_search_failure_keeps_the_analysis_and_reports_the_error():
    beats = service(search=FakeSearch(fail_on="shot of however")).analyze(None, EV_SCRIPT, 3).beats
    assert beats[1].error == "CLIP embedding failed"
    assert beats[1].editorial is not None and beats[1].hits == []
    assert beats[0].error is None and beats[2].error is None


def test_invalid_segmentation_falls_back_to_one_beat_per_sentence():
    result = service(llm=ScriptedLLM(segmentation="not json")).analyze(None, EV_SCRIPT, 3)
    assert (result.segmentation.method, result.segmentation.error) == ("sentence_fallback", "The language model returned malformed JSON")
    assert [b.text for b in result.beats] == split_sentences(EV_SCRIPT)
    assert all(b.error is None for b in result.beats)  # the beats themselves are still analysed


def test_strict_segment_still_raises_on_invalid_output():
    with pytest.raises(SegmentationError):
        ScriptSegmenter(ScriptedLLM(segmentation="not json")).segment(EV_SCRIPT)


def test_unreachable_llm_fails_the_whole_analysis():
    with pytest.raises(ProviderError, match="not reachable"):
        service(llm=ScriptedLLM(segmentation_error=ProviderError("Ollama is not reachable"))).analyze(None, EV_SCRIPT, 3)


# --- live LLM (opt-in) -------------------------------------------------------------------


@pytest.mark.skipif(not os.environ.get("RUN_LLM_TESTS"), reason="set RUN_LLM_TESTS=1 (calls the configured LLM)")
def test_live_segmentation():
    beats = ScriptSegmenter(factory.build_llm_provider(get_settings())).segment(EV_SCRIPT)
    assert 2 <= len(beats) <= 3
    assert " ".join(beats) == " ".join(split_sentences(EV_SCRIPT))
