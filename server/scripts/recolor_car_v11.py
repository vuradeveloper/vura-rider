"""
Car Recolour Tool v11 - WHITE source cars, any pose
====================================================
What is new in v11 (compared with v10)
  * NO MORE UNPAINTED PARTS: after the core paint mask, a region-growing stage
    paints every smooth, bright, neutral piece that touches the body (roof strip
    above the windshield, pillars, mirror halves, hood lip, bumper lips, roof rails).
    Chrome-looking pieces (grille, badges, lamps, plate, wheels, glass) stay as is.
  * Thin panel-gap lines and the dotted white outlines are painted over.
  * White halo on the silhouette is replaced by real paint colour.
  * REALISM: edge-preserving denoise (no blotchy patches), sky / horizon / ground
    environment reflection driven by a Fresnel-like term (dark paints now look
    glossy instead of flat), soft-box streak, clear-coat glints.
  * Stronger cut-out: default model isnet-general-use, optional --matting, and a
    GrabCut fallback if rembg is not installed.
  * --keep-trim keeps thin chrome window trim silver; default paints it.

Older notes (v10)
  * EDGE FIX: white fringes / dotted outlines are gone. Edge pixels are
    "un-mixed" from the white background, recoloured, then re-composited, and
    the paint/not-paint decision is propagated from the car interior to the
    edge band (so a roof highlight is never left white).
  * THIN BRIGHT STRIPS (hood lip, bonnet edge, roof rails, mirror caps) that sit
    between dark parts are now painted. v9 protected them by mistake.
  * REALISM: richer shadows (colour saturates as it darkens), white clear-coat
    highlights that are not tinted, optional environment reflection on flat
    clipped areas, and soft mask edges.
  * Works with PNGs that already have transparency (uses your alpha, skips rembg).
  * Batch mode writes a review.txt listing images whose result looks suspicious,
    so you only have to check those few by eye.

Usage
    python recolor_car_v11.py car.png red
    python recolor_car_v11.py car.png "#1E4FA3" out.png
    python recolor_car_v11.py car.png black --debug      (also *_debug.png and *_mask.png)
    python recolor_car_v11.py car.png red --mask my_mask.png
    python recolor_car_v11.py car.png red --keep-trim   (leave thin chrome window trim silver)

Batch (whole DB folder, several colours each):
    python recolor_car_v11.py --batch whites_folder out_folder red,black,silver,blue,grey

Tuning (open *_debug.png: green = recoloured, red = protected)
    --depth 0.80      paint darkness (lower = darker, 1.0 = none)
    --gloss 1.3       shininess (0 flat ... 2 very glossy)
    --glass-top 0.60  fraction of car height (from top) where glass can exist
    --reflect 0.35    sky/ground reflection added to flat clipped areas (0 = off)
    --grow 1.0        how far unpainted bright body parts are pulled in (0 = off, 1.5 = more)
    --keep-trim       thin chrome strips next to the glass stay silver
    --matting         soft alpha matting on the cut-out (slower, cleaner edges)
    --model birefnet-general   strongest rembg model if the outline is poor

Install
    pip install rembg onnxruntime scikit-image scipy pillow numpy opencv-python-headless
"""

import os
import sys
import argparse
import numpy as np
from PIL import Image, ImageFilter

PALETTE = {
    "white": "#F2F2F2", "black": "#141416", "silver": "#A9AEB3",
    "grey": "#5F646A", "gray": "#5F646A", "red": "#A31F1F",
    "blue": "#173C80", "green": "#245F29", "brown": "#553A2F",
    "gold": "#A8841F", "orange": "#C85A00", "yellow": "#D9A90B",
    "beige": "#BBA780",
}

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def parse_color(s):
    s = s.strip().lower()
    h = PALETTE.get(s, s).lstrip("#")
    if len(h) != 6:
        raise ValueError(f"Unknown colour '{s}'. Use a palette name or #RRGGBB")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * (c ** (1 / 2.4)) - 0.055)


# --------------------------------------------------------------------------
# Step 1: silhouette
# --------------------------------------------------------------------------
_SESSIONS = {}


