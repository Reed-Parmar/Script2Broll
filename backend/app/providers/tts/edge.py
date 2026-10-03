"""Neural text-to-speech via edge-tts (Microsoft Edge's online read-aloud voices; no API key).

Note: the narration TEXT is sent to Microsoft's service. Intended for demo narration only.
"""

import asyncio
import time
from pathlib import Path

from app.providers.errors import ProviderError
from app.providers.tts.base import TTSProvider, VoicePreset

# The newest "Multilingual" neural voices sound the most human (natural breathing, intonation).
# No pitch shifting: altering pitch is what makes neural voices sound robotic; only a slightly
# slower pace for narration.
VOICE_PRESETS = (
    # Default: deep, warm, confident male narrator.
    VoicePreset("deep_male_narrator", "Deep male narrator (Andrew)", "en-US-AndrewMultilingualNeural", rate="-6%"),
    VoicePreset("warm_male", "Natural male (Brian)", "en-US-BrianMultilingualNeural", rate="-4%"),
    VoicePreset("documentary_male", "Documentary male (William)", "en-AU-WilliamMultilingualNeural", rate="-6%"),
    VoicePreset("british_male", "Calm male (Christopher)", "en-US-ChristopherNeural", rate="-6%"),
    VoicePreset("female_narrator", "Female narrator (Ava)", "en-US-AvaMultilingualNeural", rate="-4%"),
    VoicePreset("female_conversational", "Conversational female (Emma)", "en-US-EmmaMultilingualNeural", rate="-3%"),
)
DEFAULT_VOICE = "deep_male_narrator"


class EdgeTTSProvider(TTSProvider):
    name = "edge"

    def voices(self) -> list[VoicePreset]:
        return list(VOICE_PRESETS)

    def synthesize(self, text: str, voice_id: str, out_path: Path) -> Path:
        preset = next((v for v in VOICE_PRESETS if v.id == voice_id), None)
        if preset is None:
            raise ProviderError(f"Unknown voice '{voice_id}'")
        import edge_tts

        async def run() -> None:
            await edge_tts.Communicate(text, preset.voice, rate=preset.rate, pitch=preset.pitch).save(str(out_path))

        for attempt in range(3):  # the online service occasionally fails transiently
            try:
                asyncio.run(run())
                break
            except Exception as exc:  # network/service errors
                if attempt == 2:
                    raise ProviderError(f"Text-to-speech failed ({type(exc).__name__})") from None
                time.sleep(0.5 * (attempt + 1))
        if not out_path.is_file() or out_path.stat().st_size == 0:
            raise ProviderError("Text-to-speech returned no audio")
        return out_path
