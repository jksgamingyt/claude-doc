#!/usr/bin/env python3
"""
Draws MySchedule's app icon: the same leaf the welcome screen uses, on a
forest gradient with a low sun behind it.

No image libraries are available here, so this rasterises by hand and writes
the PNG chunks directly. 2x supersampling keeps the leaf edge clean at the
small sizes iOS actually renders.
"""
import math
import struct
import sys
import zlib

SIZE = 1024
SS = 2      # supersampling factor
SCALE = 1.0 # shrinks the leaf, for maskable icons that need a safe zone

# --- palette -----------------------------------------------------------------
BG_TOP = (0x10, 0x1F, 0x18)
BG_BOTTOM = (0x25, 0x4C, 0x36)
GLOW = (0xE0, 0xB4, 0x5C)
LEAF_TOP = (0xF2, 0xF0, 0xDF)
LEAF_BOTTOM = (0xA8, 0xC9, 0xA6)
VEIN = (0x2A, 0x4F, 0x39)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return (lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t))


def clamp01(value):
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


# --- leaf geometry -----------------------------------------------------------
# The leaf is the lens where two equal circles overlap. Solving for a lens of
# height H and width W gives the radius and the centre offset.
LEAF_H = 615.0
LEAF_W = 338.0
_h = LEAF_H / 2.0
_w = LEAF_W / 2.0
RADIUS = (_h * _h + _w * _w) / (2.0 * _w)
OFFSET = RADIUS - _w
R2 = RADIUS * RADIUS

TILT = math.radians(-16.0)
COS_T = math.cos(TILT)
SIN_T = math.sin(TILT)

CENTRE = SIZE / 2.0
LEAF_CX = CENTRE
LEAF_CY = CENTRE + 6.0

# Shadow offset, in leaf-local coordinates.
SHADOW_DX = 26.0
SHADOW_DY = 34.0

# Side veins, in leaf-local coordinates: (start y, tip x, tip y)
VEINS = []
for i in range(3):
    t = -0.17 + i * 0.19
    y0 = t * LEAF_H
    for direction in (-1.0, 1.0):
        VEINS.append((y0, direction * (LEAF_W * 0.38), y0 + LEAF_H * 0.108))


def distance_to_segment(px, py, ax, ay, bx, by):
    vx = bx - ax
    vy = by - ay
    wx = px - ax
    wy = py - ay
    denominator = vx * vx + vy * vy
    if denominator <= 0.0:
        return math.hypot(wx, wy)
    t = (wx * vx + wy * vy) / denominator
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    return math.hypot(px - (ax + vx * t), py - (ay + vy * t))


def sample(lx, ly, px, py):
    """Colour for one supersample. lx/ly are leaf-local coordinates."""
    # Background: vertical gradient plus a warm glow low and right.
    t = py / float(SIZE)
    colour = mix(BG_TOP, BG_BOTTOM, t * t * 0.85 + t * 0.15)

    # A low sun sitting behind the leaf, upper right.
    gx = px - SIZE * 0.76
    gy = py - SIZE * 0.24
    glow = 1.0 - clamp01(math.hypot(gx, gy) / (SIZE * 0.58))
    colour = mix(colour, GLOW, glow * glow * glow * 0.34)

    # Leaf: inside both circles.
    dx1 = lx - OFFSET
    dx2 = lx + OFFSET
    inside = (dx1 * dx1 + ly * ly) <= R2 and (dx2 * dx2 + ly * ly) <= R2
    if not inside:
        # Soft shadow cast down and right, so the leaf lifts off the ground.
        sx = lx - SHADOW_DX
        sy = ly - SHADOW_DY
        s1 = sx - OFFSET
        s2 = sx + OFFSET
        if (s1 * s1 + sy * sy) <= R2 and (s2 * s2 + sy * sy) <= R2:
            edge = min(
                R2 - (s1 * s1 + sy * sy),
                R2 - (s2 * s2 + sy * sy),
            ) / (R2 * 0.09)
            colour = mix(colour, (0.0, 0.0, 0.0), 0.30 * clamp01(edge))
        return colour

    shade = clamp01((ly + LEAF_H / 2.0) / LEAF_H)
    leaf = mix(LEAF_TOP, LEAF_BOTTOM, shade)

    # Midrib, tapering towards the tips.
    taper = 1.0 - clamp01(abs(ly) / (LEAF_H * 0.5)) ** 3
    if abs(lx) <= 3.0 + 3.0 * taper and abs(ly) <= LEAF_H * 0.475:
        return mix(leaf, VEIN, 0.72)

    # Side veins
    for y0, tipx, tipy in VEINS:
        if distance_to_segment(lx, ly, 0.0, y0, tipx, tipy) <= 3.0:
            return mix(leaf, VEIN, 0.34)

    return leaf


def render():
    rows = []
    inverse = 1.0 / (SS * SS)
    step = 1.0 / SS

    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            r = g = b = 0.0
            for sy in range(SS):
                py = y + (sy + 0.5) * step
                dy = py - LEAF_CY
                for sx in range(SS):
                    px = x + (sx + 0.5) * step
                    dx = px - LEAF_CX
                    lx = dx * COS_T + dy * SIN_T
                    ly = -dx * SIN_T + dy * COS_T
                    cr, cg, cb = sample(lx, ly, px, py)
                    r += cr
                    g += cg
                    b += cb
            row.append(int(r * inverse + 0.5))
            row.append(int(g * inverse + 0.5))
            row.append(int(b * inverse + 0.5))
        rows.append(bytes(row))

        if y % 128 == 0:
            sys.stderr.write("  row %d/%d\n" % (y, SIZE))
            sys.stderr.flush()

    return rows


def chunk(tag, payload):
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def write_png(path, rows):
    raw = b"".join(b"\x00" + row for row in rows)
    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)  # 8-bit RGB
    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(data)
    return len(data)


def configure(size, supersample, scale):
    """Re-derive everything that depends on the canvas size."""
    global SIZE, SS, SCALE, LEAF_H, LEAF_W, RADIUS, OFFSET, R2
    global CENTRE, LEAF_CX, LEAF_CY, SHADOW_DX, SHADOW_DY, VEINS

    SIZE = size
    SS = supersample
    SCALE = scale

    unit = size / 1024.0
    LEAF_H = 615.0 * unit * scale
    LEAF_W = 338.0 * unit * scale

    half_h = LEAF_H / 2.0
    half_w = LEAF_W / 2.0
    RADIUS = (half_h * half_h + half_w * half_w) / (2.0 * half_w)
    OFFSET = RADIUS - half_w
    R2 = RADIUS * RADIUS

    CENTRE = size / 2.0
    LEAF_CX = CENTRE
    LEAF_CY = CENTRE + 6.0 * unit
    SHADOW_DX = 26.0 * unit * scale
    SHADOW_DY = 34.0 * unit * scale

    VEINS = []
    for index in range(3):
        t = -0.17 + index * 0.19
        y0 = t * LEAF_H
        for direction in (-1.0, 1.0):
            VEINS.append((y0, direction * (LEAF_W * 0.38), y0 + LEAF_H * 0.108))


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "AppIcon.png"
    size = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
    supersample = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0

    configure(size, supersample, scale)
    written = write_png(target, render())
    print("wrote %s (%d bytes, %dx%d, leaf scale %.2f)" % (target, written, size, size, scale))