def _grabcut_mask(img_rgb):
    """Fallback cut-out when rembg is missing: GrabCut seeded from the background colour."""
    import cv2
    arr = np.array(img_rgb)
    h, w = arr.shape[:2]
    bg = estimate_bg(arr, np.zeros((h, w), np.uint8))
    diff = np.abs(arr.astype(np.float32) - bg).max(axis=2)
    gc = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
    gc[diff > 30] = cv2.GC_PR_FGD
    gc[diff > 90] = cv2.GC_FGD
    k = max(3, int(0.01 * w))
    gc[:k, :] = gc[-k:, :] = gc[:, :k] = gc[:, -k:] = cv2.GC_BGD
    bgd, fgd = np.zeros((1, 65)), np.zeros((1, 65))
    cv2.grabCut(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR), gc, None, bgd, fgd, 4,
                cv2.GC_INIT_WITH_MASK)
    car = (gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)
    return (car * 255).astype(np.uint8)


def get_car_mask(img_rgb, model="isnet-general-use", matting=False):
    from scipy.ndimage import label, binary_fill_holes
    try:
        from rembg import new_session, remove
        if model not in _SESSIONS:
            _SESSIONS[model] = new_session(model)
        kw = {}
        if matting:
            kw = dict(alpha_matting=True, alpha_matting_foreground_threshold=240,
                      alpha_matting_background_threshold=15,
                      alpha_matting_erode_size=6)
        rgba = np.array(remove(img_rgb, session=_SESSIONS[model], **kw))
        alpha = rgba[:, :, 3]
    except ImportError:
        print("    rembg not installed -> using GrabCut fallback (pip install rembg is better)")
        alpha = _grabcut_mask(img_rgb)
    car = alpha > 128
    car = binary_fill_holes(car)
    lab, n = label(car)
    if n > 1:
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        car = lab == sizes.argmax()
        alpha = np.where(binary_dilate_simple(car, 6), alpha, 0).astype(np.uint8)
    return car, alpha


def binary_dilate_simple(m, n):
    from scipy.ndimage import binary_dilation
    return binary_dilation(m, iterations=n)


# --------------------------------------------------------------------------
# Step 1b: remove background contamination from edge pixels
# --------------------------------------------------------------------------
def estimate_bg(arr, alpha):
    h, w = alpha.shape
    pts = np.concatenate([arr[:5, :].reshape(-1, 3), arr[-5:, :].reshape(-1, 3),
                          arr[:, :5].reshape(-1, 3), arr[:, -5:].reshape(-1, 3)])
    return np.median(pts, axis=0).astype(np.float32)


def decontaminate(arr, alpha, car, r, bg):
    """Edge pixels are  a*paint + (1-a)*bg.  Solve for the paint colour."""
    from skimage.morphology import disk
    from scipy.ndimage import binary_erosion
    a = alpha.astype(np.float32) / 255.0
    interior = binary_erosion(car, structure=disk(r(3)))
    band = (a > 0.02) & (a < 0.98) & ~interior
    fg = arr.astype(np.float32).copy()
    if band.any():
        ab = a[band][:, None]
        fg[band] = (fg[band] - (1 - ab) * bg) / np.maximum(ab, 0.2)
    return np.clip(fg, 0, 255).astype(np.uint8), interior


# --------------------------------------------------------------------------
# Step 2a: glass
# --------------------------------------------------------------------------
def get_glass_mask(dark, car, r, glass_top):
    from skimage.morphology import disk
    from skimage.measure import label, regionprops
    from scipy.ndimage import binary_closing, binary_dilation

    ys, xs = np.where(car)
    top, bot = ys.min(), ys.max()
    limit_y = top + glass_top * (bot - top)
    car_area = float(car.sum())

    merged = binary_closing(dark, structure=disk(r(5))) & car
    lab = label(merged, connectivity=2)
    glass = np.zeros_like(car)
    for p in regionprops(lab):
        if p.area < 0.004 * car_area:
            continue
        if p.centroid[0] > limit_y:
            continue
        if p.area_convex > 0.22 * car_area:
            continue
        if p.solidity < 0.40:
            continue
        y0, x0, y1, x1 = p.bbox
        glass[y0:y1, x0:x1] |= p.image_convex
    glass &= car
    return binary_dilation(glass, structure=disk(r(1))) & car


