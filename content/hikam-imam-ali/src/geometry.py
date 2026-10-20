"""Islamic geometry: pointed arches and an 8-fold star lattice (Hankin's
polygons-in-contact method on the 4.8.8 tiling)."""
import math

import cv2
import numpy as np


def pointed_arch(half_w, spring_y, apex_y, floor_y, n=48):
    """Outline (x, y) of a two-centred pointed arch opening, centred at x=0.
    y grows downward; spring_y > apex_y."""
    A = spring_y - apex_y
    d = max((A * A - half_w * half_w) / (2 * half_w), 0.0)
    r = half_w + d
    a0, a1 = math.pi, math.atan2(-A, -d) + 2 * math.pi
    left = [(d + r * math.cos(a), spring_y + r * math.sin(a))
            for a in np.linspace(a0, a1, n)]
    right = [(-x, y) for x, y in reversed(left)]
    pts = [(-half_w, floor_y)] + left + right[1:] + [(half_w, floor_y)]
    return np.array(pts, np.float64)


def place(pts, s, cx, cy):
    out = np.empty_like(pts)
    out[:, 0] = cx + pts[:, 0] * s
    out[:, 1] = cy + pts[:, 1] * s
    return out


def fill(mask, pts, value=255):
    """Anti-aliased polygon fill with sub-pixel precision (mask uint8)."""
    cv2.fillPoly(mask, [np.round(pts * 16).astype(np.int32)], value, cv2.LINE_AA, shift=4)


def stroke(mask, pts, thickness, value=255, closed=False):
    cv2.polylines(mask, [np.round(pts * 16).astype(np.int32)], closed, value, thickness, cv2.LINE_AA, shift=4)


def _hankin(poly, theta):
    """Segments produced inside one polygon (CCW in a y-down frame is fine)."""
    n = len(poly)
    segs = []
    c = poly.mean(0)
    mids, dirs = [], []
    for k in range(n):
        a, b = poly[k], poly[(k + 1) % n]
        e = (b - a) / np.linalg.norm(b - a)
        mids.append((a + b) / 2)
        dirs.append(e)
    for k in range(n):
        m1, e1 = mids[k], dirs[k]
        m2, e2 = mids[(k + 1) % n], dirs[(k + 1) % n]
        # ray from m1 leaning forward/inward, ray from m2 leaning backward/inward
        def rot(v, ang):
            ca, sa = math.cos(ang), math.sin(ang)
            return np.array([ca * v[0] - sa * v[1], sa * v[0] + ca * v[1]])
        inward = c - m1
        sgn = 1 if (e1[0] * inward[1] - e1[1] * inward[0]) > 0 else -1
        d1 = rot(e1, sgn * theta)
        d2 = rot(-e2, -sgn * theta)
        Mtx = np.array([d1, -d2]).T
        try:
            t, _ = np.linalg.solve(Mtx, m2 - m1)
        except np.linalg.LinAlgError:
            continue
        X = m1 + d1 * t
        segs.append((m1, X))
        segs.append((X, m2))
    return segs


def star_lattice(tile_px=1024, cells=4, theta_deg=67.5, thickness=3):
    """Seamless tile (uint8, tile_px square) with an 8-fold star pattern."""
    a = tile_px / cells                          # octagon centre spacing
    s = a / (1 + math.sqrt(2))                   # edge length
    R = s / (2 * math.sin(math.pi / 8))          # octagon circumradius
    theta = math.radians(theta_deg)
    polys = []
    for i in range(-1, cells + 2):
        for j in range(-1, cells + 2):
            cx, cy = i * a, j * a
            octo = np.array([(cx + R * math.cos(math.pi / 8 + k * math.pi / 4),
                              cy + R * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)])
            polys.append(octo)
            qx, qy = cx + a / 2, cy + a / 2
            rq = s / math.sqrt(2)
            sq = np.array([(qx + rq * math.cos(k * math.pi / 2), qy + rq * math.sin(k * math.pi / 2))
                           for k in range(4)])
            polys.append(sq)
    img = np.zeros((tile_px, tile_px), np.uint8)
    for p in polys:
        for p1, p2 in _hankin(p, theta):
            cv2.line(img, (int(round(p1[0] * 16)), int(round(p1[1] * 16))),
                     (int(round(p2[0] * 16)), int(round(p2[1] * 16))), 255, thickness, cv2.LINE_AA, shift=4)
    return img


def star8(cx, cy, r, inner=0.0):
    """Two overlapping squares (khatam) outline points (closed polygons)."""
    sq1 = np.array([(cx + r * math.cos(k * math.pi / 2), cy + r * math.sin(k * math.pi / 2)) for k in range(4)])
    sq2 = np.array([(cx + r * math.cos(math.pi / 4 + k * math.pi / 2),
                     cy + r * math.sin(math.pi / 4 + k * math.pi / 2)) for k in range(4)])
    return sq1, sq2
