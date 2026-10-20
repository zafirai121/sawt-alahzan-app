"""Step 3 - render the picture: scenes, transitions, grading, captions, grain.
Frames are rendered in parallel and piped to FFmpeg (H.264, BT.709).
Usage: python render.py [--still t1,t2,...]  (stills -> build/stills/)"""
import argparse
import json
import multiprocessing as mp
import os
import subprocess
import time

import cv2
import numpy as np

import config as C
import fx
import scenes
from text import TextLine

G = {}


def build_captions(tl):
    ch = {c["id"]: c for c in tl["chunks"]}
    tr1, tr2, tr3 = tl["transitions"]
    block_end = {"intro": tr1 - 0.55, "h1": tr2 - 0.50, "link": ch["h2_a"]["start"] - 0.45, "h2": tr3 - 0.50}
    blocks = {}
    for cap in C.CAPTIONS:
        blocks.setdefault(cap["block"], []).append(cap)
    lines = []
    for name, caps in blocks.items():
        n = len(caps)
        for i, cap in enumerate(caps):
            cy = C.CAPTION_CENTER_Y if n == 1 else C.CAPTION_CENTER_Y + (i - 0.5) * C.CAPTION_LINE_GAP
            ln = TextLine(cap["text"], cap["size"], cap["weight"], cap["gold"], cy)
            c = ch[cap["chunk"]]
            dur = c["end"] - c["start"]
            ln.schedule(c["start"] - 0.10, block_end[name], dur * 0.55)
            ln.meta = {"block": name, "chunk": cap["chunk"], "text": cap["text"],
                       "start": c["start"], "end": c["end"], "t_in": c["start"] - 0.10, "t_out": block_end[name]}
            lines.append(ln)
    closing = []
    for i, cl in enumerate(C.CLOSING_LINES):
        cy = C.CLOSING_CENTER_Y + (i - 0.5) * 150
        ln = TextLine(cl["text"], cl["size"], "Bold", cl["gold"], cy)
        ln.schedule(tr3 + 0.75 + 0.55 * i, tl["duration"] + 5, 0.35)
        ln.meta = {"block": "closing", "text": cl["text"], "t_in": tr3 + 0.75 + 0.55 * i, "t_out": tl["duration"]}
        closing.append(ln)
    return lines, closing


def init_worker(tl):
    cv2.setNumThreads(1)
    G["tl"] = tl
    G["s1"], G["s2"], G["s3"], G["s4"] = (scenes.ArchCorridor(), scenes.DesertWind(),
                                          scenes.Sanctuary(), scenes.GoldenDust())
    G["lines"], G["closing"] = build_captions(tl)
    G["grain"] = fx.Grain()