# --------------------------------------------------------------------------
# Step 2b: paint mask
# --------------------------------------------------------------------------
def get_paint_mask(arr, car, loose, interior, glass_top=0.60, grow=1.0,
                   keep_trim=False):
    from skimage.color import rgb2hsv
    from skimage.morphology import disk
    from scipy.ndimage import (binary_fill_holes, label, binary_dilation,
                               binary_closing, binary_opening,
                               distance_transform_edt)

    h, w = car.shape
    s = max(w / 1000.0, 0.3)
    r = lambda v: max(1, int(round(v * s)))        # noqa: E731

    hsv = rgb2hsv(arr.astype(np.float32) / 255.0)
    S, V = hsv[:, :, 1], hsv[:, :, 2]
    car_area = float(car.sum())
    ys_, _ = np.where(car)
    top, bot = ys_.min(), ys_.max()

    cand = car & (S < 0.25)
    vref = float(np.percentile(V[cand], 85)) if cand.sum() > 50 else 0.9

    dark = car & (V < max(0.28, 0.40 * vref))
    dark_c = binary_closing(dark, structure=disk(r(3))) & car

    upper = np.zeros_like(car)
    upper[: int(top + glass_top * (bot - top)) + 1, :] = True
    greyish = binary_opening(car & upper & (V < 0.68 * vref), structure=disk(r(1)))
    glass = get_glass_mask(dark_c | greyish, car, r, glass_top)

    # side-mirror caps
    mirrors = np.zeros_like(car)
    cand_m = glass & ~dark_c & (V > 0.80 * vref) & (S < 0.12)
    cand_m = binary_opening(cand_m, structure=disk(r(1)))
    ml, mn = label(cand_m)
    for i in range(1, mn + 1):
        reg = ml == i
        a = int(reg.sum())
        if not (0.0008 * car_area <= a <= 0.03 * car_area):
            continue
        ys, xs = np.where(reg)
        fill = a / float((np.ptp(ys) + 1) * (np.ptp(xs) + 1))
        if V[reg].std() < 0.09 and fill > 0.45:
            mirrors |= reg
    mirrors = binary_dilation(mirrors, structure=disk(r(1))) & car & ~dark_c
    glass &= ~mirrors

    # regions enclosed by dark pixels: lamps, plate, badges  vs  painted strips
    filled = binary_fill_holes(dark_c)
    enclosed = filled & ~dark_c
    lab, n = label(enclosed)
    not_paint = dark_c | glass
    for i in range(1, n + 1):
        reg = lab == i
        a = int(reg.sum())
        if a >= 0.25 * car_area:
            continue
        ys, xs = np.where(reg)
        fill = a / float((np.ptp(ys) + 1) * (np.ptp(xs) + 1))
        cy = (ys.mean() - top) / max(bot - top, 1)          # 0 = roof, 1 = ground
        smooth_bright = (0.0008 * car_area <= a <= 0.05 * car_area
                         and V[reg].mean() > 0.80 * vref
                         and V[reg].std() < 0.12
                         and S[reg].mean() < 0.12)
        plate_like = fill > 0.80 or cy > 0.62               # number plate area
        if not (smooth_bright and not plate_like):
            not_paint |= reg
    not_paint |= binary_opening(filled, structure=disk(r(2))) & dark_c
    not_paint &= ~mirrors

    # amber indicators, tail lamps, badges
    not_paint |= car & (S > 0.30) & (V > 0.20)

    paint = car & ~not_paint
    paint &= V > 0.32 * vref
    paint = binary_opening(paint, structure=disk(r(1)))

    lab, n = label(paint)
    if n:
        sizes = np.bincount(lab.ravel())
        keep = sizes >= max(40, 0.0015 * car_area)
        keep[0] = False
        paint = keep[lab]
    paint |= mirrors

    # refill reflection speckles on the body
    holes = binary_fill_holes(paint) & ~paint
    hl, hn = label(holes)
    for i in range(1, hn + 1):
        reg = hl == i
        if reg.sum() < 0.008 * car_area and not (reg & (glass | dark_c)).any():
            paint |= reg
    paint &= ~glass & ~dark_c

    # close small gaps between paint pieces (bright highlights split the mask)
    closed = binary_closing(paint, structure=disk(r(2))) & car & ~dark_c & ~glass
    paint |= closed

    # bright thin strips hugging the paint (roof edge, hood lip, mirror rims)
    near = binary_dilation(paint, structure=disk(r(4)))
    bright = car & (S < 0.18) & (V > 0.72 * vref) & ~dark_c & ~glass
    rec = near & bright & ~paint
    rl, rn = label(rec)
    for i in range(1, rn + 1):
        reg = rl == i
        if reg.sum() < 0.02 * car_area:
            paint |= reg
    paint |= mirrors
    paint &= car & ~dark_c & ~glass

    # --- v11: pull in every remaining smooth bright body piece, then close gaps
    if grow > 0:
        paint = grow_paint(paint, car, glass, dark_c, S, V, vref, r, top, bot,
                           car_area, keep_trim, grow)
    paint = fill_thin(paint, car, glass, dark_c, r)
    paint &= car

    # --- EDGE FIX: copy the decision from the nearest interior pixel to the edge band
    band = loose & ~interior
    dist, idx = distance_transform_edt(~interior, return_distances=True,
                                       return_indices=True)
    near_paint = paint[idx[0], idx[1]] & (dist <= r(7))
    ext = (paint & interior) | (band & near_paint & ~dark_c)
    # thin edge pixels that are themselves dark stay protected
    ext &= ~(band & (V < 0.30))
    return ext, glass



