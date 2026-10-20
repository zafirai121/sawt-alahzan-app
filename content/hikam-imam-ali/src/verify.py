"""Step 6 - automated checks on the deliverables; writes output/verification_report.json
and output/preview_contact_sheet.jpg."""
import json
import re
import subprocess

import cv2
import numpy as np
import soundfile as sf

import config as C
import dsp
from tts import load_asr, similarity, transcribe

VIDEO = C.OUTPUT / "final_video.mp4"


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def probe():
    r = run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(VIDEO)])
    d = json.loads(r.stdout)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    a = next(s for s in d["streams"] if s["codec_type"] == "audio")
    num, den = map(int, v["avg_frame_rate"].split("/"))
    return {"container_duration": float(d["format"]["duration"]), "size_mb": round(int(d["format"]["size"]) / 1e6, 2),
            "video_codec": v["codec_name"], "profile": v.get("profile"), "width": v["width"], "height": v["height"],
            "fps": round(num / den, 3), "pix_fmt": v["pix_fmt"], "color_space": v.get("color_space"),
            "frames": int(v.get("nb_frames", 0)), "audio_codec": a["codec_name"],
            "audio_rate": int(a["sample_rate"]), "audio_channels": a["channels"],
            "bitrate_kbps": round(int(d["format"]["bit_rate"]) / 1000)}


def decode_errors():
    r = run(["ffmpeg", "-v", "error", "-i", str(VIDEO), "-f", "null", "-"])
    return r.stderr.strip()


def black_intervals():
    r = run(["ffmpeg", "-hide_banner", "-i", str(VIDEO), "-vf", "blackdetect=d=0.1:pix_th=0.05:pic_th=0.995",
             "-an", "-f", "null", "-"])
    out = []
    for m in re.finditer(r"black_start:([\d.]+) black_end:([\d.]+)", r.stderr):
        out.append((float(m.group(1)), float(m.group(2))))
    return out


def loudness():
    r = run(["ffmpeg", "-hide_banner", "-i", str(VIDEO), "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"])
    tail = r.stderr[r.stderr.rfind("Summary:"):]
    I = float(re.search(r"I:\s+(-?[\d.]+) LUFS", tail).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail).group(1))
    return {"integrated_lufs": I, "true_peak_dbtp": tp}


def parse_srt(path):
    blocks = path.read_text("utf-8").strip().split("\n\n")
    cues = []
    for b in blocks:
        ls = b.split("\n")
        a, z = ls[1].split(" --> ")
        f = lambda s: int(s[:2]) * 3600 + int(s[3:5]) * 60 + int(s[6:8]) + int(s[9:]) / 1000
        cues.append({"start": f(a), "end": f(z), "lines": [l.lstrip("\u200f") for l in ls[2:]]})
    return cues


def voice_onsets(tl):
    """Measured speech onset of every chunk. Measured on the dry narration
    (true silence between lines), whose alignment with the delivered, reverberant
    voiceover is checked separately by cross-correlation."""
    y, sr = sf.read(str(C.BUILD / "voice_raw.wav"), dtype="float32")
    hop = sr // 1000
    env = np.sqrt(np.convolve(y ** 2, np.ones(5 * hop) / (5 * hop), mode="same"))
    thr = env.max() * 10 ** (-40 / 20)
    res = {}
    for c in tl["chunks"]:
        a = int((c["start"] - 0.25) * sr)
        seg = env[a: int(c["end"] * sr)]
        res[c["id"]] = round((a + int(np.argmax(seg > thr))) / sr, 3)
    return res


def delivered_alignment_ms():
    from tts import align_offset
    raw, sr = sf.read(str(C.BUILD / "voice_raw.wav"), dtype="float32")
    out, _ = sf.read(str(C.OUTPUT / "voiceover.wav"), dtype="float32")
    n = min(len(raw), len(out))
    return round(align_offset(raw[:n], out[:n], sr) * 1000, 1)


def asr_check(tl):
    asr = load_asr()
    if asr is None:
        return {"skipped": "Whisper checker not installed (./setup_models.sh --with-asr)"}
    y = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", str(VIDEO), "-vn", "-ac", "1", "-ar", "16000",
                                      "-f", "f32le", "-"], capture_output=True).stdout, np.float32)
    out = {}
    groups = {}
    for c in tl["chunks"]:
        groups.setdefault(c["group"], []).append(c)
    for g, cs in groups.items():
        a, b = int((cs[0]["start"] - 0.3) * 16000), int((cs[-1]["end"] + 0.5) * 16000)
        text = " ".join(c["text"] for c in cs)
        hyp = transcribe(asr, y[a:b].copy(), 16000)
        out[g] = {"expected": text, "heard": hyp, "similarity": round(similarity(hyp, text), 3)}
    full = transcribe(asr, y[: int(min(len(y) / 16000, 29.9) * 16000)].copy(), 16000)
    out["full_mix_first_30s"] = {"heard": full, "similarity": round(similarity(full, C.NARRATION), 3)}
    return out


