"""Step 4 - subtitles.srt mirroring exactly what the video shows for the spoken
lines: each cue starts with its words, and the second line of a saying is
added under the first (never more than two lines)."""
import json

import config as C

RLM = "‏"  # keeps punctuation on the correct side in RTL-naive players


def ts(t):
    ms = int(round(max(t, 0) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def cues_from(captions):
    spoken = [c for c in captions if c["block"] != "closing"]
    blocks = {}
    for c in spoken:
        blocks.setdefault(c["block"], []).append(c)
    cues = []
    for lines in blocks.values():
        for i, c in enumerate(lines):
            start = c["t_in"]
            end = lines[i + 1]["t_in"] if i + 1 < len(lines) else c["t_out"] + 0.30
            text = [l["text"] for l in lines[max(0, i - 1): i + 1]] if i else [c["text"]]
            cues.append({"start": start, "end": end, "lines": text})
    cues.sort(key=lambda q: q["start"])
    for a, b in zip(cues, cues[1:]):          # no overlaps
        a["end"] = min(a["end"], b["start"] - 0.001)
    return cues


def main():
    captions = json.loads((C.BUILD / "captions.json").read_text("utf-8"))
    cues = cues_from(captions)
    out = []
    for k, q in enumerate(cues, 1):
        out += [str(k), f"{ts(q['start'])} --> {ts(q['end'])}"] + [RLM + l for l in q["lines"]] + [""]
    (C.OUTPUT / "subtitles.srt").write_text("\n".join(out), "utf-8")
    print(f"[srt] {len(cues)} cues -> output/subtitles.srt")


if __name__ == "__main__":
    main()