# --------------------------------------------------------------------------
# Step 2c: complete the paint mask (this is what fixes the unpainted parts)
# --------------------------------------------------------------------------
def grow_paint(paint, car, glass, dark_c, S, V, vref, r, top, bot, car_area,
               keep_trim, strength):
    """Paint smooth, bright, neutral pieces that touch the body paint.
    Chrome is busy (high local contrast) or sits in dark surroundings, so it is rejected."""
    from scipy.ndimage import (label, find_objects, distance_transform_edt,
                               maximum_filter, minimum_filter, binary_dilation,
                               gaussian_filter)
    from skimage.morphology import disk

    Vs = gaussian_filter(V, 0.6)
    k = 2 * r(2) + 1
    rng = maximum_filter(Vs, size=k) - minimum_filter(Vs, size=k)
    neutral = car & (S < 0.22) & (Vs > 0.38 * vref) & ~dark_c & ~glass & ~paint
    cand = neutral & (rng < 0.20)
    cand = binary_dilation(cand, structure=disk(1), iterations=r(1)) & neutral
    dist = distance_transform_edt(~paint)
    cand &= dist <= r(16) * strength

    lab, n = label(cand, structure=np.ones((3, 3)))
    out = paint.copy()
    for i, sl in enumerate(find_objects(lab), 1):
        if sl is None:
            continue
        pad = r(3)
        y0, y1 = max(sl[0].start - pad, 0), min(sl[0].stop + pad, paint.shape[0])
        x0, x1 = max(sl[1].start - pad, 0), min(sl[1].stop + pad, paint.shape[1])
        piece = lab[y0:y1, x0:x1] == i
        area = int(piece.sum())
        if area < 3 or area > 0.035 * car_area:
            continue
        ring = binary_dilation(piece, structure=disk(r(2))) & ~piece
        rs = max(int(ring.sum()), 1)
        contact = (ring & paint[y0:y1, x0:x1]).sum() / rs
        gl_b = (ring & glass[y0:y1, x0:x1]).sum() / rs
        dk_b = (ring & dark_c[y0:y1, x0:x1]).sum() / rs
        ys, _ = np.where(piece)
        cy = (ys.mean() + y0 - top) / max(bot - top, 1)
        width = 2 * distance_transform_edt(piece).max()
        need = 0.30 if cy < 0.70 else 0.55            # number-plate zone is stricter
        if contact < need or dk_b > 0.60:
            continue
        if keep_trim and width <= r(9) and gl_b >= 0.25:
            continue
        out[y0:y1, x0:x1] |= piece

    # ---- trim pass: thin bright strips between body and glass (roof rails, A/B/C
    # pillar caps, window frames). They are busier than flat paint, so the pass above
    # misses them. Skipped with --keep-trim.
    if not keep_trim:
        cand2 = car & (S < 0.25) & (Vs > 0.50 * vref) & ~dark_c & ~glass & ~out
        cand2 &= distance_transform_edt(~out) <= r(10)
        lab2, n2 = label(cand2, structure=np.ones((3, 3)))
        for i, sl in enumerate(find_objects(lab2), 1):
            if sl is None:
                continue
            pad = r(3)
            y0, y1 = max(sl[0].start - pad, 0), min(sl[0].stop + pad, paint.shape[0])
            x0, x1 = max(sl[1].start - pad, 0), min(sl[1].stop + pad, paint.shape[1])
            piece = lab2[y0:y1, x0:x1] == i
            area = int(piece.sum())
            if area < 6 or area > 0.006 * car_area:
                continue
            width = 2 * distance_transform_edt(piece).max()
            if width > r(12):
                continue
            ring = binary_dilation(piece, structure=disk(r(2))) & ~piece
            rs = max(int(ring.sum()), 1)
            contact = (ring & out[y0:y1, x0:x1]).sum() / rs
            gl_b = (ring & glass[y0:y1, x0:x1]).sum() / rs
            ys, _ = np.where(piece)
            cy = (ys.mean() + y0 - top) / max(bot - top, 1)
            if contact >= 0.25 and gl_b >= 0.15 and cy < 0.62:
                out[y0:y1, x0:x1] |= piece
    return out


