"""Image-space building blocks: noise, light shafts, particles, bloom, grading."""
import math

import cv2
import numpy as np

import config as C

W, H = C.W, C.H


def lin(c):
    """sRGB triple -> linear float32 array."""
    return np.array([v ** 2.2 for v in c], np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def sstep(e0, e1, x):  # scalar version
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def ease(x):
    x = min(1.0, max(0.0, x))
    return 0.5 - 0.5 * math.cos(math.pi * x)


def fbm(h, w, seed, base=3, octaves=5, persistence=0.55):
    """Smooth fractal noise in [0,1], float32 (h,w)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        rh = max(2, int(base * 2 ** o * h / max(h, w)) + 2)
        rw = max(2, int(base * 2 ** o * w / max(h, w)) + 2)
        small = rng.random((rh, rw)).astype(np.float32)
        out += amp * cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
        tot += amp
        amp *= persistence
    out /= tot
    out -= out.min()
    out /= out.max() + 1e-6
    return out


def radial_streaks(src, cx, cy, length=0.45, samples=26, falloff=1.6):
    """Volumetric light shafts: smear `src` away from the light point (cx, cy).
    `src` may be any resolution; cx, cy are in that resolution's pixels."""
    h, w = src.shape[:2]
    acc = np.zeros_like(src)
    wsum = 0.0
    for i in range(samples):
        s = 1.0 + length * i / samples
        M = np.float32([[1 / s, 0, cx - cx / s], [0, 1 / s, cy - cy / s]])
        warped = cv2.warpAffine(src, M, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                                borderMode=cv2.BORDER_CONSTANT)
        wt = (1 - i / samples) ** falloff
        acc += warped * wt
        wsum += wt
    return acc / wsum


def down(img, f=4):
    return cv2.resize(img, (img.shape[1] // f, img.shape[0] // f), interpolation=cv2.INTER_AREA)


def up(img, size=(W, H)):
    return cv2.resize(img, size, interpolation=cv2.INTER_LINEAR)


def bloom(img, threshold=0.75, strength=0.35):
    lum = img.max(axis=2, keepdims=True)
    bright = img * np.clip((lum - threshold) / (lum + 1e-4), 0, None)
    small = down(bright, 4)
    b1 = cv2.GaussianBlur(small, (0, 0), 5)
    b2 = cv2.GaussianBlur(down(small, 2), (0, 0), 12)
    b = b1 * 0.6 + up(b2, (small.shape[1], small.shape[0])) * 0.8
    return img + up(b) * strength


def aces(x):
    return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)


_yy, _xx = np.mgrid[0:H, 0:W].astype(np.float32)
_r = np.sqrt(((_xx - W / 2) / (W * 0.62)) ** 2 + ((_yy - H * 0.47) / (H * 0.62)) ** 2)
VIGNETTE = (1 - 0.42 * np.clip(_r, 0, 1.4) ** 2.4)[..., None].astype(np.float32)
YY, XX = _yy, _xx


def grade(lin_img, exposure=1.0):
    """HDR linear -> display sRGB [0,1] with cinematic split-tone and vignette."""
    x = aces(lin_img * exposure)
    x = np.power(np.clip(x, 0, 1), 1 / 2.2)
    lum = x.mean(axis=2, keepdims=True)
    shadow = (1 - lum) ** 3
    x = x + shadow * np.float32([-0.004, 0.012, 0.008])     # green-teal shadows
    x = x * (1 + lum * np.float32([0.035, 0.012, -0.04]))   # warm highlights
    return np.clip(x * VIGNETTE, 0, 1)


class Grain:
    def __init__(self, seed=11, n=8):
        rng = np.random.default_rng(seed)
        self.tex = [cv2.GaussianBlur(rng.standard_normal((H // 2, W // 2)).astype(np.float32), (0, 0), 0.6)
                    for _ in range(n)]

    def apply(self, x, frame, amount=0.018):
        g = up(self.tex[frame % len(self.tex)])[..., None]
        lum = x.mean(axis=2, keepdims=True)
        return x + g * amount * (0.55 + 0.45 * (1 - lum))


def splat(buf, xs, ys, vals):
    """Bilinear point splatting (sub-pixel smooth motion) into buf (h,w)."""
    h, w = buf.shape
    x0 = np.floor(xs).astype(np.int64)
    y0 = np.floor(ys).astype(np.int64)
    fx, fy = xs - x0, ys - y0
    for dx, dy, wt in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)),
                       (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        xi, yi = x0 + dx, y0 + dy
        ok = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
        np.add.at(buf, (yi[ok], xi[ok]), (vals * wt)[ok])


def disc_kernel(r):
    k = np.zeros((2 * r + 1, 2 * r + 1), np.float32)
    cv2.circle(k, (r, r), r, 1.0, -1, cv2.LINE_AA)
    k = cv2.GaussianBlur(k, (0, 0), 0.8)
    return k / k.sum()


class Dust:
    """Floating motes in a 3-D box, rendered in three depth bins
    (sharp specks, soft points, out-of-focus bokeh)."""

    def __init__(self, n, seed, box, drift=(0.0, -14.0), focal=1.0):
        rng = np.random.default_rng(seed)
        (x0, x1), (y0, y1), (z0, z1) = box
        self.p = np.stack([rng.uniform(x0, x1, n), rng.uniform(y0, y1, n), rng.uniform(z0, z1, n)], 1)
        self.phase = rng.uniform(0, 2 * np.pi, (n, 3))
        self.freq = rng.uniform(0.08, 0.25, (n, 3))
        self.tw = rng.uniform(0.6, 1.0, n)
        self.box = box
        self.drift = drift
        self.focal = focal
        self.bk = disc_kernel(7)

    def render(self, t, cam_z, cx, cy, lightfn, gain=1.0):
        (x0, x1), (y0, y1), (z0, z1) = self.box
        p = self.p
        wob = np.sin(self.phase + self.freq * t * 2 * np.pi)
        x = p[:, 0] + wob[:, 0] * 18 + self.drift[0] * t
        y = p[:, 1] + wob[:, 1] * 14 + self.drift[1] * t
        z = p[:, 2] - cam_z
        span = z1 - z0
        z = z0 + np.mod(z - z0, span)
        x = x0 + np.mod(x - x0, x1 - x0)
        y = y0 + np.mod(y - y0, y1 - y0)
        sx = cx + x * self.focal / z
        sy = cy + y * self.focal / z
        inten = lightfn(sx, sy) * self.tw * (0.75 + 0.25 * np.sin(t * 1.7 + self.phase[:, 2] * 3))
        inten = inten * gain * np.clip(1.4 - z / z1, 0.2, 1.0)
        near = z < z0 + span * 0.12
        mid = (~near) & (z < z0 + span * 0.45)
        far = ~(near | mid)
        out = np.zeros((H, W), np.float32)
        b = np.zeros((H, W), np.float32)
        splat(b, sx[far], sy[far], inten[far] * 1.6)
        out += cv2.GaussianBlur(b, (0, 0), 0.9)
        b = np.zeros((H, W), np.float32)
        splat(b, sx[mid], sy[mid], inten[mid] * 5.0)
        out += cv2.GaussianBlur(b, (0, 0), 2.2)
        hb = np.zeros((H // 2, W // 2), np.float32)
        splat(hb, sx[near] / 2, sy[near] / 2, inten[near] * 9.0)
        out += up(cv2.filter2D(hb, -1, self.bk)) * 0.9
        return out


def sample_map(m, sx, sy):
    """Nearest lookup of a (h,w) map at screen coords (any scale of W,H)."""
    h, w = m.shape
    xi = np.clip((sx * w / W).astype(np.int64), 0, w - 1)
    yi = np.clip((sy * h / H).astype(np.int64), 0, h - 1)
    return m[yi, xi]
