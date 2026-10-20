"""Step 2 - original score, sound design and final mix (all synthesized here,
so there is nothing to license). Music ducks under the narration and ducks
further during the sayings themselves.
Outputs: build/music.wav, build/sfx.wav, build/mix.wav
Usage: python audio.py [--no-music]   (ambience + effects only, no instruments)"""
import argparse
import json
import subprocess

import numpy as np
import pyloudnorm as pyln
from scipy.signal import istft, stft

import config as C
import dsp

SR = C.SAMPLE_RATE
NOTE = {"D2": 73.42, "G2": 98.00, "A2": 110.00, "Bb2": 116.54, "D3": 146.83, "E3": 164.81, "F3": 174.61,
        "G3": 196.00, "A3": 220.00, "Bb3": 233.08, "C#4": 277.18, "D4": 293.66, "E4": 329.63, "F4": 349.23,
        "A4": 440.00, "D5": 587.33, "A5": 880.00}


def env_span(n, a, b, att, rel):
    """Raised-cosine envelope: rise over `att` from a, hold, fall over `rel` after b."""
    t = np.arange(n) / SR
    up = np.clip((t - a) / att, 0, 1)
    dn = np.clip(1 - (t - b) / rel, 0, 1)
    return (0.5 - 0.5 * np.cos(np.pi * up)) * (0.5 - 0.5 * np.cos(np.pi * dn))


def pad_note(f0, n, a, b, cutoff, rng, gain=1.0):
    """Warm string-like pad: three detuned additive voices, soft low-pass rolloff."""
    i0, i1 = max(0, int((a - 0.1) * SR)), min(n, int((b + 3.6) * SR))
    t = np.arange(i1 - i0) / SR + i0 / SR
    out = np.zeros((i1 - i0, 2), np.float32)
    for det, pan in ((-6, -0.7), (0, 0.0), (6, 0.7)):
        f = f0 * 2 ** (det / 1200)
        drift = 1 + 0.0018 * np.sin(2 * np.pi * rng.uniform(0.05, 0.12) * t + rng.uniform(0, 6.28))
        ph = 2 * np.pi * np.cumsum(f * drift) / SR
        sig = np.zeros_like(t)
        for k in range(1, 28):
            fk = f * k
            if fk > 7000:
                break
            amp = (1.0 / k) / np.sqrt(1 + (fk / cutoff) ** 4)
            sig += amp * np.sin(k * ph + rng.uniform(0, 6.28))
        l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
        out[:, 0] += sig * l
        out[:, 1] += sig * r
    e = env_span(n, a, b, 2.6, 3.2)[i0:i1, None]
    full = np.zeros((n, 2), np.float32)
    full[i0:i1] = out * e * gain
    return full


def shaped_noise(n, centers_hz, bw_oct, seed, stereo=True):
    """Noise whose spectrum is a moving log-Gaussian band (wind, whooshes, risers)."""
    rng = np.random.default_rng(seed)
    chans = []
    for c in range(2 if stereo else 1):
        x = rng.standard_normal(n).astype(np.float32)
        f, tt, Z = stft(x, fs=SR, nperseg=2048, noverlap=1536)
        cen = np.maximum(np.interp(tt, np.linspace(0, n / SR, len(centers_hz)), centers_hz), 60.0)
        g = np.exp(-0.5 * (np.log2(np.maximum(f, 20)[:, None] / cen[None, :]) / bw_oct) ** 2)
        _, y = istft(Z * g, fs=SR, nperseg=2048, noverlap=1536)
        y = y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))
        chans.append(y / (np.abs(y).max() + 1e-9))
    return np.stack(chans, 1).astype(np.float32) if stereo else chans[0]


def place(buf, clip, at):
    i = int(at * SR)
    j = min(len(buf), i + len(clip))
    if j > i >= 0:
        buf[i:j] += clip[: j - i]


def boom(dur=4.0, f0=52.0):
    t = np.arange(int(dur * SR)) / SR
    f = f0 * (1 + 0.12 * np.exp(-t / 0.25))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = (np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)) * np.exp(-t / 1.1)
    y *= np.clip(t / 0.02, 0, 1)
    return np.stack([y, y], 1).astype(np.float32)