def fill_thin(paint, car, glass, dark_c, r):
    """Panel-gap lines, dotted white outlines, tiny unpainted islands inside the body."""
    from scipy.ndimage import (label, find_objects, binary_opening,
                               binary_dilation)
    from skimage.morphology import disk
    nonp = car & ~paint
    thin = nonp & ~binary_opening(nonp, structure=disk(r(2))) & ~glass
    thin &= binary_dilation(paint, structure=disk(r(2)))
    lab, n = label(thin, structure=np.ones((3, 3)))
    out = paint.copy()
    for i, sl in enumerate(find_objects(lab), 1):
        if sl is None:
            continue
        pad = r(3)
        y0, y1 = max(sl[0].start - pad, 0), min(sl[0].stop + pad, paint.shape[0])
        x0, x1 = max(sl[1].start - pad, 0), min(sl[1].stop + pad, paint.shape[1])
        piece = lab[y0:y1, x0:x1] == i
        ring = binary_dilation(piece, structure=disk(r(2))) & ~piece
        rs = max(int(ring.sum()), 1)
        if (ring & paint[y0:y1, x0:x1]).sum() / rs >= 0.50 and \
           (ring & glass[y0:y1, x0:x1]).sum() / rs < 0.20:
            out[y0:y1, x0:x1] |= piece
    return out


def fix_edges(rec, fg, paint, car, vref_v, r):
    """Replace bright background-contaminated fringe pixels on the silhouette by
    the recoloured paint just inside the car."""
    from scipy.ndimage import binary_erosion, distance_transform_edt
    from skimage.morphology import disk
    from skimage.color import rgb2hsv
    inner = binary_erosion(car, structure=disk(r(2)))
    src = paint & inner
    if not src.any():
        return rec
    V = rgb2hsv(fg.astype(np.float32) / 255.0)[:, :, 2]
    band = paint & ~inner & (V > 0.55 * vref_v)
    _, idx = distance_transform_edt(~src, return_distances=True, return_indices=True)
    out = rec.copy()
    out[band] = rec[idx[0][band], idx[1][band]]
    return out

# --------------------------------------------------------------------------
# Step 3: recolour in linear light
# --------------------------------------------------------------------------
def _smooth_lum(lum, sc):
    """Edge-preserving denoise: kills JPEG blotches but keeps panel edges."""
    from scipy.ndimage import gaussian_filter
    try:
        import cv2
        l32 = lum.astype(np.float32)
        out = cv2.bilateralFilter(l32, d=0, sigmaColor=0.06, sigmaSpace=2.0 * sc + 1.0)
        return gaussian_filter(out, 0.5 * sc + 0.2)
    except ImportError:
        return gaussian_filter(lum, 1.0 * sc + 0.4)


