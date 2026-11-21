#!/usr/bin/env python3
"""Build-time asset generator for the Vestmark passport entry.

Rasterises every glyph the program needs, at every size it needs, into one
grayscale-alpha sprite sheet plus a compact binary metrics table
(assets/glyphs.bin).  The entry program (main.ts) then only has to blit
pre-rendered, anti-aliased glyphs -- the grading sandbox ships no font engine
and no network, so all typography is baked in here.

Fonts: the Liberation family (SIL Open Font License 1.1).  Only rendered
glyph bitmaps are redistributed, never the font software.
"""
import struct
from PIL import Image, ImageDraw, ImageFont

FONT_DIR = "/usr/share/fonts/truetype/liberation"
SERIF = f"{FONT_DIR}/LiberationSerif-Regular.ttf"
SERIF_B = f"{FONT_DIR}/LiberationSerif-Bold.ttf"
SERIF_I = f"{FONT_DIR}/LiberationSerif-Italic.ttf"
SANS = f"{FONT_DIR}/LiberationSans-Regular.ttf"
SANS_B = f"{FONT_DIR}/LiberationSans-Bold.ttf"
MONO = f"{FONT_DIR}/LiberationMono-Regular.ttf"
MONO_B = f"{FONT_DIR}/LiberationMono-Bold.ttf"

CHARS = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    "0123456789"
    " .,:;-_/()[]'\"&+=%$!?*#<>|@"
    "<"
    "§°·"
    "ÆØÐÞÅÖÜÉÍÓÁÑÇÊÔÈÄ"
    "æøðþåöüéíóáñçêôèä"
)

# name -> (font file, pixel size)
STYLES = [
    ("serif48b", SERIF_B, 48),
    ("serif30b", SERIF_B, 30),
    ("serif26b", SERIF_B, 26),
    ("serif22", SERIF, 22),
    ("serif20b", SERIF_B, 20),
    ("serif18", SERIF, 18),
    ("serif15", SERIF, 15),
    ("serif13", SERIF, 13),
    ("serif12", SERIF, 12),
    ("serif11", SERIF, 11),
    ("serif9", SERIF, 9),
    ("serifIt14", SERIF_I, 14),
    ("serifIt12", SERIF_I, 12),
    ("sans20b", SANS_B, 20),
    ("sans17", SANS, 17),
    ("sans15b", SANS_B, 15),
    ("sans13", SANS, 13),
    ("sans12b", SANS_B, 12),
    ("sans11b", SANS_B, 11),
    ("sans11", SANS, 11),
    ("sans10b", SANS_B, 10),
    ("sans10", SANS, 10),
    ("sans9", SANS, 9),
    ("sans8b", SANS_B, 8),
    ("sans8", SANS, 8),
    ("mono17", MONO, 17),
    ("mono14b", MONO_B, 14),
    ("mono13", MONO, 13),
    ("mono12", MONO, 12),
    ("mono10", MONO, 10),
]

SHEET_W = 2048
PAD = 1


def glyph_bitmap(font, ch):
    bbox = font.getbbox(ch, anchor="ls")
    if bbox is None:
        return None
    x0, y0, x1, y1 = bbox
    w = max(0, x1 - x0)
    h = max(0, y1 - y0)
    if w == 0 or h == 0:
        return b"", 0, 0
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    d.text((-x0, -y0), ch, font=font, fill=255, anchor="ls")
    return img.tobytes(), w, h


def main():
    # First pass: render every glyph and compute the packed layout.
    rendered = []  # (style_name, ascent, descent, [ (cp, adv, dx, top, w, h, data) ])
    for name, path, size in STYLES:
        font = ImageFont.truetype(path, size)
        asc, desc = font.getmetrics()
        glyphs = []
        for ch in CHARS:
            adv = float(font.getlength(ch))
            bm = glyph_bitmap(font, ch)
            if bm is None:
                data, w, h = b"", 0, 0
                top = 0.0
                dx = 0.0
            else:
                data, w, h = bm
                bx = font.getbbox(ch, anchor="ls")
                dx = float(bx[0]) if bx else 0.0
                top = float(bx[1]) if bx else 0.0
            glyphs.append((ord(ch), adv, dx, top, w, h, data))
        rendered.append((name, float(asc), float(desc), glyphs))

    # Shelf packing into one sheet.
    sheet = Image.new("L", (SHEET_W, 1), 0)
    positions = []  # per style list of (sx, sy, w, h, data)
    cx = cy = row_h = 0
    height_needed = 1
    for name, asc, desc, glyphs in rendered:
        placed = []
        for cp, adv, dx, top, w, h, data in glyphs:
            if w == 0 or h == 0:
                placed.append((0, 0, 0, 0, b""))
                continue
            if cx + w + PAD > SHEET_W:
                cx = 0
                cy += row_h + PAD
                row_h = 0
            placed.append((cx, cy, w, h, data))
            cx += w + PAD
            row_h = max(row_h, h)
            height_needed = max(height_needed, cy + h)
        positions.append(placed)
    sheet = Image.new("L", (SHEET_W, height_needed), 0)
    for (name, asc, desc, glyphs), placed in zip(rendered, positions):
        for (cp, adv, dx, top, w, h, data), (sx, sy, pw, ph, _d) in zip(glyphs, placed):
            if w and h:
                sheet.paste(Image.frombytes("L", (w, h), data), (sx, sy))

    raw = sheet.tobytes()
    import zlib
    comp = zlib.compress(raw, 9)

    out = bytearray()
    out += b"GATL"
    out += struct.pack("<HH", 1, len(rendered))
    for (name, asc, desc, glyphs), placed in zip(rendered, positions):
        nb = name.encode("utf-8")
        out += struct.pack("<B", len(nb)) + nb
        out += struct.pack("<fff", asc, desc, 0.0)
        out += struct.pack("<H", len(glyphs))
        for (cp, adv, dx, top, w, h, data), (sx, sy, pw, ph, _d) in zip(glyphs, placed):
            out += struct.pack("<IfffHHHH", cp, adv, dx, top, w, h, sx, sy)
    out += struct.pack("<HHI", SHEET_W, height_needed, len(comp))
    out += comp

    import os
    os.makedirs("assets", exist_ok=True)
    with open("assets/glyphs.bin", "wb") as f:
        f.write(out)

    total = sum(len(g[6]) for _, _, _, g in rendered)
    print(f"styles={len(rendered)} sheet={SHEET_W}x{height_needed} raw={len(raw)} comp={len(comp)} bin={len(out)} glyphpx={total}")
    print("bytes/glyph avg", total // sum(len(g[6]) for _, _, _, g in rendered))


if __name__ == "__main__":
    main()
