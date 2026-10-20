#!/usr/bin/env python3
"""One-command build: voice -> music/mix -> picture -> subtitles -> mux -> verify.

    ./setup_models.sh --with-asr      # once (offline models, no API keys)
    python3 make.py                   # full build
    python3 make.py --skip-tts        # keep the current narration takes
    python3 make.py --no-music        # alternative mix: ambience + effects only
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"


def step(*args):
    print(f"\n=== {' '.join(args)}", flush=True)
    subprocess.run([sys.executable, *args], cwd=SRC, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-tts", action="store_true")
    ap.add_argument("--skip-render", action="store_true", help="reuse build/video_noaudio.mp4")
    ap.add_argument("--no-music", action="store_true")
    a = ap.parse_args()
    if not a.skip_tts:
        step("tts.py")
    step("audio.py", *(["--no-music"] if a.no_music else []))
    if not a.skip_render:
        step("render.py")
    step("subtitles.py")
    mix = ROOT / "build" / ("mix_nomusic.wav" if a.no_music else "mix.wav")
    out = ROOT / "output" / ("final_video_no_music.mp4" if a.no_music else "final_video.mp4")
    print(f"\n=== mux -> {out.name}", flush=True)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-i", str(ROOT / "build" / "video_noaudio.mp4"), "-i", str(mix),
                    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest",
                    "-metadata", "title=من أقوال أمير المؤمنين الإمام علي عليه السلام",
                    "-metadata:s:a:0", "language=ara", "-movflags", "+faststart", str(out)], check=True)
    if not a.no_music:
        step("verify.py")


if __name__ == "__main__":
    main()