def _environment(h, w, paint, sc):
    """Fake studio reflection in linear light: sky -> horizon line -> ground,
    plus a soft-box streak. Returns (h, w, 3)."""
    from scipy.ndimage import gaussian_filter
    pys, pxs = np.where(paint)
    y0, y1 = pys.min(), pys.max()
    x0, x1 = pxs.min(), pxs.max()
    t = np.clip((np.arange(h, dtype=np.float32) - y0) / max(y1 - y0, 1), 0, 1)[:, None]
    u = np.clip((np.arange(w, dtype=np.float32) - x0) / max(x1 - x0, 1), 0, 1)[None, :]
    sky_col = np.array([0.80, 0.90, 1.00], np.float32)       # cool sky
    gnd_col = np.array([0.15, 0.16, 0.18], np.float32)       # neutral dark ground
    sky_w = np.clip(1.0 - t / 0.50, 0, 1) ** 0.8              # 1 at the roof, 0 at horizon
    env = sky_w[..., None] * sky_col + (1 - sky_w)[..., None] * gnd_col
    # bright sky-glow just above the horizon, dark horizon band
    glow = np.exp(-((t - 0.40) / 0.08) ** 2)
    horizon = np.exp(-((t - 0.55) / 0.04) ** 2)
    env = env * (1 + 0.35 * glow)[..., None] * (1 - 0.65 * horizon)[..., None]
    # soft-box streak coming from the upper left
    box = np.exp(-(((u - 0.30) / 0.28) ** 2 + ((t - 0.12) / 0.20) ** 2))
    env = env + 0.9 * box[..., None]
    return env.astype(np.float32)


def apply_color(fg, paint, target_rgb, depth=0.80, gloss=1.3, reflect=0.35, name=""):
    from scipy.ndimage import gaussian_filter
    h, w = paint.shape
    f = fg.astype(np.float32) / 255.0
    lin = srgb_to_lin(f)
    lum = lin @ LUMA

    sigma = max(0.7, 1.0 * w / 1000.0)
    m = np.array(Image.fromarray((paint * 255).astype(np.uint8), "L")
                 .filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32) / 255.0
    m = m[..., None]

    sc = max(w / 1000.0, 0.3)
    lum_s = _smooth_lum(lum, sc)
    lref = float(np.percentile(lum_s[paint], 85))
    lhi = float(np.percentile(lum_s[paint], 99))
    shade0 = np.clip(lum_s / max(lref, 1e-4), 0.0, 1.25)

    # gentle local contrast: keeps body lines and panel shape
    detail = shade0 - gaussian_filter(shade0, 7 * sc)
    shade = np.clip(shade0 ** (1.0 + 0.25 * gloss) + 0.45 * gloss * detail, 0.0, 1.30)

    # clipped (pure white) plateaus carry no shading: give them a smooth gradient
    clipped = np.clip((shade0 - 0.93) / 0.07, 0, 1)
    clipped = gaussian_filter(clipped, 3 * sc)
    if reflect > 0:
        pys, _ = np.where(paint)
        ys = np.arange(h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
        t = np.clip((ys - pys.min()) / max(pys.max() - pys.min(), 1), 0, 1)
        grad = 1.0 + reflect * (0.10 - 0.28 * t)
        shade = shade * (1 - clipped) + shade * grad * clipped
    shade = shade[..., None]

    tgt = srgb_to_lin(np.array(target_rgb, dtype=np.float32) / 255.0)
    if name.lower() != "white":
        tgt = tgt * depth
    tmax = max(float(tgt.max()), 1e-4)
    tgt_lum = float(tgt @ LUMA)

    # richer shadows: weaker channels fall faster, so colour saturates as it darkens
    expo = 1.0 + 0.45 * (1.0 - tgt / tmax)
    shade_c = np.power(np.clip(shade, 1e-4, None), expo[None, None, :])
    if tgt_lum < 0.02:                      # black / very dark paint: deeper, glossier contrast
        shade_c = np.power(np.clip(shade_c, 1e-4, None), 1.25)
    body = tgt[None, None, :] * shade_c

    # lit areas of real paint get lighter and a bit more vivid, not white
    lit = np.clip((shade - 0.9) / 0.4, 0, 1)
    lift = np.clip(tgt / tmax, 0, 1)[None, None, :]
    body = body + lit * 0.10 * gloss * tmax * lift

    # ---- environment reflection (Fresnel-like): strongest on up-facing / bright
    # areas and grazing darks; much more visible on dark paint than on light paint
    if reflect > 0:
        env = _environment(h, w, paint, sc)
        up = np.clip((shade0 - 0.55) / 0.45, 0, 1)
        up = gaussian_filter(up, 2 * sc)
        graze = np.clip((0.45 - shade0) / 0.45, 0, 1) * 0.35   # dark rims reflect a bit too
        fres = np.clip(0.04 + 0.96 * up ** 2 + 0.5 * graze, 0, 1)[..., None]
        gain = (0.05 + 0.75 * (1.0 - min(tgt_lum, 1.0) ** 0.5) ** 3) * reflect * min(gloss, 2.0)
        body = body + fres * env * gain * (1.0 - np.clip(body, 0, 1))

    # clear coat: only small, sharp glints go (nearly) white. Smooth, capped.
    peak = lum_s - gaussian_filter(lum_s, 5 * sc)
    near_top = np.clip((lum_s / max(lhi, 1e-4) - 0.90) / 0.10, 0, 1)
    glint = np.clip(peak / (0.22 * max(lref, 1e-4)), 0, 1) * near_top
    glint = gaussian_filter(glint, 0.8 * sc + 0.3)
    glint = np.clip(glint, 0, 0.6)[..., None]
    body = body + glint * 0.55 * min(gloss, 2.0) * (1.0 - np.clip(body, 0, 1))

    out_lin = lin * (1 - m) + body * m
    return (lin_to_srgb(out_lin) * 255.0 + 0.5).astype(np.uint8)


# --------------------------------------------------------------------------
def composite(rec_fg, orig, alpha, car, interior, loose, transparent, paint):
    """Put the recoloured car back over the ORIGINAL background (keeps shadows)."""
    from scipy.ndimage import distance_transform_edt, gaussian_filter
    a = alpha.astype(np.float32) / 255.0
    a = np.where(interior, 1.0, a)
    # white paint against a white background confuses the background remover and
    # gives those pixels partial transparency. Wherever we paint, force opacity.
    pm = gaussian_filter(paint.astype(np.float32), 0.8)
    a = np.maximum(a, np.where(loose, pm, 0.0))
    if transparent:
        im = Image.fromarray(rec_fg).convert("RGBA")
        im.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
        return im
    outside = a < 0.02
    idx = distance_transform_edt(~outside, return_distances=False, return_indices=True)
    bgimg = orig[idx[0], idx[1]].astype(np.float32)
    bgimg = np.where(outside[..., None], orig.astype(np.float32), bgimg)
    out = a[..., None] * rec_fg.astype(np.float32) + (1 - a[..., None]) * bgimg
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))


