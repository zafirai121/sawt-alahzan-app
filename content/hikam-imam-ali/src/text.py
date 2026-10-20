"""Arabic caption lines: HarfBuzz/Raqm shaping via Pillow, per-word masks so
words can be revealed right-to-left in time with the voice, gold highlights."""
import math

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, features

import config as C
import fx

FONT_FILES = {"Bold": "Tajawal-Bold.ttf", "Medium": "Tajawal-Medium.ttf"}
IVORY = np.float32(C.IVORY)
GOLD_TOP = np.float32((0.99, 0.80, 0.47))
GOLD_BOT = np.float32((0.83, 0.58, 0.24))

if not features.check("raqm"):
    raise SystemExit("Pillow was built without libraqm - Arabic shaping would break. "
                     "Install the PyPI wheel of Pillow (bundles raqm) and libfribidi.")


def font(weight, size):
    return ImageFont.truetype(str(C.FONTS / FONT_FILES[weight]), size, layout_engine=ImageFont.Layout.RAQM)


class TextLine:
    def __init__(self, text, size, weight, gold, center_y, max_w=C.CAPTION_MAX_W):
        words = text.split()
        while True:
            f = font(weight, size)
            widths = [f.getlength(w, direction="rtl", language="ar") for w in words]
            space = f.getlength(" ", direction="rtl", language="ar") * 1.05
            total = sum(widths) + space * (len(words) - 1)
            if total <= max_w or size <= 40:
                break
            size -= 2
        asc, desc = f.getmetrics()
        pad = int(size * 0.55)
        cw, ch = int(math.ceil(total)) + 2 * pad, asc + desc + 2 * pad
        base = pad + asc
        masks = []
        x_right = cw - pad
        for w, wd in zip(words, widths):
            im = Image.new("L", (cw, ch), 0)
            ImageDraw.Draw(im).text((x_right, base), w, font=f, fill=255, anchor="rs",
                                    direction="rtl", language="ar")
            masks.append(np.asarray(im, np.float32) / 255)
            x_right -= wd + space
        self.masks = np.stack(masks)
        self.gold = np.array([w in gold for w in words])
        self.words = words
        self.size = size
        baseline_y = center_y + 0.30 * size
        self.x0 = int(round(C.W / 2 - cw / 2))
        self.y0 = int(round(baseline_y - base))
        g = np.linspace(0, 1, ch, dtype=np.float32)[:, None, None]
        self.gold_grad = GOLD_TOP * (1 - g) + GOLD_BOT * g
        # schedule (filled by the compositor)
        self.t_in, self.t_out, self.stagger = 0.0, 1e9, 0.08

    def schedule(self, t_in, t_out, word_span):
        self.t_in, self.t_out = t_in, t_out
        n = len(self.words)
        self.stagger = 0.0 if n < 2 else min(0.11, word_span / (n - 1))

    def state(self, t):
        if t < self.t_in - 0.05 or t > self.t_out + 0.5:
            return None
        out = 1 - fx.ease((t - self.t_out) / 0.45)
        alphas = np.array([fx.ease((t - self.t_in - i * self.stagger) / 0.42) for i in range(len(self.words))]) * out
        if alphas.max() <= 0.002:
            return None
        k = fx.ease((t - self.t_in) / 0.6)
        blur = 5.0 * (1 - k)
        dy = 12.0 * (1 - k)
        return alphas, blur, dy

    def draw(self, frame, t, fade=1.0):
        st = self.state(t)
        if st is None:
            return
        alphas, blur, dy = st
        alphas = alphas * fade
        A = np.tensordot(alphas, self.masks, axes=1)
        G = np.tensordot(alphas * self.gold, self.masks, axes=1)
        if blur > 0.3:
            A = cv2.GaussianBlur(A, (0, 0), blur)
            G = cv2.GaussianBlur(G, (0, 0), blur)
        A, G = np.clip(A, 0, 1), np.clip(G, 0, 1)
        h, w = A.shape
        y0 = self.y0 + int(round(dy))
        x0 = self.x0
        ys, ye = max(0, y0), min(C.H, y0 + h)
        xs, xe = max(0, x0), min(C.W, x0 + w)
        A = A[ys - y0:ye - y0, xs - x0:xe - x0]
        G = G[ys - y0:ye - y0, xs - x0:xe - x0]
        grad = self.gold_grad[ys - y0:ye - y0]
        region = frame[ys:ye, xs:xe]
        # soft dark halo for legibility, warm glow under gold words
        shadow = cv2.GaussianBlur(A, (0, 0), 7) * 0.80 + cv2.GaussianBlur(A, (0, 0), 22) * 0.35
        region *= (1 - np.clip(shadow, 0, 0.88))[..., None]
        glow = cv2.GaussianBlur(G, (0, 0), 14) * 0.30
        region += glow[..., None] * GOLD_TOP
        iv = np.clip(A - G, 0, 1)[..., None]
        color = IVORY * iv + grad * G[..., None]
        region[:] = region * (1 - A[..., None]) + color
