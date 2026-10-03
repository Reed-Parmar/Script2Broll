"""Compare local LLMs on the Phase 4 script pipeline, for human review.

Runs the production ScriptSegmenter and EditorialIntentAnalyzer (with neighbour context) on a
small set of scripts, twice per model, and writes a Markdown report: beats, intents, visual
descriptions, filmable visuals and the resulting queries, plus latency and run-to-run consistency.

The "reference" column holds the author's own expectations as a reading aid. It is NOT a
labelled ground truth, so the report deliberately computes no accuracy percentage.

Usage (from backend/):
  uv run python -m scripts.benchmark_llm --models qwen2.5:3b qwen2.5:7b --out benchmark.md
Uses LLM_PROVIDER=ollama with each model in turn (no database or CLIP needed).
"""

import argparse
import statistics
import sys
import time

from app.config import get_settings
from app.providers import factory
from app.providers.errors import ProviderError
from app.services.editorial import EditorialIntentAnalyzer
from app.services.script import ScriptSegmenter, split_sentences

# (category, script, reference beats as sentence-number groups, reference intents per beat)
CASES = [
    ("context", "Every morning, millions of commuters pour into the city.", [[1]], ["context"]),
    ("introduction", "Meet the farmers who are rethinking how we grow rice.", [[1]], ["introduction"]),
    ("problem", "Despite the boom, there are not enough chargers for all these cars.", [[1]], ["problem"]),
    ("cause", "Decades of overfishing emptied the bay. That is why the fleet now sits idle in the harbour.", [[1], [2]], ["cause", "effect"]),
    ("effect", "Rising seas have flooded coastal roads. Many residents can no longer reach work.", [[1], [2]], ["effect", "human_impact"]),
    ("comparison", "Solar panels are cheap to run. Coal plants, by contrast, burn fuel every hour.", [[1], [2]], ["comparison", "comparison"]),
    ("process", "First, the beans are roasted. Next, they are ground. Finally, hot water is pushed through them.", [[1], [2], [3]], ["process", "process", "process"]),
    ("human impact", "For many families, a single hospital visit means weeks of lost income.", [[1]], ["human_impact"]),
    ("evidence", "Battery prices have fallen by nearly ninety percent in a decade.", [[1]], ["evidence"]),
    ("conclusion", "In the end, the choices we make now will shape the next century.", [[1]], ["conclusion"]),
    ("transition", "That was the economic picture. Now let's look at the people behind it.", [[1], [2]], ["conclusion", "transition"]),
    ("merge: same scene", "A thick fog covers the forest. The tall pines disappear into the grey mist. Later that day, rescue teams begin their search.", [[1, 2], [3]], ["context", "process"]),
    ("merge: same subject", "The new stadium is enormous. It seats eighty thousand fans under a glass roof. Ticket prices, however, have doubled.", [[1, 2], [3]], ["context", "problem"]),
    ("context dependency", "The company expanded rapidly across Europe. This growth created significant pressure on its operations. It later had to reduce spending.", [[1], [2], [3]], ["context", "problem", "effect"]),
    ("ambiguous", "It was not what anyone expected.", [[1]], ["transition"]),
    ("complex sentence", "Farmers harvest the wheat in the summer heat, while in the city bakers prepare bread before dawn.", [[1]], ["comparison"]),
]


def run_case(segmenter, analyzer, script):
    started = time.perf_counter()
    segmentation = segmenter.segment_with_fallback(script)
    seg_ms = (time.perf_counter() - started) * 1000
    beats, analysis_ms = [], []
    for i, text in enumerate(segmentation.beats):
        t0 = time.perf_counter()
        try:
            result = analyzer.analyze(
                text,
                previous=segmentation.beats[i - 1] if i else None,
            )
            beats.append({"text": text, "intent": result.editorial_intent.value, "description": result.visual_description,
                          "visuals": result.filmable_visuals, "queries": [result.retrieval_query, *result.alternative_queries]})
        except ProviderError as exc:
            beats.append({"text": text, "error": str(exc)})
        analysis_ms.append((time.perf_counter() - t0) * 1000)
    return {"method": segmentation.method, "beats": beats, "seg_ms": seg_ms, "analysis_ms": analysis_ms}


