"""Central configuration: texts, voice, timing, palette and output paths."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"
MODELS = ROOT / "models"
BUILD = ROOT / "build"
OUTPUT = ROOT / "output"

# ---------------------------------------------------------------- video
W, H = 1080, 1920
FPS = 30
TARGET_DURATION = 33.0  # seconds (closing card absorbs the slack, clamped 30..35)

# ---------------------------------------------------------------- voice
VOICE_DIR = MODELS / "vits-piper-ar_JO-kareem-medium"
VOICE_MODEL = VOICE_DIR / "ar_JO-kareem-medium.onnx"
VOICE_SPEED = 0.86          # < 1 = slower, contemplative delivery
VOICE_PITCH = 0.935         # rubberband pitch factor (~ -1.2 semitone, formants preserved)
SAMPLE_RATE = 48000

# Spoken text, verbatim from the brief. Each chunk is synthesized on its own so
# that every caption line starts exactly when its words are spoken.
# "kind": intro | hikma | link  (controls how much the music ducks)
VOICE_CHUNKS = [
    {"id": "intro_a", "group": "intro", "kind": "intro",
     "text": "مِنْ أَقْوَالِ أَمِيرِ الْمُؤْمِنِينَ،"},
    {"id": "intro_b", "group": "intro", "kind": "intro",
     "text": "الْإِمَامِ عَلِيٍّ عَلَيْهِ السَّلَامُ..."},
    {"id": "h1_a", "group": "h1", "kind": "hikma",
     "text": "ضَرُورَاتُ الْأَحْوَالِ"},
    {"id": "h1_b", "group": "h1", "kind": "hikma",
     "text": "تُذِلُّ رِقَابَ الرِّجَالِ."},
    {"id": "link", "group": "link", "kind": "link",
     "text": "وَقَالَ أَيْضًا عَلَيْهِ السَّلَامُ..."},
    {"id": "h2_a", "group": "h2", "kind": "hikma",
     "text": "أَصْدَقُ الْمَقَالِ"},
    {"id": "h2_b", "group": "h2", "kind": "hikma",
     "text": "مَا نَطَقَ بِهِ لِسَانُ الْحَالِ."},
]

# Full narration as given in the brief (used for the ASR verification report).
NARRATION = (
    "مِنْ أَقْوَالِ أَمِيرِ الْمُؤْمِنِينَ، الْإِمَامِ عَلِيٍّ عَلَيْهِ السَّلَامُ... "
    "ضَرُورَاتُ الْأَحْوَالِ تُذِلُّ رِقَابَ الرِّجَالِ. "
    "وَقَالَ أَيْضًا عَلَيْهِ السَّلَامُ... "
    "أَصْدَقُ الْمَقَالِ مَا نَطَقَ بِهِ لِسَانُ الْحَالِ."
)

# Timeline rules (seconds). Scene cuts are derived from the voice so that the
# pictures always follow the narration.
T_INTRO_START = 1.7         # first words after the light has crept in
GAP_INTRO = 0.32            # between intro_a and intro_b
HOLD_AFTER_INTRO = 1.05     # intro end -> centre of transition 1
LEAD_H1 = 1.15              # transition 1 centre -> hikma 1
GAP_H1 = 0.42               # natural breath inside hikma 1
HOLD_AFTER_H1 = 1.75        # contemplation before transition 2
LEAD_LINK = 0.55            # transition 2 centre -> "وقال أيضًا"
GAP_LINK = 0.62             # link -> hikma 2
GAP_H2 = 0.40               # breath inside hikma 2
HOLD_AFTER_H2 = 1.95        # contemplation before transition 3
CLOSING_MIN = 5.2           # minimum closing-card length

# ---------------------------------------------------------------- captions
# Each caption line is tied to a voice chunk. "gold" lists the words drawn in gold.
# Lines of the same block stack (max two lines on screen).
CAPTIONS = [
    {"block": "intro", "chunk": "intro_a", "size": 66, "weight": "Medium",
     "text": "من أقوال أمير المؤمنين،", "gold": ["أمير", "المؤمنين،"]},
    {"block": "intro", "chunk": "intro_b", "size": 84, "weight": "Bold",
     "text": "الإمام علي عليه السلام", "gold": ["الإمام", "علي"]},
    {"block": "h1", "chunk": "h1_a", "size": 92, "weight": "Bold",
     "text": "ضَرُورَاتُ الْأَحْوَالِ", "gold": ["ضَرُورَاتُ", "الْأَحْوَالِ"]},
    {"block": "h1", "chunk": "h1_b", "size": 92, "weight": "Bold",
     "text": "تُذِلُّ رِقَابَ الرِّجَالِ", "gold": []},
    {"block": "link", "chunk": "link", "size": 62, "weight": "Medium",
     "text": "وقال أيضًا عليه السلام", "gold": []},
    {"block": "h2", "chunk": "h2_a", "size": 92, "weight": "Bold",
     "text": "أَصْدَقُ الْمَقَالِ", "gold": ["أَصْدَقُ"]},
    {"block": "h2", "chunk": "h2_b", "size": 92, "weight": "Bold",
     "text": "مَا نَطَقَ بِهِ لِسَانُ الْحَالِ", "gold": ["لِسَانُ", "الْحَالِ"]},
]
CLOSING_LINES = [
    {"text": "حِكَمٌ تلامسُ القلوبَ", "size": 80, "gold": ["القلوبَ"]},
    {"text": "وتوقظُ العقولَ", "size": 80, "gold": ["العقولَ"]},
]

CAPTION_CENTER_Y = 1268     # centre of the two-line caption block (scenes 1-3)
CAPTION_LINE_GAP = 158      # baseline distance between the two lines
CAPTION_MAX_W = 800         # keeps clear of the right-hand action buttons
CLOSING_CENTER_Y = 1000

# ---------------------------------------------------------------- palette (sRGB 0..1)
IVORY = (0.965, 0.925, 0.835)
GOLD = (0.902, 0.722, 0.400)
GOLD_LIGHT = (1.0, 0.86, 0.58)
DEEP_GREEN = (0.020, 0.090, 0.070)
