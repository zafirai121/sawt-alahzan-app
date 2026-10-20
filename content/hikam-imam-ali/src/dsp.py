"""Small DSP toolkit (numpy/scipy) shared by the voice, music and SFX builders."""
import subprocess
from math import gcd

import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, resample_poly, sosfilt, sosfiltfilt

SR = 48000


def resample(y, sr_from, sr_to):
    if sr_from == sr_to:
        return y.astype(np.float32)
    g = gcd(sr_from, sr_to)
    return resample_poly(y, sr_to // g, sr_from // g, axis=0).astype(np.float32)


def db(x):
    return 10 ** (x / 20.0)


def rms(y):
    return float(np.sqrt(np.mean(np.square(y)) + 1e-12))


def trim_silence(y, sr, thresh_db=-42.0, pad=0.03):
    """Trim leading/trailing silence; returns trimmed signal."""
    frame = int(0.01 * sr)
    n = len(y) // frame
    env = np.sqrt(np.mean(y[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    ref = env.max()
    on = np.where(20 * np.log10(env / ref + 1e-12) > thresh_db)[0]
    if len(on) == 0:
        return y
    a = max(0, on[0] * frame - int(pad * sr))
    b = min(len(y), (on[-1] + 1) * frame + int(pad * sr))
    return y[a:b]


def fade(y, sr, fin=0.01, fout=0.02):
    y = y.copy()
    a, b = int(fin * sr), int(fout * sr)
    if a:
        y[:a] *= np.linspace(0, 1, a, dtype=np.float32)[:, None] if y.ndim == 2 else np.linspace(0, 1, a, dtype=np.float32)
    if b:
        y[-b:] *= np.linspace(1, 0, b, dtype=np.float32)[:, None] if y.ndim == 2 else np.linspace(1, 0, b, dtype=np.float32)
    return y


def sos_filter(y, kind, freq, order=2, sr=SR, zero_phase=False):
    sos = butter(order, freq, btype=kind, fs=sr, output="sos")
    return (sosfiltfilt if zero_phase else sosfilt)(sos, y, axis=0).astype(np.float32)


def reverb_ir(seconds=3.2, sr=SR, predelay=0.02, damp_hz=5200, seed=7, stereo=True):
    """Synthetic hall impulse response: decorrelated noise, exponential decay,
    progressively darker tail."""
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    chans = []
    for c in range(2 if stereo else 1):
        noise = rng.standard_normal(n).astype(np.float32)
        bright = sos_filter(noise, "lowpass", damp_hz, sr=sr)
        dark = sos_filter(noise, "lowpass", damp_hz / 4, sr=sr)
        mix = np.clip(t / seconds * 1.6, 0, 1)
        tail = (bright * (1 - mix) + dark * mix) * np.exp(-6.9 * t / seconds)
        tail[: int(0.004 * sr)] *= np.linspace(0, 1, int(0.004 * sr))
        chans.append(np.concatenate([np.zeros(int(predelay * sr), np.float32), tail]))
    ir = np.stack(chans, 1) if stereo else chans[0]
    return (ir / np.sqrt(np.sum(ir ** 2, axis=0) + 1e-9)).astype(np.float32)


def convolve_reverb(dry, ir, wet=0.3):
    """dry: (n,) or (n,2). Returns stereo (n,2) of same length."""
    if dry.ndim == 1:
        dry = np.stack([dry, dry], 1)
    out = np.zeros_like(dry)
    for c in range(2):
        w = fftconvolve(dry[:, c], ir[:, c])[: len(dry)]
        out[:, c] = w
    return (dry * (1 - wet) + out * wet * 1.0).astype(np.float32)


def smooth_env(x, sr, attack, release):
    """One-pole attack/release smoother for gain envelopes (x in linear gain)."""
    a_up = np.exp(-1.0 / (attack * sr))
    a_dn = np.exp(-1.0 / (release * sr))
    y = np.empty_like(x)
    s = x[0]
    for i in range(len(x)):  # envelope is computed at control rate (see audio.py)
        v = x[i]
        coef = a_up if v < s else a_dn  # dropping gain = ducking attack
        s = coef * s + (1 - coef) * v
        y[i] = s
    return y


def ffmpeg_filter(in_wav, out_wav, af, sr=SR):
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(in_wav),
           "-af", af, "-ar", str(sr), "-c:a", "pcm_f32le", str(out_wav)]
    subprocess.run(cmd, check=True)


def write(path, y, sr=SR, subtype="FLOAT"):
    sf.write(str(path), y, sr, subtype=subtype)


def read(path):
    y, sr = sf.read(str(path), dtype="float32", always_2d=False)
    return y, sr
