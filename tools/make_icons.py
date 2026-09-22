from PIL import Image, ImageDraw
import math, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(OUT, exist_ok=True)
SS = 4  # supersample

def lerp(a, b, t): return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

def bg(size, c1=(22, 16, 62), c2=(9, 10, 30)):
    img = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=lerp(c1, c2, t ** 0.85))
    # violet glow top-left
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(int(size * 0.75), 0, -6):
        a = int(30 * (1 - r / (size * 0.75)) ** 2)
        gd.ellipse([size * 0.16 - r, size * 0.02 - r, size * 0.16 + r, size * 0.02 + r], fill=(124, 92, 255, a))
    img = Image.alpha_composite(img.convert('RGBA'), glow)
    return img

def strata_mark(size, inset=0.0):
    """An ascending staircase of layers — strata, and the high-water ratchet."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    S = size
    skew = 0.075 * S
    bars = [
        (0.700, -0.085, 0.215, (58, 74, 152)),
        (0.545,  0.000, 0.215, (86, 118, 236)),
        (0.390,  0.085, 0.215, (156, 124, 255)),
    ]
    for yc, xo, hw, col in bars:
        y, w, h = yc * S, hw * S, 0.082 * S
        cx = 0.50 * S + xo * S
        pts = [
            (cx - w - skew * 0.5, y + h / 2),
            (cx + w - skew * 0.5, y + h / 2),
            (cx + w + skew * 0.5, y - h / 2),
            (cx - w + skew * 0.5, y - h / 2),
        ]
        d.polygon(pts, fill=col)
    return img

def rounded_mask(size, radius_frac=0.235):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_frac), fill=255)
    return m

def build(size, maskable=False, rounded=True):
    s = size * SS
    scale = 0.78 if maskable else 1.0  # keep art inside the safe zone
    img = bg(s)
    art = strata_mark(int(s * scale))
    off = (s - art.size[0]) // 2
    img.alpha_composite(art, (off, off))
    if rounded and not maskable:
        img.putalpha(rounded_mask(s))
    img = img.resize((size, size), Image.LANCZOS)
    return img

for n in (192, 512, 180):
    build(n).save(os.path.join(OUT, f'icon-{n}.png'))
build(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
build(64).save(os.path.join(OUT, 'preview-64.png'))
print('icons written')