def bell(f0=146.83, dur=7.0, seed=0):
    """Deep, soft singing-bowl tone with slow beating between partials."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(dur * SR)) / SR
    y = np.zeros((len(t), 2), np.float32)
    for ratio, dec, amp in ((1.0, 3.6, 1.0), (2.01, 2.6, 0.45), (2.76, 2.0, 0.30), (4.07, 1.3, 0.14),
                            (5.40, 0.9, 0.08)):
        for c, det in enumerate((-0.6, 0.6)):
            fr = f0 * ratio + det
            y[:, c] += amp * np.sin(2 * np.pi * fr * t + rng.uniform(0, 6.28)) * np.exp(-t / dec)
    y *= np.clip(t / 0.015, 0, 1)[:, None]
    return y


def make_music(tl, n):
    tr1, tr2, tr3 = tl["transitions"]
    D = tl["duration"]
    mid3 = (tr2 + tr3) / 2
    rng = np.random.default_rng(1)
    chords = [
        (0.0, tr1 + 0.4, ["D2", "A2", "D3", "F3", "A3"], 900),
        (tr1 - 0.4, tr2 + 0.4, ["G2", "D3", "G3", "Bb3", "D4"], 760),
        (tr2 - 0.4, mid3 + 0.3, ["Bb2", "F3", "D4", "F4"], 1100),
        (mid3 - 0.3, tr3 + 0.3, ["A2", "E3", "A3", "C#4", "E4"], 1150),
        (tr3 - 0.3, D, ["D2", "A2", "D3", "F3", "A3", "E4"], 1000),
    ]
    mus = np.zeros((n, 2), np.float32)
    for a, b, notes, cut in chords:
        for nm in notes:
            g = 0.55 if NOTE[nm] < 120 else 0.32 if NOTE[nm] < 260 else 0.20
            mus += pad_note(NOTE[nm], n, a, b, cut, rng, g)
    # sustained tonic drone and a faint high shimmer for the sanctuary and closing
    t = np.arange(n) / SR
    drone = (np.sin(2 * np.pi * NOTE["D2"] * t) + 0.5 * np.sin(2 * np.pi * 2 * NOTE["D2"] * t + 1.0)) * \
        (0.75 + 0.25 * np.sin(2 * np.pi * 0.07 * t))
    mus += (drone * 0.22 * env_span(n, 0.3, D - 1.0, 3.5, 2.5))[:, None]
    for nm, ph in (("A4", 0.0), ("D5", 1.3), ("A5", 2.1)):
        sh = np.sin(2 * np.pi * NOTE[nm] * t + ph) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.11 * t + ph))
        mus[:, 0] += sh * 0.020 * env_span(n, tr2, D - 1.0, 3.0, 2.0)
        mus[:, 1] += np.roll(sh, 900) * 0.020 * env_span(n, tr2, D - 1.0, 3.0, 2.0)
    # dynamic arc: emerge from silence, tighten in the desert, open up in the sanctuary
    arc = np.interp(t, [0, 1.0, 4.0, tr1, tr2, tr2 + 2.5, tr3, D - 3, D],
                    [0.0, 0.35, 0.85, 0.95, 0.9, 1.1, 1.0, 0.9, 0.0])
    mus *= arc[:, None]
    mus = dsp.sos_filter(mus, "highpass", 45)
    mus = dsp.convolve_reverb(mus, dsp.reverb_ir(4.8, predelay=0.03, damp_hz=4500, seed=9), wet=0.42)
    return mus


def make_sfx(tl, n):
    tr1, tr2, tr3 = tl["transitions"]
    D = tl["duration"]
    ch = {c["id"]: c for c in tl["chunks"]}
    t = np.arange(n) / SR
    sfx = np.zeros((n, 2), np.float32)
    # wind bed: gusting band of air, loud only in the desert
    k = 64
    centers = 520 + 220 * np.sin(np.linspace(0, 9, k)) + 140 * np.sin(np.linspace(0, 23, k))
    wind = shaped_noise(n, centers, 0.9, seed=3)
    gust = 0.65 + 0.35 * np.sin(2 * np.pi * 0.23 * t) * np.sin(2 * np.pi * 0.09 * t + 1)
    level = np.interp(t, [0, 1.5, tr1 - 1.5, tr1, tr1 + 1, tr2 - 1, tr2 + 1, tr3, tr3 + 1, D - 2, D],
                      [0, 0.12, 0.14, 0.5, 0.95, 0.9, 0.16, 0.13, 0.06, 0.05, 0])
    sfx += wind * (gust * level * 0.42)[:, None]
    # opening breath of air as the light appears
    sw = shaped_noise(int(4.0 * SR), np.geomspace(180, 900, 32), 0.7, seed=4)
    sw *= env_span(len(sw), 0.2, 2.2, 1.8, 1.8)[:, None]
    place(sfx, sw * 0.20, 0.0)
    # gentle risers into transitions 1 & 2, an air whoosh across each transition
    for i, tr in enumerate((tr1, tr2)):
        rz = shaped_noise(int(2.4 * SR), np.geomspace(250, 2600, 48), 0.55, seed=10 + i)
        e = (np.linspace(0, 1, len(rz)) ** 2.2)[:, None]
        tt = np.arange(len(rz)) / SR
        tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (tt / 2.4 * 7 / 12)) / SR)
        place(sfx, (rz * 0.16 + tone[:, None] * 0.025) * e, tr - 2.4)
    for i, tr in enumerate((tr1, tr2, tr3)):
        wh = shaped_noise(int(2.2 * SR), np.concatenate([np.geomspace(300, 1500, 20), np.geomspace(1500, 260, 20)]),
                          0.6, seed=20 + i)
        wh *= np.sin(np.pi * np.linspace(0, 1, len(wh)))[:, None] ** 2
        place(sfx, wh * (0.20 if i < 2 else 0.11), tr - 1.1)
    # deep, soft resonances
    place(sfx, boom(4.0, 52) * 0.40, tr1 - 0.05)
    place(sfx, boom(4.5, 49) * 0.42, tr2 - 0.05)
    place(sfx, boom(5.0, 46) * 0.28, tr3 - 0.05)
    place(sfx, bell(146.83, 7.0, 1) * 0.10, ch["h1_a"]["start"] - 0.25)
    place(sfx, bell(130.81 * 1.0, 8.0, 2) * 0.10, tr2 + 0.1)
    place(sfx, bell(146.83, 7.0, 3) * 0.12, tr3 + 0.7)
    sfx = dsp.convolve_reverb(sfx, dsp.reverb_ir(3.2, predelay=0.02, damp_hz=5000, seed=12), wet=0.25)
    return sfx


def duck_envelope(tl, n):
    """Gain for music/effects: -6 dB under the narration, -11 dB under the sayings."""
    ctrl = 1000
    m = int(n / SR * ctrl)
    target = np.ones(m, np.float32)
    t = np.arange(m) / ctrl
    for c in tl["chunks"]:
        depth = dsp.db(-11.0) if c["kind"] == "hikma" else dsp.db(-6.5)
        sel = (t >= c["start"] - 0.25) & (t <= c["end"] + 0.15)
        target[sel] = np.minimum(target[sel], depth)
    # bridge the short gaps inside a group so the music doesn't pump between lines
    groups = {}
    for c in tl["chunks"]:
        groups.setdefault(c["group"], []).append(c)
    for cs in groups.values():
        depth = dsp.db(-11.0) if cs[0]["kind"] == "hikma" else dsp.db(-6.5)
        sel = (t >= cs[0]["start"]) & (t <= cs[-1]["end"])
        target[sel] = np.minimum(target[sel], depth)
    g = dsp.smooth_env(target, ctrl, attack=0.20, release=0.75)
    return np.interp(np.arange(n) / SR, t, g).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-music", action="store_true")
    args = ap.parse_args()
    tl = json.loads((C.BUILD / "timeline.json").read_text("utf-8"))
    n = int(tl["duration"] * SR)
    voice, _ = dsp.read(C.OUTPUT / "voiceover.wav")
    voice = voice[:n] if len(voice) >= n else np.pad(voice, (0, n - len(voice)))
    voice2 = np.stack([voice, voice], 1)

    print("[audio] composing score and sound design ...")
    music = np.zeros((n, 2), np.float32) if args.no_music else make_music(tl, n)
    sfx = make_sfx(tl, n)

    # level the stems relative to the narration (speech-only RMS)
    sel = np.zeros(n, bool)
    for c in tl["chunks"]:
        sel[int(c["start"] * SR):int(c["end"] * SR)] = True
    v_rms = dsp.rms(voice[sel])
    if not args.no_music:
        music *= v_rms * dsp.db(-13.0) / (dsp.rms(music) + 1e-9)
    sfx *= v_rms * dsp.db(-17.0) / (dsp.rms(sfx) + 1e-9)
    duck = duck_envelope(tl, n)[:, None]
    bed = (music + sfx) * duck
    if not args.no_music:
        dsp.write(C.BUILD / "music.wav", music)
    dsp.write(C.BUILD / "sfx.wav", sfx)

    mix = voice2 + bed
    tail = env_span(n, -1, tl["duration"] - 2.3, 0.5, 2.3)[:, None]    # fade everything out
    mix *= tail
    meter = pyln.Meter(SR)
    loud = meter.integrated_loudness(mix)
    assert np.isfinite(mix).all(), "non-finite samples in mix"
    mix *= dsp.db(-14.0 - loud)
    raw = C.BUILD / "mix_pre.wav"
    dsp.write(raw, mix)
    name = "mix_nomusic.wav" if args.no_music else "mix.wav"
    dsp.ffmpeg_filter(raw, C.BUILD / name, "alimiter=limit=0.84:attack=4:release=80:level=disabled")
    final, _ = dsp.read(C.BUILD / name)
    print(f"[audio] integrated {meter.integrated_loudness(final):.1f} LUFS, peak {20 * np.log10(np.abs(final).max()):.1f} dBFS"
          f" -> build/{name}")


if __name__ == "__main__":
    main()