def render_frame(i):
    tl = G["tl"]
    t = i / C.FPS
    D = tl["duration"]
    tr1, tr2, tr3 = tl["transitions"]
    s1, s2, s3, s4 = G["s1"], G["s2"], G["s3"], G["s4"]
    t2_0, t3_0 = tr1 - 0.85, tr2 - 0.95
    s3_dur = tr3 + 0.7 - t3_0

    img = None
    exposure = 1.0
    # --- scene 1 + transition 1 (dissolve through a warm bloom)
    if t < tr1 + 0.85:
        light = fx.sstep(0.15, 3.4, t) ** 1.5
        a = s1.render(t, light)
        p = fx.sstep(tr1 - 0.8, tr1 + 0.8, t)
        if p > 0:
            b = s2.render(t - t2_0, 1.0) * 1.12
            img = a * (1 - p) + b * p
            exposure *= 1 + 0.30 * np.sin(np.pi * p)
        else:
            img = a
    # --- scene 2 + transition 2 (luma-keyed dissolve: light arrives first)
    elif t < tr2 + 0.95:
        a = s2.render(t - t2_0, 1.0) * 1.12
        p = fx.sstep(tr2 - 0.9, tr2 + 0.9, t)
        if p > 0:
            b = s3.render(t - t3_0, 0.45 + 0.55 * fx.ease((t - t3_0) / 2.8), s3_dur)
            lum = b.mean(axis=2)
            ln = np.clip(lum / (lum + 0.12), 0, 1)
            m = np.clip((p - (1 - ln) * 0.6) / 0.4, 0, 1)[..., None]
            img = a * (1 - m) + b * m
        else:
            img = a
    # --- scene 3 + transition 3 (dip toward black, the motes take over)
    elif t < tr3 + 0.8:
        rise = 0.45 + 0.55 * fx.ease((t - t3_0) / 2.8)
        out = 1 - fx.sstep(tr3 - 0.75, tr3 + 0.15, t)
        img = s3.render(t - t3_0, rise, s3_dur) * out
        if t > tr3 - 0.2:
            img = img + s4.render(t - tr3, fx.sstep(tr3 - 0.2, tr3 + 0.8, t), fx.sstep(tr3 - 0.2, tr3 + 0.8, t))
    # --- scene 4: closing card, gold motes fade away
    else:
        motes = 1 - 0.85 * fx.ease((t - tr3 - 1.5) / max(D - tr3 - 2.5, 0.5))
        img = s4.render(t - tr3, 1.0, motes)

    end_fade = 1 - fx.ease((t - (D - 1.9)) / 1.9)
    img = fx.bloom(img, threshold=0.75, strength=0.32)
    frame = fx.grade(img, exposure * end_fade)

    for ln in G["lines"]:
        ln.draw(frame, t)
    for ln in G["closing"]:
        ln.draw(frame, t, fade=end_fade)

    frame = G["grain"].apply(frame, i, 0.014 * (0.3 + 0.7 * end_fade))
    rng = np.random.default_rng(i)
    frame = frame * 255 + rng.uniform(-0.5, 0.5, frame.shape).astype(np.float32)   # dither vs banding
    return np.clip(frame, 0, 255).astype(np.uint8).tobytes()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--still", default="")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    args = ap.parse_args()
    tl = json.loads((C.BUILD / "timeline.json").read_text("utf-8"))
    n = int(round(tl["duration"] * C.FPS))

    if args.still:
        out = C.BUILD / "stills"
        out.mkdir(parents=True, exist_ok=True)
        init_worker(tl)
        for ts in args.still.split(","):
            i = int(round(float(ts) * C.FPS))
            f = np.frombuffer(render_frame(i), np.uint8).reshape(C.H, C.W, 3)
            cv2.imwrite(str(out / f"t{float(ts):05.2f}.jpg"), f[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 92])
        print("stills written to", out)
        return

    # captions manifest for the subtitle step and the verification report
    lines, closing = build_captions(tl)
    (C.BUILD / "captions.json").write_text(json.dumps([l.meta for l in lines + closing], ensure_ascii=False,
                                                      indent=2), "utf-8")
    dst = C.BUILD / "video_noaudio.mp4"
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{C.W}x{C.H}", "-r", str(C.FPS), "-i", "-",
           "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
           "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-level", "4.2",
           "-x264-params", "aq-mode=3:aq-strength=0.9:deblock=-1,-1",
           "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
           "-movflags", "+faststart", str(dst)]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    t0 = time.time()
    with mp.get_context("fork").Pool(args.workers, initializer=init_worker, initargs=(tl,)) as pool:
        for k, buf in enumerate(pool.imap(render_frame, range(n), chunksize=2)):
            enc.stdin.write(buf)
            if k % 60 == 0:
                el = time.time() - t0
                print(f"[render] frame {k}/{n}  {el:6.1f}s  eta {el / (k + 1) * (n - k - 1):6.1f}s", flush=True)
    enc.stdin.close()
    if enc.wait() != 0:
        raise SystemExit("ffmpeg encode failed")
    print(f"[render] {n} frames in {time.time() - t0:.1f}s -> {dst}")


if __name__ == "__main__":
    main()
