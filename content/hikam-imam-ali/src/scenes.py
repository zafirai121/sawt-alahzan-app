"""The four procedural scenes. Each returns a linear-light HDR float32 image (H,W,3).
No people, faces or figures - only architecture, nature, light and particles."""
import math

import cv2
import numpy as np

import config as C
import fx
import geometry as geo

W, H = C.W, C.H
GOLD = fx.lin(C.GOLD)
GOLD_L = fx.lin(C.GOLD_LIGHT)
AMBER = fx.lin((0.95, 0.62, 0.28))
GREEN = fx.lin((0.06, 0.20, 0.15))


def _pattern_tex(px=1024, cells=4, thick=3):
    t = geo.star_lattice(px, cells, 67.5, thick).astype(np.float32) / 255.0
    return t


# ---------------------------------------------------------------------------
class ArchCorridor:
    """Scene 1 - a receding colonnade of pointed arches; light at the far end."""

    def __init__(self):
        self.cx, self.cy = W / 2, 905.0
        # openings run below the floor; each wall is clipped at its own floor line
        self.arch = geo.pointed_arch(half_w=372, spring_y=-250, apex_y=-760, floor_y=2600, n=60)
        self.frame_in = geo.pointed_arch(half_w=372 + 46, spring_y=-250, apex_y=-760 - 64, floor_y=640, n=60)
        self.n = 11
        self.z0, self.dz = 0.92, 0.52
        self.thick = 0.16
        self.speed = 0.058
        self.pattern = _pattern_tex(1024, 6, 3)
        self.dust = fx.Dust(520, seed=21, box=((-420, 420), (-760, 640), (0.55, 4.8)),
                            drift=(4.0, -9.0), focal=1.0)

    def _background(self, light):
        cx, cy = self.cx, self.cy
        r2 = (fx.XX - cx) ** 2 + ((fx.YY - cy + 120) * 0.8) ** 2
        core = np.exp(-r2 / (2 * 60 ** 2)) * 5.0 + np.exp(-r2 / (2 * 150 ** 2)) * 1.1 + \
            np.exp(-r2 / (2 * 420 ** 2)) * 0.12
        img = core[..., None] * GOLD_L * light
        dy = fx.YY - cy
        below = dy > 2
        z_floor = np.where(below, 640.0 / np.maximum(dy, 1), 50)
        refl = np.exp(-((fx.XX - cx) / (36 + 0.28 * np.maximum(dy, 0))) ** 2) * np.exp(-np.maximum(dy, 0) / 380)
        u = (fx.XX - cx) * z_floor / 260.0
        v = z_floor * 3.2 + self.speed * self._t * 3.2
        joints = np.maximum(np.exp(-((u - np.round(u)) / 0.015) ** 2), np.exp(-((v - np.round(v)) / 0.02) ** 2))
        lit = np.clip(z_floor / 7, 0, 1) ** 1.5
        floor_lum = (0.012 + 0.16 * lit) * (1 - 0.6 * joints) + refl * 1.2
        floor = floor_lum[..., None] * (AMBER * 0.45 + GOLD_L * 0.15) * light
        return np.where(below[..., None], floor, img)

    def render(self, t, light):
        self._t = t
        cx, cy = self.cx, self.cy
        cam = self.speed * t
        zs = []
        for i in range(self.n):
            z = self.z0 + i * self.dz - cam
            while z < 0.36:
                z += self.n * self.dz
            zs.append(z)
        img = np.zeros((H, W, 3), np.float32)
        acc = np.zeros((H, W), np.float32)
        x0, y0, x1, y1 = 0, 0, W, H            # region still visible through nearer arches
        for z in sorted(zs):                   # front-to-back compositing
            s, sb = 1.0 / z, 1.0 / (z + self.thick)
            if s * 372 > W * 1.6 or x1 - x0 < 4 or y1 - y0 < 4:
                continue
            ww, hh = x1 - x0, y1 - y0
            off = np.float64([x0, y0])
            mf = np.zeros((hh, ww), np.uint8)
            geo.fill(mf, geo.place(self.arch, s, cx, cy) - off)
            mb = np.zeros((hh, ww), np.uint8)
            geo.fill(mb, geo.place(self.arch, sb, cx, cy) - off)
            fr = np.zeros((hh, ww), np.uint8)
            geo.stroke(fr, geo.place(self.frame_in, s, cx, cy) - off, max(1, int(3 * s)))
            mf, mb, fr = (m.astype(np.float32) / 255 for m in (mf, mb, fr))
            YY = fx.YY[y0:y1, x0:x1]
            XX = fx.XX[y0:y1, x0:x1]
            above = np.clip(cy + 640 * s - YY + 0.5, 0, 1)
            wall = (1 - mf) * above
            intr = np.clip(mf - mb, 0, 1) * np.clip(cy + 640 * sb - YY + 0.5, 0, 1)
            haze = 1 - math.exp(-0.40 * (z - 0.3))
            wall_col = np.float32([0.006, 0.007, 0.006]) * (1 - haze) + AMBER * (0.045 * haze)
            M = np.float32([[1 / s, 0, -cx / s + 512 + x0 / s], [0, 1 / s, -cy / s + 512 + y0 / s]])
            pat = cv2.warpAffine(self.pattern, M, (ww, hh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
            prox = np.exp(-(((XX - cx) / (430 * s + 120)) ** 2 + ((YY - cy) / (820 * s + 200)) ** 2))
            wall_rgb = wall_col + (pat * prox * (0.010 + 0.05 * haze))[..., None] * GOLD
            wall_rgb = wall_rgb + (fr * (0.06 + 0.30 * haze) * (0.4 + 0.6 * prox))[..., None] * GOLD
            # the arch's inner thickness catches the light: brighter deeper in
            grad = np.clip(1.15 - (YY - (cy - 760 * s)) / (1500 * s + 1), 0.2, 1.0)
            intr_rgb = GOLD * ((0.06 + 0.95 * haze ** 1.6) * grad)[..., None]
            vis = 1 - acc[y0:y1, x0:x1]
            a_w, a_i = wall * vis, intr * vis
            img[y0:y1, x0:x1] += (wall_rgb * a_w[..., None] + intr_rgb * a_i[..., None]) * light
            acc[y0:y1, x0:x1] += a_w + a_i
            # next arches are only visible through this one's inner opening
            pb = geo.place(self.arch, sb, cx, cy)
            nx0, nx1 = int(max(x0, np.floor(pb[:, 0].min()) - 2)), int(min(x1, np.ceil(pb[:, 0].max()) + 2))
            ny0 = int(max(y0, np.floor(pb[:, 1].min()) - 2))
            x0, x1, y0 = nx0, nx1, ny0
        bg = self._background(light)
        img += bg * (1 - acc)[..., None]

        # ---- volumetric shafts radiating from the far opening
        q = fx.down(img, 4)
        lum = q.max(axis=2, keepdims=True)
        src = q * np.clip((lum - 0.9) / (lum + 1e-4), 0, None)
        shafts = fx.up(fx.radial_streaks(src, cx / 4, (cy - 120) / 4, length=2.2, samples=30, falloff=1.3))
        img += shafts * 0.85

        # ---- dust motes lit by the shafts
        smap = fx.down(shafts.max(axis=2), 8)
        dust = self.dust.render(t, cam, cx, cy - 60,
                                lambda x, y: 0.06 + 2.6 * fx.sample_map(smap, x, y), gain=0.9 * light)
        img += dust[..., None] * GOLD_L
        return img


# ---------------------------------------------------------------------------
class DesertWind:
    """Scene 2 - dark dunes under a heavy sky; wind tears sand from the crests,
    while a band of light breaks along the horizon."""

    def __init__(self):
        self.hz = 850.0
        self.sun = (640.0, 900.0)
        rng = np.random.default_rng(5)
        # wide, non-repeating textures that slide (no wrap seams)
        self.clouds = fx.fbm(H // 4, (W + 1400) // 4, seed=31, base=4, octaves=6)
        self.clouds2 = fx.fbm(H // 4, (W + 1400) // 4, seed=32, base=7, octaves=5)
        self.veil = fx.fbm(H // 4, (W + 2600) // 4, seed=33, base=9, octaves=4)
        self.layers = []
        specs = [(874, 22, 230, 0.10, 0.80), (922, 52, 360, 0.20, 0.58), (1012, 110, 520, 0.36, 0.36),
                 (1180, 190, 700, 0.62, 0.16), (1500, 300, 950, 1.00, 0.03)]
        for k, (by, amp, sp, par, hz) in enumerate(specs):
            n = 40
            xs = np.cumsum(rng.uniform(0.7, 1.3, n) * sp) - 3 * sp
            hs = rng.uniform(0.6, 1.0, n) * amp
            wl = rng.uniform(0.42, 0.60, n) * sp     # long windward slope
            wr = rng.uniform(0.22, 0.30, n) * sp     # steeper slip face
            self.layers.append(dict(by=by, amp=amp, xs=xs, hs=hs, wl=wl, wr=wr, par=par, haze=hz, k=k))
        # wind-blown sand: particles lift off the crest peaks visible on screen
        n = 4200
        lay, peak, off = [], [], []
        for _ in range(n):
            k = rng.choice([2, 3, 4], p=[0.3, 0.4, 0.3])
            L = self.layers[k]
            px = L["xs"] - 26.0 * 4 * L["par"] - 140 * k
            vis = np.where((px > -150) & (px < W + 250))[0]
            j = rng.choice(vis)
            lay.append(k); peak.append(j)
            off.append(rng.uniform(-0.30, 0.04) * L["wl"][j] / 0.5)
        self.sp_layer, self.sp_peak, self.sp_off = np.array(lay), np.array(peak), np.array(off)
        self.sp_t0 = rng.uniform(0, 15, n)
        self.sp_life = rng.uniform(0.9, 2.4, n)
        self.sp_vx = -rng.uniform(140, 300, n)
        self.sp_vy = -rng.uniform(14, 70, n)
        self.sp_ph = rng.uniform(0, 6.28, n)
        self.sp_b = rng.uniform(0.3, 1.0, n)
        self.dune_tex = fx.fbm(H // 2, W // 2, seed=44, base=6, octaves=4)
        self.dune_tex = fx.up(self.dune_tex)

    def ridge(self, L, x):
        d = x[:, None] - L["xs"][None, :]
        w = np.where(d < 0, L["wl"][None, :], L["wr"][None, :])
        b = L["hs"][None, :] * np.exp(-np.abs(d / w) ** 1.7)
        k = 7.0 / L["amp"]                      # soft max: rounded interdune valleys
        m = b.max(axis=1, keepdims=True)
        prof = (m + np.log(np.exp(k * (b - m)).sum(axis=1, keepdims=True)) / k)[:, 0]
        return L["by"] - prof

    def render(self, t, light):
        hz = self.hz
        sx, sy = self.sun
        dawn = 0.45 + 0.55 * fx.ease(t / 7.5)      # the light slowly gains ground
        img = np.zeros((H, W, 3), np.float32)
        # ---- sky (only rows above the dunes)
        R = int(hz + 120)
        YY, XX = fx.YY[:R], fx.XX[:R]
        v = np.clip(YY / hz, 0, 1)
        sky = (np.float32([0.0075, 0.0085, 0.011]) * (1 - v[..., None]) +
               np.float32([0.060, 0.032, 0.014]) * (v[..., None] ** 4))
        d_sun = np.sqrt((XX - sx) ** 2 + ((YY - sy) * 3.0) ** 2)
        glow = np.exp(-d_sun / 70) * 4.0 + np.exp(-d_sun / 260) * 0.55 + np.exp(-d_sun / 700) * 0.06
        sky += glow[..., None] * (GOLD_L * 0.6 + AMBER * 0.4) * dawn
        o1, o2 = int(t * 22 / 4), int(t * 40 / 4)
        c = self.clouds[:, o1:o1 + W // 4] * 0.65 + self.clouds2[:, o2:o2 + W // 4] * 0.35
        cu = fx.up(c, (W, H))[:R]
        dens = fx.smoothstep(0.38, 0.66, cu)
        edge = fx.smoothstep(0.30, 0.45, cu) * (1 - fx.smoothstep(0.45, 0.62, cu))   # sun-lit fringes
        vmask = fx.smoothstep(0.0, 0.30, v) * (1 - fx.smoothstep(0.88, 1.0, v))
        dens = dens * vmask
        near_sun = np.exp(-d_sun / 520)[..., None]
        under = near_sun * (GOLD * 0.8 + AMBER * 0.4) * 0.35 * dawn
        cloud_col = np.float32([0.0022, 0.0022, 0.0026]) + under * (1 - cu[..., None])
        sky = sky * (1 - dens[..., None] * 0.97) + cloud_col * dens[..., None]
        sky += (edge * vmask)[..., None] * near_sun * GOLD * 0.22 * dawn
        q = fx.down(sky, 4)
        lum = q.max(axis=2, keepdims=True)
        src = q * np.clip((lum - 0.05) / (lum + 1e-4), 0, None)
        rays = fx.up(fx.radial_streaks(src, sx / 4, sy / 4, length=1.6, samples=26), (W, R))
        img[:R] = sky + rays * 0.7

        # ---- dunes, painted far to near; each layer only where it can be seen
        pan = t * 26.0
        X = np.arange(W, dtype=np.float32)
        ridges = [self.ridge(L, X + pan * L["par"] + 140 * L["k"]) for L in self.layers]
        sunside = np.exp(-np.abs(X - sx) / 480)[None, :]
        for k, L in enumerate(self.layers):
            r = ridges[k]
            y0 = int(max(0, np.floor(r.min()) - 2))
            y1 = H if k == len(self.layers) - 1 else int(min(H, np.ceil(ridges[k + 1].max()) + 2))
            if y1 <= y0:
                continue
            YY = fx.YY[y0:y1]
            dd = np.maximum(YY - r[None, :], 0)
            a = np.clip(YY - r[None, :] + 0.5, 0, 1)
            depth = np.clip(dd / (L["amp"] * 1.4 + 50), 0, 1)
            base = np.float32([0.016, 0.010, 0.006]) * (1 - L["haze"]) + \
                np.float32([0.085, 0.050, 0.026]) * L["haze"]
            tex = 1 + (self.dune_tex[y0:y1] - 0.5) * 0.4
            ripples = 1.0
            if L["k"] >= 3:
                ripples = 1 + 0.08 * np.sin((X[None, :] + pan * L["par"]) * 0.09 + dd * 0.30 +
                                            self.dune_tex[y0:y1] * 10) * np.clip(dd / 60, 0, 1)
            shade = (1.25 - 0.75 * depth) * tex * ripples
            rimw = 2.2 + 2.2 * L["k"]
            rim = np.exp(-dd / rimw) * sunside * (1.25 - 0.17 * L["k"])
            sheen = np.exp(-dd / (rimw * 9)) * sunside * 0.22
            col = base[None, None, :] * shade[..., None] + \
                ((rim + sheen) * dawn)[..., None] * (GOLD * 0.65 + AMBER * 0.25)
            img[y0:y1] = img[y0:y1] * (1 - a[..., None]) + col * a[..., None]

        # ---- sand torn from the crests by the wind (motion-blurred streaks)
        sand = np.zeros((H, W), np.float32)
        age = np.mod(t - self.sp_t0, 15.0)
        idx = np.where(age < self.sp_life)[0]
        if len(idx):
            a_ = age[idx]
            lay = self.sp_layer[idx]
            par = np.array([self.layers[k]["par"] for k in lay], np.float32)
            x_spawn = np.array([self.layers[k]["xs"][j] for k, j in zip(lay, self.sp_peak[idx])]) \
                - pan * par - 140 * lay + self.sp_off[idx]
            y_spawn = np.empty(len(idx), np.float32)
            for k in (2, 3, 4):
                m = lay == k
                if m.any():
                    xi = np.clip(x_spawn[m], 0, W - 1).astype(np.int64)
                    y_spawn[m] = ridges[k][xi] + 1.5
            vx = self.sp_vx[idx] * (0.35 + 0.65 * par)
            vy = self.sp_vy[idx] * (0.5 + 0.5 * par)
            x = x_spawn + vx * a_
            y = y_spawn + vy * a_ + 4 * a_ ** 2 + 4 * np.sin(a_ * 4 + self.sp_ph[idx]) * a_
            life = np.clip(a_ / self.sp_life[idx], 0, 1)
            env = (1 - life) ** 1.5 * np.clip(a_ * 6, 0, 1) * self.sp_b[idx] * (0.35 + 0.9 * par)
            for st in np.linspace(0, 1, 10):
                fx.splat(sand, x - vx * st / 11.0, y - vy * st / 11.0, env * 0.11)
            sand = cv2.GaussianBlur(sand, (0, 0), 1.8)
        sun_w = np.exp(-np.abs(fx.XX - sx) / 560)[..., None]
        img += sand[..., None] * (AMBER * 0.30 + GOLD_L * 0.9 * sun_w) * (0.5 + 0.5 * dawn)
        # ---- low drifting dust veils racing with the wind
        o3 = int(t * 150 / 4)
        veil = self.veil[:, o3:o3 + W // 4]
        veil = fx.up(fx.smoothstep(0.45, 0.95, veil), (W, H))
        vm = fx.smoothstep(hz - 40, hz + 700, fx.YY)
        img += (veil * vm * (0.018 + 0.03 * sun_w[..., 0]))[..., None] * AMBER * (0.6 + 0.4 * dawn)
        return img * light


# ---------------------------------------------------------------------------
class Sanctuary:
    """Scene 3 - a monumental iwan in dark green stone; golden light streams
    through a star-lattice window."""

    S = 1.12  # oversize for the slow push-in

    def __init__(self):
        S = self.S
        self.w, self.h = int(W * S), int(H * S)
        w, h = self.w, self.h
        ox, oy = (w - W) / 2, (h - H) / 2
        self.ox, self.oy = ox, oy
        Y, X = np.mgrid[0:h, 0:w].astype(np.float32)
        cx = w / 2
        self.win = (cx, oy + 560.0)
        pat = _pattern_tex(1024, 5, 3)
        pat = np.tile(pat, (math.ceil(h / 1024), math.ceil(w / 1024)))[:h, :w]

        base = np.float32([0.006, 0.020, 0.016])
        img = np.ones((h, w, 3), np.float32) * base
        wallglow = np.exp(-(((X - cx) / 650) ** 2 + ((Y - self.win[1]) / 900) ** 2))
        img += wallglow[..., None] * GREEN * 0.10
        img += (pat * (0.010 + 0.035 * wallglow))[..., None] * GOLD

        def arch(hw, sp, ap, fl, extra=0):
            pts = geo.pointed_arch(hw, sp, ap, fl, n=72)
            pts[:, 0] += cx
            pts[:, 1] += oy
            return pts

        # alfiz frame + outer arch band
        alfiz = np.zeros((h, w), np.uint8)
        cv2.rectangle(alfiz, (int(cx - 452), int(oy + 190)), (int(cx + 452), int(oy + 1640)), 255, 4, cv2.LINE_AA)
        cv2.rectangle(alfiz, (int(cx - 432), int(oy + 210)), (int(cx + 432), int(oy + 1640)), 255, 2, cv2.LINE_AA)
        outer = arch(372, 820, 300, 1640)
        inner = arch(318, 830, 372, 1640)
        m_out = np.zeros((h, w), np.uint8); geo.fill(m_out, outer)
        m_in = np.zeros((h, w), np.uint8); geo.fill(m_in, inner)
        band = (m_out.astype(np.float32) - m_in) / 255
        edge = np.zeros((h, w), np.uint8)
        geo.stroke(edge, outer, 3); geo.stroke(edge, inner, 3)
        geo.stroke(edge, arch(346, 825, 336, 1640), 1)
        niche = m_in.astype(np.float32) / 255

        # spandrel lattice is brighter, band is carved stone
        img = img * (1 - band[..., None]) + band[..., None] * (np.float32([0.010, 0.030, 0.024]) +
                                                               (pat * 0.05)[..., None] * GOLD)
        # recessed niche: deep green-black with muqarnas tiers near the top
        nshade = np.clip((Y - (oy + 372)) / 1200, 0, 1)
        niche_col = np.float32([0.004, 0.016, 0.013])[None, None, :] * (1.4 - 0.6 * nshade[..., None])
        img = img * (1 - niche[..., None]) + niche_col * niche[..., None]
        muq = np.zeros((h, w), np.uint8)
        for row, (yy, hw_, cnt) in enumerate([(660, 44, 7), (760, 40, 9), (850, 36, 11)]):
            for k in range(cnt):
                x_ = cx + (k - (cnt - 1) / 2) * hw_ * 1.9
                if abs(x_ - cx) > 300 - hw_:
                    continue
                if row == 0 and abs(x_ - cx) < 150:
                    continue
                p = geo.pointed_arch(hw_, 0, -hw_ * 1.25, hw_ * 0.6, n=20)
                p[:, 0] += x_; p[:, 1] += oy + yy
                geo.stroke(muq, p, 2)
        img += (muq.astype(np.float32) / 255 * niche * 0.06)[..., None] * GOLD
        img += ((alfiz.astype(np.float32) + edge) / 255 * 0.10)[..., None] * GOLD

        # columns flanking the iwan
        for xc in (cx - 470, cx + 470):
            col = np.zeros((h, w), np.uint8)
            cv2.rectangle(col, (int(xc - 34), int(oy + 900)), (int(xc + 34), int(oy + 1640)), 255, -1, cv2.LINE_AA)
            cv2.rectangle(col, (int(xc - 50), int(oy + 860)), (int(xc + 50), int(oy + 905)), 255, -1, cv2.LINE_AA)
            cv2.rectangle(col, (int(xc - 50), int(oy + 1600)), (int(xc + 50), int(oy + 1640)), 255, -1, cv2.LINE_AA)
            cm = col.astype(np.float32)[..., None] / 255
            shade = np.clip(1 - np.abs(X - xc) / 50, 0, 1)[..., None]
            img = img * (1 - cm) + cm * (np.float32([0.006, 0.016, 0.013]) + GOLD * 0.05 * shade ** 3)

        # floor
        fl = oy + 1640
        floor = np.clip((Y - fl) * 0.5, 0, 1)
        fz = np.clip((Y - fl) / 500, 0, 1)
        img = img * (1 - floor[..., None]) + floor[..., None] * np.float32([0.004, 0.012, 0.010]) * (1 + fz[..., None])
        self.floor_y = fl
        self.base = img.astype(np.float32)

        # star-lattice window = the light source
        wx, wy = self.win
        wm = np.zeros((h, w), np.uint8)
        cv2.circle(wm, (int(wx), int(wy)), 118, 255, -1, cv2.LINE_AA)
        lat = geo.star_lattice(256, 2, 67.5, 6)
        lat = cv2.resize(lat, (236, 236), interpolation=cv2.INTER_AREA)
        lat_full = np.zeros((h, w), np.float32)
        lat_full[int(wy) - 118:int(wy) + 118, int(wx) - 118:int(wx) + 118] = lat / 255
        self.window = (wm.astype(np.float32) / 255) * (1 - 0.93 * lat_full)
        ring = np.zeros((h, w), np.uint8)
        cv2.circle(ring, (int(wx), int(wy)), 126, 255, 6, cv2.LINE_AA)
        self.base += (ring.astype(np.float32) / 255 * 0.25)[..., None] * GOLD
        # side beams from high windows (soft wedges)
        beams = np.zeros((h // 4, w // 4), np.float32)
        for (xa, xb, xc, xd, inten) in [(-160, -40, 420, 600, 0.8), (w + 160, w + 40, w - 420, w - 600, 0.6)]:
            poly = np.array([[xa, oy - 40], [xb, oy - 60], [xd, fl + 60], [xc, fl + 90]], np.float32) / 4
            cv2.fillPoly(beams, [poly.astype(np.int32)], inten, cv2.LINE_AA)
        beams = cv2.GaussianBlur(beams, (0, 0), 9)
        stripes = fx.fbm(h // 4, w // 4, seed=77, base=24, octaves=2)
        self.beams = cv2.resize(beams * (0.6 + 0.8 * stripes), (w, h))
        self.dust = fx.Dust(700, seed=91, box=((-700, 700), (-1100, 900), (0.6, 4.0)), drift=(-6.0, 10.0),
                            focal=1.0)

    def render(self, t, light, dur):
        w, h = self.w, self.h
        flick = 0.92 + 0.08 * math.sin(t * 0.9) * math.sin(t * 0.37 + 1)
        rise = light
        img = self.base * (0.55 + 0.45 * rise)
        win = self.window * rise * flick
        img = img + win[..., None] * GOLD_L * 2.4
        # near-parallel shafts from a light point high above the window
        q = fx.down(win[..., None] * GOLD_L * 3.0, 4)
        wx, wy = self.win
        q = cv2.GaussianBlur(q, (0, 0), 1.2)
        shafts = fx.radial_streaks(q, wx / 4, (wy - 700) / 4, length=1.7, samples=72, falloff=1.0)
        shafts = fx.up(cv2.GaussianBlur(shafts, (0, 0), 1.0), (w, h))
        fade_down = np.clip(1 - (np.arange(h, dtype=np.float32) - wy) / 1150, 0.06, 1)[:, None, None] ** 1.5
        img += shafts * 0.55 * fade_down
        bm = self.beams * (0.8 + 0.2 * math.sin(t * 0.6 + 0.4)) * rise
        img += bm[..., None] * GOLD * 0.07
        # light pool + reflection on the floor
        Y = np.arange(h, dtype=np.float32)[:, None]
        X = np.arange(w, dtype=np.float32)[None, :]
        pool = np.exp(-(((X - wx) / 260) ** 2 + ((Y - self.floor_y - 120) / 70) ** 2)) * (Y > self.floor_y)
        refl = np.exp(-((X - wx) / (50 + 0.4 * np.maximum(Y - self.floor_y, 0))) ** 2) * \
            np.exp(-np.maximum(Y - self.floor_y, 0) / 160) * (Y > self.floor_y)
        img += ((pool * 0.25 + refl * 0.6) * rise * flick)[..., None] * GOLD

        # camera: slow push-in toward the window with a slight upward tilt
        k = t / max(dur, 1e-3)
        zoom = 1.0 + 0.075 * fx.ease(k * 0.5 + 0.25) - 0.075 * fx.ease(0.25)
        fx_, fy_ = wx, self.oy + 900 - 40 * k
        M = np.float32([[zoom, 0, W / 2 - fx_ * zoom], [0, zoom, H / 2 + 0 - fy_ * zoom]])
        frame = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        # dust floating in the light
        sm = fx.down(cv2.warpAffine(shafts.max(axis=2) + bm * 0.5, M, (W, H)), 8)
        dust = self.dust.render(t, 0.05 * t, W / 2, H / 2 - 150,
                                lambda x, y: 0.05 + 3.0 * fx.sample_map(sm, x, y), gain=0.8 * rise)
        frame += dust[..., None] * GOLD_L
        return frame


# ---------------------------------------------------------------------------
class GoldenDust:
    """Scene 4 - closing card: black, a thin khatam ornament, fading gold motes."""

    def __init__(self):
        self.dust = fx.Dust(420, seed=123, box=((-700, 700), (-1100, 1100), (0.7, 3.5)),
                            drift=(0.0, -20.0), focal=1.0)
        orn = np.zeros((H, W), np.uint8)
        cx, cy = W / 2, C.CLOSING_CENTER_Y - 205
        for sq in geo.star8(cx, cy, 30):
            geo.stroke(orn, sq, 2, closed=True)
        cv2.circle(orn, (int(cx), int(cy)), 9, 255, 2, cv2.LINE_AA)
        for sgn in (-1, 1):
            p = np.array([[cx + sgn * 52, cy], [cx + sgn * 250, cy]], np.float64)
            geo.stroke(orn, p, 2)
            cv2.circle(orn, (int(cx + sgn * 262), int(cy)), 4, 255, -1, cv2.LINE_AA)
        orn = orn.astype(np.float32) / 255
        self.ornament = orn
        self.orn_glow = cv2.GaussianBlur(orn, (0, 0), 6)
        self.cx, self.cy = cx, cy

    def render(self, t, light, motes):
        img = np.zeros((H, W, 3), np.float32)
        r2 = (fx.XX - W / 2) ** 2 + (fx.YY - C.CLOSING_CENTER_Y) ** 2
        img += (np.exp(-r2 / (2 * 520 ** 2)) * 0.020)[..., None] * AMBER * light
        sweep = fx.smoothstep(0, 1, np.float32(fx.ease(t / 1.8)) * 1.15 - np.abs(fx.XX - W / 2) / 270 * 0.8)
        shimmer = 0.85 + 0.15 * math.sin(t * 1.4)
        img += ((self.ornament * 1.2 + self.orn_glow * 0.9) * sweep * shimmer * light)[..., None] * GOLD
        dust = self.dust.render(t, 0.02 * t, W / 2, H / 2, lambda x, y: np.full_like(x, 0.55), gain=motes)
        img += dust[..., None] * GOLD_L
        return img
