"""Step 1 - Arabic narration with the offline Piper voice "kareem" (via sherpa-onnx).

Each text chunk is synthesized separately, trimmed, and placed on the timeline
defined in config.py. The assembled track is then voiced deeper (formant-
preserving pitch shift), EQ'd, compressed and given a light hall reverb.
Outputs: output/voiceover.wav, output/voiceover.mp3, build/timeline.json
"""
import difflib
import json
import re
import subprocess

import numpy as np
import sherpa_onnx

import config as C
import dsp

TAKES = 12  # max candidate takes per chunk when the Whisper checker is installed
# silence before a chunk that directly follows another one (used to judge takes in context)
CONTEXT_GAP = {"intro_b": C.GAP_INTRO, "h1_b": C.GAP_H1, "h2_a": C.GAP_LINK, "h2_b": C.GAP_H2}
ASR_DIR = C.MODELS / "sherpa-onnx-whisper-turbo"


def normalize_ar(s):
    s = re.sub(r"[\u064B-\u0652\u0670\u0640]", "", s)          # tashkeel, tatweel
    s = re.sub(r"[أإآٱ]", "ا", s).replace("ى", "ي").replace("ة", "ه")
    s = re.sub(r"[^\u0621-\u064A ]", " ", s)
    # a pronounced final kasra/damma/fatha is often transcribed as ي/و/ا - not an error
    return " ".join(w[:-1] if len(w) > 3 and w[-1] in "يوا" else w for w in s.split())


def similarity(a, b):
    a, b = normalize_ar(a), normalize_ar(b)
    return 0.5 * difflib.SequenceMatcher(None, a, b).ratio() + \
        0.5 * difflib.SequenceMatcher(None, a.split(), b.split()).ratio()


def load_asr():
    if not (ASR_DIR / "turbo-encoder.int8.onnx").exists():
        return None
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=str(ASR_DIR / "turbo-encoder.int8.onnx"), decoder=str(ASR_DIR / "turbo-decoder.int8.onnx"),
        tokens=str(ASR_DIR / "turbo-tokens.txt"), language="ar", task="transcribe", num_threads=4)


def transcribe(asr, y, sr):
    y16 = dsp.resample(y, sr, 16000)
    st = asr.create_stream()
    st.accept_waveform(16000, y16)
    asr.decode_stream(st)
    return st.result.text


def load_tts():
    if not C.VOICE_MODEL.exists():
        raise SystemExit(f"Voice model missing: {C.VOICE_MODEL}\nRun ./setup_models.sh first.")
    vits = sherpa_onnx.OfflineTtsVitsModelConfig(
        model=str(C.VOICE_MODEL), tokens=str(C.VOICE_DIR / "tokens.txt"),
        data_dir=str(C.VOICE_DIR / "espeak-ng-data"),
        noise_scale=0.55, noise_scale_w=0.7, length_scale=1.0)
    cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=vits, num_threads=4))
    return sherpa_onnx.OfflineTts(cfg)


def take(tts, text):
    audio = tts.generate(text, sid=0, speed=C.VOICE_SPEED)
    y = np.asarray(audio.samples, dtype=np.float32)
    y = dsp.resample(y, audio.sample_rate, C.SAMPLE_RATE)
    y = dsp.trim_silence(y, C.SAMPLE_RATE, thresh_db=-40, pad=0.025)
    return dsp.fade(y, C.SAMPLE_RATE, 0.008, 0.05)