def contact_sheet(D):
    times = np.linspace(0.6, D - 0.6, 12)
    tiles = []
    for t in times:
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(VIDEO), "-frames:v", "1",
                            "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
        im = cv2.imdecode(np.frombuffer(r.stdout, np.uint8), cv2.IMREAD_COLOR)
        im = cv2.resize(im, (270, 480), interpolation=cv2.INTER_AREA)
        cv2.putText(im, f"{t:5.1f}s", (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(im)
    sheet = np.concatenate([np.concatenate(tiles[i:i + 6], 1) for i in (0, 6)], 0)
    cv2.imwrite(str(C.OUTPUT / "preview_contact_sheet.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])


def main():
    tl = json.loads((C.BUILD / "timeline.json").read_text("utf-8"))
    D = tl["duration"]
    rep = {"files": {}}
    for f in ("final_video.mp4", "voiceover.wav", "voiceover.mp3", "subtitles.srt"):
        p = C.OUTPUT / f
        rep["files"][f] = {"exists": p.exists(), "bytes": p.stat().st_size if p.exists() else 0}
    rep["probe"] = probe()
    rep["decode_errors"] = decode_errors() or "none"
    blacks = black_intervals()
    rep["black_intervals"] = blacks
    rep["unintended_black"] = [b for b in blacks if not (b[1] <= 1.2 or b[0] >= D - 2.0)]
    rep["loudness"] = loudness()

    cues = parse_srt(C.OUTPUT / "subtitles.srt")
    onsets = voice_onsets(tl)
    starts = {c["id"]: c["start"] for c in tl["chunks"]}
    caps = json.loads((C.BUILD / "captions.json").read_text("utf-8"))
    sync = []
    for cap in caps:
        if cap["block"] == "closing":
            continue
        on = onsets[cap["chunk"]]
        sync.append({"line": cap["text"], "caption_in": round(cap["t_in"], 3), "speech_onset": on,
                     "lead_ms": round((on - cap["t_in"]) * 1000)})
    rep["caption_sync"] = sync
    rep["voiceover_vs_dry_alignment_ms"] = delivered_alignment_ms()
    rep["srt"] = {"cues": len(cues), "max_lines": max(len(q["lines"]) for q in cues),
                  "monotonic": all(a["end"] <= b["start"] for a, b in zip(cues, cues[1:])),
                  "within_video": all(0 <= q["start"] < q["end"] <= D for q in cues)}
    rep["asr"] = asr_check(tl)
    contact_sheet(D)
    (C.OUTPUT / "verification_report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2), "utf-8")

    p = rep["probe"]
    print(f"[verify] {p['width']}x{p['height']} @ {p['fps']} fps, {p['container_duration']:.2f}s, "
          f"{p['video_codec']}/{p['audio_codec']} {p['audio_rate']} Hz, {p['size_mb']} MB")
    print(f"[verify] decode errors: {rep['decode_errors']}; black intervals: {blacks}; "
          f"unintended: {rep['unintended_black']}")
    print(f"[verify] loudness: {rep['loudness']}")
    print(f"[verify] caption lead vs speech onset (ms): {[s['lead_ms'] for s in sync]}; "
          f"voiceover alignment {rep['voiceover_vs_dry_alignment_ms']} ms")
    print(f"[verify] srt: {rep['srt']}")
    for k, v in rep["asr"].items():
        print(f"[verify] ASR {k}: {v}")
    ok = (all(f["exists"] and f["bytes"] > 0 for f in rep["files"].values()) and rep["decode_errors"] == "none"
          and not rep["unintended_black"] and p["width"] == 1080 and p["height"] == 1920 and p["fps"] == 30
          and rep["srt"]["max_lines"] <= 2 and rep["srt"]["monotonic"] and rep["srt"]["within_video"]
          and all(0 <= s["lead_ms"] <= 250 for s in sync) and abs(rep["voiceover_vs_dry_alignment_ms"]) <= 10)
    print("[verify] RESULT:", "PASS" if ok else "CHECK REPORT")
    return ok


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