def groups_of(script, beat_texts):
    """Map beat texts back to sentence-number groups (texts are rebuilt from sentences, so this is exact)."""
    sentences, groups, n = split_sentences(script), [], 0
    for text in beat_texts:
        group, consumed = [], ""
        while consumed != text and n < len(sentences):
            consumed = f"{consumed} {sentences[n]}".strip()
            n += 1
            group.append(n)
        groups.append(group)
    return groups


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--models", nargs="+", default=["qwen2.5:3b"])
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--out", help="Markdown report path (default: stdout)")
    args = parser.parse_args()

    lines = ["# LLM benchmark: script segmentation and editorial analysis", "",
             "Reference beats/intents are the author's expectations, not ground truth; no accuracy is computed.", ""]
    summary = []
    for model in args.models:
        settings = get_settings().model_copy(update={"llm_provider": "ollama", "ollama_model": model})
        llm = factory.build_llm_provider(settings)
        segmenter, analyzer = ScriptSegmenter(llm), EditorialIntentAnalyzer(llm)
        runs = []
        for run in range(args.runs):
            print(f"{model}: run {run + 1}/{args.runs}", file=sys.stderr)
            runs.append([run_case(segmenter, analyzer, script) for _, script, _, _ in CASES])

        seg_ms = [r["seg_ms"] for r in runs[0] if r["method"] == "llm"]
        beat_ms = [ms for r in runs[0] for ms in r["analysis_ms"]]
        same_beats = sum(groups_of(c[1], [b["text"] for b in a["beats"]]) == groups_of(c[1], [b["text"] for b in z["beats"]])
                         for c, a, z in zip(CASES, runs[0], runs[-1]))
        same_analysis = sum(a["beats"] == z["beats"] for a, z in zip(runs[0], runs[-1]))
        beats_as_ref = sum(groups_of(c[1], [b["text"] for b in r["beats"]]) == c[2] for c, r in zip(CASES, runs[0]))
        intents_as_ref = sum(b.get("intent") == ref for c, r in zip(CASES, runs[0])
                             if groups_of(c[1], [b["text"] for b in r["beats"]]) == c[2]
                             for b, ref in zip(r["beats"], c[3]))
        fallbacks = sum(r["method"] == "sentence_fallback" for run in runs for r in run)
        errors = sum("error" in b for run in runs for r in run for b in r["beats"])
        summary.append(
            f"| {model} | {beats_as_ref}/{len(CASES)} | {intents_as_ref} | {same_beats}/{len(CASES)} | {same_analysis}/{len(CASES)} | "
            f"{fallbacks} | {errors} | {statistics.median(seg_ms):.0f} | {statistics.median(beat_ms):.0f} |"
        )

        lines += [f"## {model}", ""]
        for (category, script, ref_groups, ref_intents), result in zip(CASES, runs[0]):
            groups = groups_of(script, [b["text"] for b in result["beats"]])
            lines += [f"### {category}", f"> {script}", "",
                      f"- beats: `{groups}` (reference `{ref_groups}`, segmentation: {result['method']})"]
            for beat in result["beats"]:
                if "error" in beat:
                    lines.append(f"  - **error**: {beat['error']}")
                    continue
                lines += [f"  - **{beat['intent']}** — {beat['text']}",
                          f"    - description: {beat['description']}",
                          f"    - visuals: {beat['visuals']}",
                          f"    - queries: {beat['queries']}"]
            lines.append(f"  - reference intents: {ref_intents}")
            lines.append("")

    lines[4:4] = ["## Summary", "",
                  "| model | beats as reference | intents as reference (where beats matched) | same beats run1 vs run2 | identical analysis run1 vs run2 | segmentation fallbacks | beat errors | median segmentation ms | median per-beat analysis ms |",
                  "|---|---|---|---|---|---|---|---|---|", *summary, ""]
    report = "\n".join(lines)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