def debug_overlay(arr, paint, car):
    ov = arr.copy().astype(np.float32)
    ov[paint] = ov[paint] * 0.35 + np.array([0, 255, 0]) * 0.65
    prot = car & ~paint
    ov[prot] = ov[prot] * 0.55 + np.array([255, 0, 0]) * 0.45
    return ov.clip(0, 255).astype(np.uint8)


def load_mask_file(path, shape):
    m = Image.open(path).convert("L").resize((shape[1], shape[0]), Image.NEAREST)
    return np.array(m) > 128


def process(input_path, colors, out_dir=None, out_path=None, debug=False,
            transparent=False, mask_path=None, depth=0.80, gloss=1.3,
            glass_top=0.60, reflect=0.35, model="isnet-general-use",
            grow=1.0, keep_trim=False, matting=False):
    from skimage.morphology import disk  # noqa: F401  (import check)
    src = Image.open(input_path)
    has_alpha = (src.mode in ("RGBA", "LA") or "transparency" in src.info)
    rgba = np.array(src.convert("RGBA"))
    arr = np.array(Image.alpha_composite(
        Image.new("RGBA", src.size, (255, 255, 255, 255)),
        Image.fromarray(rgba)).convert("RGB"))
    stem = os.path.splitext(os.path.basename(input_path))[0]
    folder = out_dir or os.path.dirname(os.path.abspath(input_path))
    os.makedirs(folder, exist_ok=True)
    h, w = arr.shape[:2]
    print(f"\n{stem}  {w}x{h}")
    s = max(w / 1000.0, 0.3)
    r = lambda v: max(1, int(round(v * s)))        # noqa: E731

    own_alpha = has_alpha and (rgba[:, :, 3] < 10).mean() > 0.05
    if own_alpha:
        alpha = rgba[:, :, 3]
        car = alpha > 128
        bg = np.array([255, 255, 255], np.float32)
        fg_src = rgba[:, :, :3]
    else:
        car, alpha = get_car_mask(Image.fromarray(arr), model, matting)
        bg = estimate_bg(arr, alpha)
        fg_src = arr
    loose = alpha > 20

    fg, interior = decontaminate(fg_src, alpha, car, r, bg) if not own_alpha else (fg_src, None)
    if interior is None:
        from scipy.ndimage import binary_erosion
        from skimage.morphology import disk as _d
        interior = binary_erosion(car, structure=_d(r(3)))

    if mask_path:
        paint = load_mask_file(mask_path, car.shape)
    else:
        paint, _ = get_paint_mask(fg, car, loose, interior, glass_top, grow, keep_trim)
    cov = 100.0 * paint.sum() / max(car.sum(), 1)
    print(f"    paint covers {cov:.0f}% of the car (typical 40-65%)")
    flag = None
    if not (30 <= cov <= 75):
        flag = f"coverage {cov:.0f}%"
        print("    WARNING: unusual coverage, check the *_debug.png")

    if debug:
        base = os.path.join(folder, stem)
        Image.fromarray(debug_overlay(fg, paint, car)).save(f"{base}_debug.png")
        Image.fromarray((paint * 255).astype(np.uint8), "L").save(f"{base}_mask.png")

    from skimage.color import rgb2hsv
    _V = rgb2hsv(fg.astype(np.float32) / 255.0)[:, :, 2]
    _c = car & (rgb2hsv(fg.astype(np.float32) / 255.0)[:, :, 1] < 0.25)
    vref_v = float(np.percentile(_V[_c], 85)) if _c.sum() > 50 else 0.9

    for name in colors:
        rgb = parse_color(name)
        rec = apply_color(fg, paint, rgb, depth, gloss, reflect, name)
        rec = fix_edges(rec, fg, paint, car, vref_v, r)
        im = composite(rec, arr, alpha, car, interior, loose, transparent, paint)
        if out_path and len(colors) == 1:
            dest = out_path
        else:
            dest = os.path.join(folder, f"{stem}_{name.lstrip('#')}.png")
        im.save(dest)
        print(f"    saved {dest}")
    return flag