def score_take(asr, y, text, prev=None):
    """Similarity of Whisper transcripts with different silence padding - on the
    take alone and, when it follows another line, joined to the chosen previous take
    (a borderline consonant can be heard right alone and wrong in context)."""
    scores = []
    for pad in (0.15, 0.6, 1.2):
        z = np.zeros(int(pad * C.SAMPLE_RATE), np.float32)
        scores.append(similarity(transcribe(asr, np.concatenate([z, y, z]), C.SAMPLE_RATE), text))
    if prev is not None:
        p_y, p_text, gap = prev
        g = np.zeros(int(gap * C.SAMPLE_RATE), np.float32)
        for pad in (0.3, 0.9):
            z = np.zeros(int(pad * C.SAMPLE_RATE), np.float32)
            heard = transcribe(asr, np.concatenate([z, p_y, g, y, z]), C.SAMPLE_RATE)
            scores.append(similarity(heard, p_text + " " + text))
    return float(np.mean(scores)), float(np.min(scores))


def synth_chunks(tts):
    """Piper's sampling is stochastic, so we record several takes per line and
    keep the one Whisper understands best (a director picking the cleanest take)."""
    asr = load_asr()
    if asr is None:
        print("  (Whisper checker not installed - using first take; ./setup_models.sh --with-asr)")
    out, report = {}, []
    prev_id = None
    for ch in C.VOICE_CHUNKS:
        ctx = None
        if prev_id is not None and ch["id"] in CONTEXT_GAP:
            prev_text = next(c["text"] for c in C.VOICE_CHUNKS if c["id"] == prev_id)
            ctx = (out[prev_id], prev_text, CONTEXT_GAP[ch["id"]])
        if asr is None:
            best, sc, tries = take(tts, ch["text"]), None, 1
        else:
            cands = []
            for _ in range(TAKES):
                y = take(tts, ch["text"])
                cands.append((score_take(asr, y, ch["text"], ctx), y))
                if sum(c[0][1] >= 0.999 for c in cands) >= 3:
                    break  # three flawless takes are enough to choose from
            med = np.median([len(y) for _, y in cands])
            # best worst-case score, then mean score, then natural (median) length
            cands.sort(key=lambda c: (-round(c[0][1], 3), -round(c[0][0], 3), abs(len(c[1]) - med)))
            sc, best = cands[0]
            tries = len(cands)
        out[ch["id"]] = best
        prev_id = ch["id"]
        report.append({"id": ch["id"], "seconds": round(len(best) / C.SAMPLE_RATE, 3), "takes": tries,
                       "asr_mean": None if sc is None else round(sc[0], 3),
                       "asr_worst": None if sc is None else round(sc[1], 3)})
        print(f"  {ch['id']:8s} {len(best) / C.SAMPLE_RATE:5.2f}s  takes={tries:2d}  score={sc}  {ch['text']}")
    (C.BUILD / "takes.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    return out


def build_timeline(durs):
    """Place every chunk and derive scene transitions from the narration."""
    t = {}
    cur = C.T_INTRO_START
    t["intro_a"] = cur; cur += durs["intro_a"] + C.GAP_INTRO
    t["intro_b"] = cur; cur += durs["intro_b"]
    tr1 = cur + C.HOLD_AFTER_INTRO
    cur = tr1 + C.LEAD_H1
    t["h1_a"] = cur; cur += durs["h1_a"] + C.GAP_H1
    t["h1_b"] = cur; cur += durs["h1_b"]
    tr2 = cur + C.HOLD_AFTER_H1
    cur = tr2 + C.LEAD_LINK
    t["link"] = cur; cur += durs["link"] + C.GAP_LINK
    t["h2_a"] = cur; cur += durs["h2_a"] + C.GAP_H2
    t["h2_b"] = cur; cur += durs["h2_b"]
    tr3 = cur + C.HOLD_AFTER_H2
    total = min(35.0, max(30.0, C.TARGET_DURATION, tr3 + C.CLOSING_MIN))
    total = round(total * C.FPS) / C.FPS
    chunks = [{"id": ch["id"], "kind": ch["kind"], "group": ch["group"], "text": ch["text"],
               "start": round(t[ch["id"]], 3), "end": round(t[ch["id"]] + durs[ch["id"]], 3)}
              for ch in C.VOICE_CHUNKS]
    return {"chunks": chunks, "transitions": [round(tr1, 3), round(tr2, 3), round(tr3, 3)],
            "duration": total}


def master_voice(raw_path, out_path):
    """Deeper, warmer, more present narration. rubberband keeps tempo and formants."""
    af = ",".join([
        f"rubberband=pitch={C.VOICE_PITCH}:formant=preserved:transients=smooth:window=long",
        "highpass=f=65",
        "equalizer=f=120:t=q:w=0.9:g=3",       # chest / warmth
        "equalizer=f=330:t=q:w=1.4:g=-2.5",    # remove box/mud
        "equalizer=f=2800:t=q:w=1.6:g=1.5",    # articulation
        "equalizer=f=7500:t=q:w=1.0:g=-2",     # tame synthetic fizz
        "deesser=i=0.35",
        "acompressor=threshold=-24dB:ratio=2.6:attack=6:release=140:makeup=3dB",
    ])
    dsp.ffmpeg_filter(raw_path, out_path, af)


def align_offset(ref, test, sr):
    """Lag (s) of test relative to ref using envelope cross-correlation."""
    hop = sr // 1000
    def env(x):
        n = len(x) // hop
        return np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, 1))
    a, b = env(ref), env(test)
    n = min(len(a), len(b))
    a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
    corr = np.correlate(b[:n], a[: n], mode="full")
    lag = np.argmax(corr[n - 300: n + 300]) - 300
    return lag / 1000.0