def main():
    ap = argparse.ArgumentParser(description="Recolour white cars (v11)")
    ap.add_argument("args", nargs="*", help="input color [output]  |  --batch src dst colors")
    ap.add_argument("--batch", action="store_true")
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--transparent", action="store_true")
    ap.add_argument("--mask")
    ap.add_argument("--depth", type=float, default=0.80)
    ap.add_argument("--gloss", type=float, default=1.3)
    ap.add_argument("--glass-top", type=float, default=0.60)
    ap.add_argument("--reflect", type=float, default=0.35)
    ap.add_argument("--model", default="isnet-general-use")
    ap.add_argument("--grow", type=float, default=1.0)
    ap.add_argument("--keep-trim", action="store_true")
    ap.add_argument("--matting", action="store_true")
    a = ap.parse_args()
    kw = dict(depth=a.depth, gloss=a.gloss, glass_top=a.glass_top,
              reflect=a.reflect, model=a.model, grow=a.grow,
              keep_trim=a.keep_trim, matting=a.matting)

    if a.batch:
        if len(a.args) != 3:
            print("Usage: --batch src_folder out_folder red,black,silver")
            return 1
        src, dst, cols = a.args[0], a.args[1], a.args[2].split(",")
        os.makedirs(dst, exist_ok=True)
        review = []
        for fn in sorted(os.listdir(src)):
            if fn.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                try:
                    flag = process(os.path.join(src, fn), cols, out_dir=dst,
                                   debug=True, transparent=True, **kw)
                except Exception as e:                    # keep the batch going
                    flag = f"ERROR {e}"
                    print(f"    {flag}")
                if flag:
                    review.append(f"{fn}: {flag}")
        with open(os.path.join(dst, "review.txt"), "w") as f:
            f.write("\n".join(review))
        print(f"\nDone. {len(review)} image(s) to check, see {dst}/review.txt")
        return 0

    if len(a.args) < 2:
        print(__doc__)
        return 1
    inp, color = a.args[0], a.args[1]
    out = a.args[2] if len(a.args) > 2 else None
    if not os.path.exists(inp):
        print(f"File not found: {inp}")
        return 1
    process(inp, [color], out_path=out, debug=a.debug, transparent=a.transparent,
            mask_path=a.mask, **kw)
    return 0


if __name__ == "__main__":
    sys.exit(main())