def main():
    C.BUILD.mkdir(exist_ok=True)
    C.OUTPUT.mkdir(exist_ok=True)
    print("[tts] synthesizing chunks with Piper ar_JO-kareem-medium ...")
    tts = load_tts()
    parts = synth_chunks(tts)
    durs = {k: len(v) / C.SAMPLE_RATE for k, v in parts.items()}
    tl = build_timeline(durs)

    n = int(tl["duration"] * C.SAMPLE_RATE)
    raw = np.zeros(n, np.float32)
    for ch in tl["chunks"]:
        a = int(round(ch["start"] * C.SAMPLE_RATE))
        y = parts[ch["id"]]
        raw[a: a + len(y)] += y
    raw /= np.abs(raw).max() / 0.7
    dsp.write(C.BUILD / "voice_raw.wav", raw)

    master_voice(C.BUILD / "voice_raw.wav", C.BUILD / "voice_eq.wav")
    eq, _ = dsp.read(C.BUILD / "voice_eq.wav")
    eq = eq[:n] if len(eq) >= n else np.pad(eq, (0, n - len(eq)))
    lag = align_offset(raw, eq, C.SAMPLE_RATE)
    if abs(lag) >= 0.002:  # compensate any processing latency so captions stay exact
        s = int(round(lag * C.SAMPLE_RATE))
        eq = np.roll(eq, -s)
        if s > 0:
            eq[-s:] = 0
        else:
            eq[:-s] = 0
    print(f"[tts] processing latency compensated: {lag * 1000:.1f} ms")

    # light hall, mostly dry: dignified, not echoey
    ir = dsp.reverb_ir(1.6, predelay=0.018, damp_hz=4200, seed=3)
    wet = dsp.convolve_reverb(eq, ir, wet=0.16)
    voice = wet.mean(1)
    voice *= 0.89 / np.abs(voice).max()   # -1 dBFS peak stem
    voice = dsp.fade(voice, C.SAMPLE_RATE, 0.0, 0.4)

    dsp.write(C.OUTPUT / "voiceover.wav", voice, subtype="PCM_24")
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i",
                    str(C.OUTPUT / "voiceover.wav"), "-c:a", "libmp3lame", "-b:a", "192k",
                    str(C.OUTPUT / "voiceover.mp3")], check=True)
    (C.BUILD / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=2), "utf-8")
    print(f"[tts] duration {tl['duration']:.2f}s, transitions {tl['transitions']}")


if __name__ == "__main__":
    main()
