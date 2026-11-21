// The Passport Page of a Country That Isn't There -- make.fun bounty entry.
//
// The program writes ONE image to /output/entry.png: an uncaptioned open
// passport spread for the Republic of Vestmark, a North Atlantic island
// republic that does not exist.  Left page: the data page (portrait, fields,
// MRZ).  Right page: visas and arrival/departure stamps from the country's
// neighbours, plus the paperwork that tells you what sort of place it is.
//
// Node 22, standard library only, no network.  The grading sandbox ships no
// font engine, so all typography is baked into assets/glyphs.bin (a grayscale
// glyph sheet + metrics, built by tools/gen_atlas.py) and this program only
// blits anti-aliased glyph bitmaps.  Everything here is deterministic: the
// run is graded twice and the two output trees are compared byte for byte.
//
// Run outside the grader:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Glyph atlas
// ---------------------------------------------------------------------------
function loadAtlasBytes() {
  const candidates = [];
  try {
    candidates.push(new URL('./assets/glyphs.bin', import.meta.url));
  } catch (e) {
    /* ignore */
  }
  const bot = process.env.MAKEFUN_BOT_DIR;
  if (bot) candidates.push(join(bot, 'assets', 'glyphs.bin'));
  candidates.push(join(process.cwd(), 'assets', 'glyphs.bin'));
  candidates.push(join(process.cwd(), '..', 'assets', 'glyphs.bin'));
  for (const c of candidates) {
    try {
      return readFileSync(c);
    } catch (e) {
      /* try next */
    }
  }
  throw new Error('assets/glyphs.bin not found (looked in ' + candidates.length + ' places)');
}

function parseAtlas(buf) {
  let o = 4;
  if (buf.toString('latin1', 0, 4) !== 'GATL') throw new Error('bad atlas magic');
  const version = buf.readUInt16LE(o);
  o += 2;
  const styleCount = buf.readUInt16LE(o);
  o += 2;
  const styles = new Map();
  for (let i = 0; i < styleCount; i++) {
    const nl = buf.readUInt8(o);
    o += 1;
    const name = buf.toString('utf8', o, o + nl);
    o += nl;
    const ascent = buf.readFloatLE(o);
    o += 4;
    const descent = buf.readFloatLE(o);
    o += 4;
    o += 4;
    const gc = buf.readUInt16LE(o);
    o += 2;
    const glyphs = new Map();
    for (let g = 0; g < gc; g++) {
      const cp = buf.readUInt32LE(o);
      o += 4;
      const adv = buf.readFloatLE(o);
      o += 4;
      const dx = buf.readFloatLE(o);
      o += 4;
      const top = buf.readFloatLE(o);
      o += 4;
      const w = buf.readUInt16LE(o);
      o += 2;
      const h = buf.readUInt16LE(o);
      o += 2;
      const sx = buf.readUInt16LE(o);
      o += 2;
      const sy = buf.readUInt16LE(o);
      o += 2;
      glyphs.set(cp, { adv, dx, top, w, h, sx, sy });
    }
    styles.set(name, { ascent, descent, glyphs });
  }
  const sheetW = buf.readUInt16LE(o);
  o += 2;
  const sheetH = buf.readUInt16LE(o);
  o += 2;
  const clen = buf.readUInt32LE(o);
  o += 4;
  const comp = buf.subarray(o, o + clen);
  const sheet = new Uint8Array(inflateSync(comp));
  return { version, styles, sheetW, sheetH, sheet };
}

const ATLAS = parseAtlas(loadAtlasBytes());
const SHEET = ATLAS.sheet;
const SHEET_W = ATLAS.sheetW;

function glyphOf(style, ch) {
  const st = ATLAS.styles.get(style);
  if (!st) throw new Error('no style ' + style);
  let g = st.glyphs.get(ch.codePointAt(0));
  if (!g) g = st.glyphs.get(32);
  return g;
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
class Img {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h * 4);
  }
  px(x, y, r, g, b, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (a > 1) a = 1;
    if (r < 0) r = 0;
    else if (r > 255) r = 255;
    if (g < 0) g = 0;
    else if (g > 255) g = 255;
    if (b < 0) b = 0;
    else if (b > 255) b = 255;
    const i = (y * this.w + x) * 4;
    const d = this.d;
    const ia = 1 - a;
    d[i] = d[i] * ia + r * a;
    d[i + 1] = d[i + 1] * ia + g * a;
    d[i + 2] = d[i + 2] * ia + b * a;
    d[i + 3] = d[i + 3] * ia + 255 * a;
  }
  fill(r, g, b, a) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.px(x, y, r, g, b, a);
  }
  rect(x, y, w, h, r, g, b, a) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, r, g, b, a);
  }
  hline(x0, x1, y, t, r, g, b, a) {
    this.rect(x0, y, x1 - x0, t, r, g, b, a);
  }
  vline(x, y0, y1, t, r, g, b, a) {
    this.rect(x, y0, t, y1 - y0, r, g, b, a);
  }
  rectOutline(x, y, w, h, t, r, g, b, a) {
    this.rect(x, y, w, t, r, g, b, a);
    this.rect(x, y + h - t, w, t, r, g, b, a);
    this.rect(x, y, t, h, r, g, b, a);
    this.rect(x + w - t, y, t, h, r, g, b, a);
  }
  tw(style, s, tracking = 0) {
    let w = 0;
    let n = 0;
    for (const ch of s) {
      w += glyphOf(style, ch).adv + tracking;
      n++;
    }
    if (n > 0) w -= tracking;
    return w;
  }
  text(style, s, x, y, col, a = 1, tracking = 0, align = 'l') {
    const w = this.tw(style, s, tracking);
    let cx = x;
    if (align === 'c') cx = x - w / 2;
    else if (align === 'r') cx = x - w;
    cx = Math.round(cx);
    const yy = Math.round(y);
    for (const ch of s) {
      const g = glyphOf(style, ch);
      this.blitGlyph(cx, yy, g, col, a);
      cx += g.adv + tracking;
    }
    return w;
  }
  blitGlyph(ox, oy, g, col, a) {
    if (!g.w || !g.h) return;
    const gx = Math.round(ox + g.dx);
    const gy = Math.round(oy + g.top);
    const [r, gg, b] = col;
    for (let j = 0; j < g.h; j++) {
      const sy = g.sy + j;
      const yy = gy + j;
      if (yy < 0 || yy >= this.h) continue;
      for (let i = 0; i < g.w; i++) {
        const av = SHEET[sy * SHEET_W + g.sx + i];
        if (av === 0) continue;
        this.px(gx + i, yy, r, gg, b, (av / 255) * a);
      }
    }
  }
  blitGlyphRot(ox, oy, g, col, a, phi) {
    if (!g.w || !g.h) return;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    let minx = 1e9,
      miny = 1e9,
      maxx = -1e9,
      maxy = -1e9;
    for (const [px, py] of [
      [g.dx, g.top],
      [g.dx + g.w, g.top],
      [g.dx, g.top + g.h],
      [g.dx + g.w, g.top + g.h],
    ]) {
      const X = ox + px * c - py * s;
      const Y = oy + px * s + py * c;
      if (X < minx) minx = X;
      if (X > maxx) maxx = X;
      if (Y < miny) miny = Y;
      if (Y > maxy) maxy = Y;
    }
    const x0 = Math.max(0, Math.floor(minx) - 1);
    const x1 = Math.min(this.w - 1, Math.ceil(maxx) + 1);
    const y0 = Math.max(0, Math.floor(miny) - 1);
    const y1 = Math.min(this.h - 1, Math.ceil(maxy) + 1);
    const [r, gg, b] = col;
    for (let Y = y0; Y <= y1; Y++) {
      for (let X = x0; X <= x1; X++) {
        const dx0 = X - ox;
        const dy0 = Y - oy;
        const px = dx0 * c + dy0 * s;
        const py = -dx0 * s + dy0 * c;
        const u = px - g.dx;
        const v = py - g.top;
        if (u < -1 || v < -1 || u > g.w || v > g.h) continue;
        const av = sampleBilinear(SHEET, SHEET_W, ATLAS.sheetH, g.sx + u, g.sy + v);
        if (av <= 0.5) continue;
        this.px(X, Y, r, gg, b, (av / 255) * a);
      }
    }
  }
  softEllipse(cx, cy, rx, ry, rot, col, a, hard = 0.7) {
    const c = Math.cos(rot),
      s = Math.sin(rot);
    const ex = Math.abs(rx * c) + Math.abs(ry * s) + 2;
    const ey = Math.abs(rx * s) + Math.abs(ry * c) + 2;
    const x0 = Math.max(0, Math.floor(cx - ex));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + ex));
    const y0 = Math.max(0, Math.floor(cy - ey));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ey));
    const [r, g, b] = col;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const u = (dx * c + dy * s) / rx;
        const v = (-dx * s + dy * c) / ry;
        const d = Math.sqrt(u * u + v * v);
        if (d >= 1) continue;
        let t = (1 - d) / (1 - hard);
        if (t > 1) t = 1;
        const aa = a * (t * t * (3 - 2 * t));
        if (aa > 0.0015) this.px(x, y, r, g, b, aa);
      }
    }
  }
  ellipseStroke(cx, cy, r, t, col, a) {
    const [rr, gg, bb] = col;
    const x0 = Math.max(0, Math.floor(cx - r - t - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r + t + 1));
    const y0 = Math.max(0, Math.floor(cy - r - t - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r + t + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const e = Math.abs(Math.sqrt(dx * dx + dy * dy) - r);
        if (e <= t / 2 + 0.5) {
          const aa = Math.min(1, t / 2 + 0.5 - e);
          if (aa > 0) this.px(x, y, rr, gg, bb, a * aa);
        }
      }
    }
  }
  fillPoly(pts, col, a) {
    const [r, g, b] = col;
    const n = pts.length;
    let miny = 1e9,
      maxy = -1e9;
    for (const p of pts) {
      if (p[1] < miny) miny = p[1];
      if (p[1] > maxy) maxy = p[1];
    }
    const y0 = Math.max(0, Math.floor(miny));
    const y1 = Math.min(this.h - 1, Math.ceil(maxy));
    const SUB = 6;
    for (let y = y0; y <= y1; y++) {
      for (let sub = 0; sub < SUB; sub++) {
        const sy = y + (sub + 0.5) / SUB;
        const xs = [];
        for (let i = 0; i < n; i++) {
          const p1 = pts[i];
          const p2 = pts[(i + 1) % n];
          if (p1[1] === p2[1]) continue;
          const t = (sy - p1[1]) / (p2[1] - p1[1]);
          if (t >= 0 && t < 1) xs.push(p1[0] + t * (p2[0] - p1[0]));
        }
        if (!xs.length) continue;
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const xa = xs[i],
            xb = xs[i + 1];
          const ia = Math.max(0, Math.floor(xa));
          const ib = Math.min(this.w - 1, Math.ceil(xb));
          for (let x = ia; x <= ib; x++) {
            const cov = Math.max(0, Math.min(x + 1, xb) - Math.max(x, xa));
            if (cov > 0) this.px(x, y, r, g, b, (a * cov) / SUB);
          }
        }
      }
    }
  }
  compositeRot(src, cx, cy, angleDeg, a = 1) {
    const phi = (angleDeg * Math.PI) / 180;
    const c = Math.cos(phi),
      s = Math.sin(phi);
    const sw = src.w,
      sh = src.h;
    let maxr = 0;
    for (const [px, py] of [
      [-sw / 2, -sh / 2],
      [sw / 2, -sh / 2],
      [-sw / 2, sh / 2],
      [sw / 2, sh / 2],
    ])
      maxr = Math.max(maxr, Math.hypot(px, py));
    const x0 = Math.max(0, Math.floor(cx - maxr));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + maxr));
    const y0 = Math.max(0, Math.floor(cy - maxr));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + maxr));
    for (let Y = y0; Y <= y1; Y++) {
      for (let X = x0; X <= x1; X++) {
        const dx = X - cx;
        const dy = Y - cy;
        const ux = dx * c + dy * s + sw / 2;
        const uy = -dx * s + dy * c + sh / 2;
        if (ux < 0 || uy < 0 || ux >= sw || uy >= sh) continue;
        const sr = sampleBilinearRGB(src, ux, uy);
        if (sr[3] <= 0.5) continue;
        this.px(X, Y, sr[0], sr[1], sr[2], (sr[3] / 255) * a);
      }
    }
  }
  toRGB() {
    const out = new Uint8Array(this.w * this.h * 3);
    for (let i = 0, j = 0; i < this.d.length; i += 4, j += 3) {
      out[j] = this.d[i];
      out[j + 1] = this.d[i + 1];
      out[j + 2] = this.d[i + 2];
    }
    return out;
  }
}

function sampleBilinear(sheet, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) {
    const xi = Math.round(x),
      yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
    return sheet[yi * w + xi];
  }
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  const a = sheet[y0 * w + x0];
  const b = sheet[y0 * w + x0 + 1];
  const c = sheet[(y0 + 1) * w + x0];
  const d = sheet[(y0 + 1) * w + x0 + 1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

function sampleBilinearRGB(src, x, y) {
  const w = src.w,
    h = src.h;
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  const out = [0, 0, 0, 0];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i,
        yy = y0 + j;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = (yy * w + xx) * 4;
      const wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      const av = (src.d[k + 3] / 255) * wgt;
      out[0] += src.d[k] * av;
      out[1] += src.d[k + 1] * av;
      out[2] += src.d[k + 2] * av;
      out[3] += src.d[k + 3] * wgt;
    }
  }
  const aa = out[3] / 255;
  if (aa > 0.001) {
    out[0] /= aa;
    out[1] /= aa;
    out[2] /= aa;
  }
  return out;
}

// ---------------------------------------------------------------------------
// PNG encoder (RGB, adaptive filtering, zlib)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function filterScanline(out, cur, prev, f, bpp, stride) {
  for (let i = 0; i < stride; i++) {
    const a = i >= bpp ? cur[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let v;
    if (f === 0) v = cur[i];
    else if (f === 1) v = cur[i] - a;
    else if (f === 2) v = cur[i] - b;
    else if (f === 3) v = cur[i] - ((a + b) >> 1);
    else {
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      v = cur[i] - pr;
    }
    out[i] = v & 0xff;
  }
}

function encodePNG(w, h, rgb) {
  const bpp = 3;
  const stride = w * bpp;
  const raw = Buffer.alloc((stride + 1) * h);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < h; y++) {
    cur.set(rgb.subarray(y * stride, (y + 1) * stride));
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      filterScanline(cand[f], cur, prev, f, bpp, stride);
      let s = 0;
      for (let i = 0; i < stride; i++) {
        const v = cand[f][i];
        s += v < 128 ? v : 256 - v;
      }
      if (s < bestSum) {
        bestSum = s;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
    prev.set(cur);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const INK = [28, 33, 44];
const NAVY = [22, 46, 82];
const SUB = [96, 104, 118];
const LABEL = [108, 116, 130];
const HAIR = [178, 184, 194];
const PAPER_L = [236, 239, 231];
const PAPER_R = [246, 241, 230];
const GUIL_L = [206, 216, 200];
const GUIL_R = [228, 219, 198];
const GOLD = [162, 128, 62];
const STAMP_BLUE = [26, 62, 128];
const STAMP_GREEN = [18, 104, 68];
const STAMP_RED = [152, 30, 34];
const STAMP_VIOLET = [96, 52, 138];
const STAMP_BLACK = [40, 42, 48];
const STAMP_SEPIA = [110, 74, 34];

// ---------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------
function stampDot(img, cx, cy, r, col, a) {
  const x0 = Math.floor(cx - r - 1),
    x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1),
    y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r + 0.5) {
        const cov = Math.min(1, r + 0.5 - d);
        if (cov > 0) img.px(x, y, col[0], col[1], col[2], a * cov);
      }
    }
  }
}

function line(img, x0, y0, x1, y1, col, a, t) {
  const dx = x1 - x0,
    dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const r = t / 2;
  for (let i = 0; i <= steps; i++) stampDot(img, x0 + (dx * i) / steps, y0 + (dy * i) / steps, r, col, a);
}

// Coarse value noise, as a multiplier on a layer's alpha channel: what makes
// rubber-stamp ink look uneven instead of flat.
function inkNoise(L, rng, cells, lo, hi) {
  const gw = cells[0] + 1,
    gh = cells[1] + 1;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = lo + (hi - lo) * rng();
  for (let y = 0; y < L.h; y++) {
    const fy = (y / L.h) * cells[1];
    const y0 = Math.min(cells[1] - 1, Math.floor(fy));
    const ty = fy - y0;
    for (let x = 0; x < L.w; x++) {
      const fx = (x / L.w) * cells[0];
      const x0 = Math.min(cells[0] - 1, Math.floor(fx));
      const tx = fx - x0;
      const v =
        g[y0 * gw + x0] * (1 - tx) * (1 - ty) +
        g[y0 * gw + x0 + 1] * tx * (1 - ty) +
        g[(y0 + 1) * gw + x0] * (1 - tx) * ty +
        g[(y0 + 1) * gw + x0 + 1] * tx * ty;
      const i = (y * L.w + x) * 4 + 3;
      L.d[i] = Math.min(255, L.d[i] * v);
    }
  }
}

function blurBox(L, r) {
  const w = L.w,
    h = L.h;
  const tmp = new Float32Array(w * h * 3);
  const out = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < L.d.length; i += 4, j += 3) {
    tmp[j] = L.d[i];
    tmp[j + 1] = L.d[i + 1];
    tmp[j + 2] = L.d[i + 2];
  }
  const win = 2 * r + 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += tmp[((y * w) + Math.min(w - 1, Math.max(0, x))) * 3 + c];
      for (let x = 0; x < w; x++) {
        out[(y * w + x) * 3 + c] = sum / win;
        const add = tmp[(y * w + Math.min(w - 1, x + r + 1)) * 3 + c];
        const sub = tmp[(y * w + Math.max(0, x - r)) * 3 + c];
        sum += add - sub;
      }
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += out[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + c];
      for (let y = 0; y < h; y++) {
        tmp[(y * w + x) * 3 + c] = sum / win;
        const add = out[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c];
        const sub = out[(Math.max(0, y - r) * w + x) * 3 + c];
        sum += add - sub;
      }
    }
  }
  for (let i = 0, j = 0; i < L.d.length; i += 4, j += 3) {
    L.d[i] = tmp[j];
    L.d[i + 1] = tmp[j + 1];
    L.d[i + 2] = tmp[j + 2];
  }
}

// ---------------------------------------------------------------------------
// Emblem: shield, whale over waves, compass star.
// ---------------------------------------------------------------------------
function drawEmblem(img, cx, cy, s, col, a, withRibbon = false) {
  const shield = [
    [-1.0, -1.05],
    [1.0, -1.05],
    [1.0, 0.05],
    [0.86, 0.42],
    [0.52, 0.76],
    [0.0, 1.0],
    [-0.52, 0.76],
    [-0.86, 0.42],
    [-1.0, 0.05],
  ].map((p) => [cx + p[0] * s, cy + p[1] * s]);
  img.fillPoly(shield, col, a * 0.12);
  for (let i = 0; i < shield.length; i++) {
    const p = shield[i];
    const q = shield[(i + 1) % shield.length];
    line(img, p[0], p[1], q[0], q[1], col, a * 0.85, Math.max(1, s * 0.045));
  }
  for (let k = 0; k < 3; k++) {
    const wy = cy + s * (0.30 + k * 0.20);
    const half = s * (0.78 - k * 0.05);
    const amp = s * 0.1;
    let first = true;
    let px = 0,
      py = 0;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = cx - half + 2 * half * t;
      const y = wy + amp * Math.sin(t * Math.PI * 2.2) * Math.min(1, t * 3) * Math.min(1, (1 - t) * 3);
      if (!first) line(img, px, py, x, y, col, a * 0.8, Math.max(1, s * 0.035));
      first = false;
      px = x;
      py = y;
    }
  }
  const wcx = cx,
    wcy = cy - s * 0.3,
    ws = s * 0.62;
  img.fillPoly(
    [
      [-1.0, 0.0],
      [-0.72, -0.5],
      [-0.3, -0.72],
      [0.15, -0.62],
      [0.5, -0.32],
      [0.6, -0.02],
      [0.72, -0.5],
      [0.98, -0.62],
      [0.86, -0.18],
      [0.9, 0.28],
      [0.62, 0.5],
      [0.2, 0.6],
      [-0.25, 0.55],
      [-0.68, 0.35],
    ].map((p) => [wcx + p[0] * ws, wcy + p[1] * ws]),
    col,
    a * 0.82,
  );
  const stary = cy - s * 0.72;
  const star = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? s * 0.2 : s * 0.07;
    star.push([cx + rr * Math.cos(ang), stary + rr * Math.sin(ang)]);
  }
  img.fillPoly(star, col, a * 0.9);
  if (withRibbon && s > 24) {
    const ry = cy + s * 1.28;
    const rw = s * 1.5;
    img.fillPoly(
      [
        [cx - rw, ry - s * 0.16],
        [cx + rw, ry - s * 0.16],
        [cx + rw * 0.9, ry + s * 0.16],
        [cx - rw * 0.9, ry + s * 0.16],
      ],
      col,
      a * 0.16,
    );
    img.text('serif11', 'MEÐ SJÓNUM', cx, ry + s * 0.07, col, a, 1.2, 'c');
  }
}

function guilloche(img, x, y, w, h, col, a, n, seed) {
  const rng = mulberry32(seed);
  for (let k = 0; k < n; k++) {
    const base = y + (h * (k + 0.5)) / n;
    const amp = (h / n) * 0.9;
    const f1 = 0.03 + rng() * 0.02;
    const f2 = 0.008 + rng() * 0.01;
    const ph = k * 1.7;
    let px = 0,
      py = 0;
    for (let i = 0; i <= w; i += 2) {
      const xx = x + i;
      const yy = base + amp * Math.sin(xx * f1 + ph) * 0.6 + amp * 0.4 * Math.sin(xx * f2 + ph * 2.1);
      if (i > 0) line(img, px, py, xx, yy, col, a, 1);
      px = xx;
      py = yy;
    }
  }
}

// ---------------------------------------------------------------------------
// Portrait.  A synthetic passport photograph, painted with soft shading and
// supersampled 4x.  Deterministic: the same bytes every run.
// ---------------------------------------------------------------------------
function eyeLens(ecx, ecy, halfw, up, down, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ecx + (t - 0.5) * 2 * halfw;
    pts.push([x, ecy - up * Math.pow(Math.sin(Math.PI * t), 0.75)]);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const x = ecx + (t - 0.5) * 2 * halfw;
    pts.push([x, ecy + down * Math.pow(Math.sin(Math.PI * t), 0.75)]);
  }
  return pts;
}

function drawPortrait(img, bx, by, bw, bh) {
  const S = 4;
  const L = new Img(bw * S, bh * S);
  const W = L.w,
    H = L.h;
  const rng = mulberry32(20260312);
  const X = (u) => u * W;
  const Y = (v) => v * H;

  const skin = [228, 184, 152];
  const skinMid = [206, 158, 126];
  const skinDk = [174, 124, 96];
  const skinDp = [134, 90, 68];
  const skinHl = [246, 218, 194];
  const hair = [54, 38, 30];
  const hairHl = [112, 84, 62];
  const hairDk = [32, 22, 18];
  const lipUp = [160, 100, 96];
  const lipLo = [196, 132, 124];

  // Background: plain cool grey, lit from the upper left.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = 1 - Math.min(1, Math.hypot((x / W - 0.4) * 1.3, (y / H - 0.33) * 1.1));
      const v = 198 + 32 * t;
      L.px(x, y, v - 4, v - 1, v + 6, 1);
    }
  }

  // Torso / jacket
  L.softEllipse(X(0.5), Y(1.12), X(0.6), Y(0.3), 0, [46, 51, 62], 1, 0.5);
  L.softEllipse(X(0.5), Y(1.22), X(0.68), Y(0.34), 0, [34, 39, 49], 1, 0.5);
  // Shirt: a light V from the neck to under the chin
  L.fillPoly(
    [
      [X(0.42), Y(0.885)],
      [X(0.58), Y(0.885)],
      [X(0.545), Y(0.98)],
      [X(0.455), Y(0.98)],
    ],
    [238, 238, 242],
    1,
  );
  L.fillPoly(
    [
      [X(0.42), Y(0.885)],
      [X(0.5), Y(0.925)],
      [X(0.5), Y(0.885)],
    ],
    [216, 218, 224],
    1,
  );
  L.fillPoly(
    [
      [X(0.58), Y(0.885)],
      [X(0.5), Y(0.925)],
      [X(0.5), Y(0.885)],
    ],
    [216, 218, 224],
    1,
  );
  // Lapels of the jacket
  for (const s of [-1, 1]) {
    L.fillPoly(
      [
        [X(0.5 + s * 0.075), Y(0.9)],
        [X(0.5 + s * 0.2), Y(0.885)],
        [X(0.5 + s * 0.24), Y(1.0)],
        [X(0.5 + s * 0.1), Y(1.0)],
      ],
      [40, 45, 55],
      1,
    );
  }
  // Neck: a solid column from under the jaw to the shoulders (in shadow)
  L.softEllipse(X(0.5), Y(0.7), X(0.125), Y(0.13), 0, skinDk, 1, 0.35);
  L.softEllipse(X(0.5), Y(0.68), X(0.108), Y(0.1), 0, skin, 1, 0.4);
  L.softEllipse(X(0.5), Y(0.63), X(0.14), Y(0.05), 0, [150, 106, 84], 0.5, 0.2);

  // Head silhouette (wider than v1 so the face is not elongated)
  const face = [
    [0.5, 0.135],
    [0.566, 0.138],
    [0.626, 0.156],
    [0.674, 0.192],
    [0.706, 0.245],
    [0.716, 0.31],
    [0.714, 0.375],
    [0.7, 0.44],
    [0.672, 0.5],
    [0.648, 0.542],
    [0.608, 0.586],
    [0.566, 0.615],
    [0.53, 0.631],
    [0.5, 0.638],
    [0.47, 0.631],
    [0.434, 0.615],
    [0.392, 0.586],
    [0.352, 0.542],
    [0.328, 0.5],
    [0.3, 0.44],
    [0.286, 0.375],
    [0.284, 0.31],
    [0.294, 0.245],
    [0.326, 0.192],
    [0.374, 0.156],
    [0.434, 0.138],
  ].map((p) => [X(p[0]), Y(p[1])]);
  L.fillPoly(face, skin, 1);

  // Modelling: key light upper-left, so the right side and the jaw fall away
  L.softEllipse(X(0.725), Y(0.32), X(0.05), Y(0.17), 0, skinMid, 0.6, 0.25);
  L.softEllipse(X(0.735), Y(0.5), X(0.045), Y(0.14), 0, skinDk, 0.5, 0.25);
  L.softEllipse(X(0.275), Y(0.33), X(0.042), Y(0.15), 0, skinMid, 0.35, 0.25);
  // jaw + chin shadow
  L.softEllipse(X(0.5), Y(0.6), X(0.15), Y(0.045), 0, skinDk, 0.45, 0.2);
  L.softEllipse(X(0.5), Y(0.63), X(0.105), Y(0.03), 0, skinDp, 0.3, 0.25);
  // cheeks (a touch of warmth) and highlights
  L.softEllipse(X(0.37), Y(0.48), X(0.055), Y(0.045), 0, [216, 152, 130], 0.35, 0.2);
  L.softEllipse(X(0.62), Y(0.49), X(0.05), Y(0.04), 0, [212, 148, 126], 0.3, 0.2);
  L.softEllipse(X(0.43), Y(0.245), X(0.09), Y(0.05), 0, skinHl, 0.55, 0.12);
  L.softEllipse(X(0.6), Y(0.27), X(0.055), Y(0.045), 0, skinHl, 0.28, 0.15);
  L.softEllipse(X(0.36), Y(0.455), X(0.042), Y(0.028), 0, skinHl, 0.45, 0.18);
  L.softEllipse(X(0.5), Y(0.60), X(0.045), Y(0.016), 0, skinHl, 0.35, 0.2);

  // Ears
  for (const s of [-1, 1]) {
    const ex = 0.5 + s * 0.212;
    L.softEllipse(X(ex), Y(0.405), X(0.024), Y(0.044), 0, skin, 1, 0.6);
    L.softEllipse(X(ex + s * 0.004), Y(0.41), X(0.012), Y(0.026), 0, skinDk, 0.55, 0.35);
    L.softEllipse(X(ex + s * 0.007), Y(0.412), X(0.005), Y(0.017), 0, skinDp, 0.4, 0.4);
  }

  // Eyes
  const eyeCy = 0.402;
  for (const s of [-1, 1]) {
    const ecx = 0.5 + s * 0.071;
    // socket shadow
    L.softEllipse(X(ecx), Y(eyeCy - 0.016), X(0.055), Y(0.032), 0, skinMid, 0.55, 0.22);
    // sclera
    L.fillPoly(eyeLens(X(ecx), Y(eyeCy), X(0.041), Y(0.0165), Y(0.0105), 18), [242, 240, 236], 1);
    // iris, pupil, catchlight (both eyes look straight at the camera)
    const ix = X(ecx);
    const iy = Y(eyeCy + 0.0015);
    L.softEllipse(ix, iy, X(0.0128), Y(0.0136), 0, [96, 116, 132], 1, 0.7);
    L.softEllipse(ix, iy, X(0.0122), Y(0.013), 0, [68, 88, 106], 0.6, 0.4);
    L.softEllipse(ix, iy, X(0.0056), Y(0.0064), 0, [16, 16, 20], 1, 0.75);
    L.softEllipse(ix - X(0.0042), iy - Y(0.005), X(0.0034), Y(0.0036), 0, [252, 252, 252], 0.95, 0.25);
    L.softEllipse(ix + X(0.006), iy + Y(0.006), X(0.0022), Y(0.0022), 0, [230, 230, 232], 0.5, 0.3);
    // upper lid line + lashes
    const lid = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      lid.push([X(ecx) + (t - 0.5) * 2 * X(0.041), Y(eyeCy) - Y(0.0165) * Math.pow(Math.sin(Math.PI * t), 0.75)]);
    }
    for (let i = 0; i + 1 < lid.length; i++) line(L, lid[i][0], lid[i][1], lid[i + 1][0], lid[i + 1][1], [74, 52, 42], 0.9, 2.6);
    for (let i = 2; i < lid.length - 2; i += 2) {
      const t = i / (lid.length - 1);
      const g = Math.pow(Math.sin(Math.PI * t), 0.8);
      line(L, lid[i][0], lid[i][1], lid[i][0] + X(s * 0.004) + X(0.002), lid[i][1] + Y(0.008) * g + Y(0.002), [70, 50, 40], 0.7, 1.5);
    }
    // crease + lower lid
    L.softEllipse(X(ecx), Y(eyeCy - 0.031), X(0.043), Y(0.0045), 0, skinDk, 0.45, 0.25);
    const low = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      low.push([X(ecx) + (t - 0.5) * 2 * X(0.041), Y(eyeCy) + Y(0.0105) * Math.pow(Math.sin(Math.PI * t), 0.75)]);
    }
    for (let i = 0; i + 1 < low.length; i++) line(L, low[i][0], low[i][1], low[i + 1][0], low[i + 1][1], [168, 122, 100], 0.45, 1.6);
    // lash shadow on the upper sclera
    L.softEllipse(X(ecx), Y(eyeCy - 0.0135), X(0.034), Y(0.003), 0, [120, 104, 96], 0.35, 0.3);
    // eyebrow: tapered, slightly arched, with hair direction
    const bw = 0.06;
    const byy = 0.352;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = X(ecx - bw + t * 2 * bw);
      const arch = Y(0.016) * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.12) / 0.88)));
      const y = Y(byy) - arch + Y(0.004) * Math.sin(t * 5);
      const th = (6.2 - 3.6 * Math.abs(t - 0.42)) * (1 - 0.25 * Math.abs(t - 0.5));
      stampDot(L, x, y, Math.max(1.4, th), rng() < 0.25 ? hairDk : hair, 0.85);
      if (i % 2 === 0) line(L, x, y + th * 0.5, x + X(s * 0.006), y - th * 0.6, hair, 0.5, 1.1);
    }
  }

  // Nose: a modelled ridge, wings, nostrils and a tip highlight
  L.softEllipse(X(0.5) - X(0.021), Y(0.455), X(0.011), Y(0.075), 0, skinMid, 0.6, 0.2);
  L.softEllipse(X(0.5) + X(0.019), Y(0.455), X(0.0105), Y(0.07), 0, skinDk, 0.5, 0.2);
  L.softEllipse(X(0.5) - X(0.003), Y(0.44), X(0.008), Y(0.07), 0, skinHl, 0.4, 0.15);
  L.softEllipse(X(0.5), Y(0.503), X(0.034), Y(0.026), 0, skin, 0.85, 0.3);
  L.softEllipse(X(0.496), Y(0.495), X(0.016), Y(0.011), 0, skinHl, 0.7, 0.15);
  L.softEllipse(X(0.5) - X(0.022), Y(0.515), X(0.0115), Y(0.0078), 0, skinDp, 0.9, 0.28);
  L.softEllipse(X(0.5) + X(0.024), Y(0.515), X(0.0115), Y(0.0078), 0, skinDp, 0.9, 0.28);
  L.softEllipse(X(0.5) - X(0.022), Y(0.509), X(0.009), Y(0.0045), 0, [92, 56, 44], 0.45, 0.3);
  L.softEllipse(X(0.5) + X(0.024), Y(0.509), X(0.009), Y(0.0045), 0, [92, 56, 44], 0.45, 0.3);
  L.softEllipse(X(0.5), Y(0.531), X(0.038), Y(0.0095), 0, skinDk, 0.45, 0.22);
  L.softEllipse(X(0.5) - X(0.033), Y(0.497), X(0.013), Y(0.032), 0, skinDk, 0.32, 0.22);
  L.softEllipse(X(0.5) + X(0.033), Y(0.497), X(0.013), Y(0.032), 0, skinDk, 0.38, 0.22);
  // the ridge shadow where the nose meets the cheek
  L.softEllipse(X(0.5) - X(0.035), Y(0.50), X(0.012), Y(0.03), 0, skinDk, 0.3, 0.25);
  L.softEllipse(X(0.5) + X(0.035), Y(0.50), X(0.012), Y(0.03), 0, skinDk, 0.35, 0.25);

  // Mouth: philtrum, upper lip with a cupid's bow, lower lip with a highlight
  L.softEllipse(X(0.5), Y(0.552), X(0.016), Y(0.014), 0, skinDk, 0.35, 0.25);
  L.softEllipse(X(0.5), Y(0.548), X(0.007), Y(0.008), 0, skinDp, 0.35, 0.3);
  L.fillPoly(eyeLens(X(0.5), Y(0.571), X(0.043), Y(0.0125), Y(0.0), 16), lipUp, 1);
  L.softEllipse(X(0.5), Y(0.5685), X(0.03), Y(0.0035), 0, [128, 72, 70], 0.4, 0.4);
  // cupid's bow shadow
  L.softEllipse(X(0.5), Y(0.5595), X(0.014), Y(0.006), 0, skinDk, 0.4, 0.3);
  L.softEllipse(X(0.5), Y(0.5855), X(0.043), Y(0.0042), 0, [116, 64, 62], 0.85, 0.4);
  L.fillPoly(eyeLens(X(0.5), Y(0.597), X(0.04), Y(0.0), Y(0.0138), 16), lipLo, 1);
  L.softEllipse(X(0.495), Y(0.5935), X(0.016), Y(0.0055), 0, [218, 162, 152], 0.65, 0.2);
  for (const s of [-1, 1]) {
    L.softEllipse(X(0.5 + s * 0.043), Y(0.585), X(0.007), Y(0.007), 0, skinDk, 0.5, 0.4);
  }
  L.softEllipse(X(0.5), Y(0.613), X(0.03), Y(0.009), 0, skinDk, 0.3, 0.3);

  // Hair, pulled back with a visible hairline and strand structure
  const outer = [
    [0.5, 0.122],
    [0.576, 0.126],
    [0.64, 0.145],
    [0.688, 0.18],
    [0.722, 0.235],
    [0.734, 0.298],
    [0.728, 0.35],
    [0.7, 0.34],
    [0.652, 0.288],
    [0.588, 0.258],
    [0.5, 0.246],
    [0.412, 0.258],
    [0.348, 0.288],
    [0.3, 0.34],
    [0.272, 0.35],
    [0.266, 0.298],
    [0.278, 0.235],
    [0.312, 0.18],
    [0.36, 0.145],
    [0.424, 0.126],
  ].map((p) => [X(p[0]), Y(p[1])]);
  L.fillPoly(outer, hair, 1);
  L.softEllipse(X(0.5), Y(0.152), X(0.196), Y(0.08), 0, hair, 1, 0.5);
  L.softEllipse(X(0.5), Y(0.108), X(0.135), Y(0.052), 0, hair, 1, 0.5);
  // a low bun behind the crown: a wide mass, kept above the hairline
  L.softEllipse(X(0.5), Y(0.16), X(0.25), Y(0.062), 0, hair, 0.95, 0.45);
  // darken the hairline so it reads as an edge
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = X(0.272 + t * 0.456);
    const y = Y(0.351) - Y(0.104) * Math.pow(Math.sin(Math.PI * t), 1.5);
    stampDot(L, x, y, 2.2, hairDk, 0.5);
  }
  // strands
  for (let i = 0; i < 120; i++) {
    const s = i % 2 ? 1 : -1;
    const x0 = 0.5 + s * (0.06 + rng() * 0.16);
    let px = X(x0);
    let py = Y(0.13 + rng() * 0.09);
    const dirx = s * (0.35 + rng() * 0.55);
    const diry = 0.5 + rng() * 0.7;
    const len = 10 + rng() * 22;
    const bright = rng() < 0.45;
    for (let k = 0; k < len; k++) {
      const nx = px + dirx * 1.3;
      const ny = py + diry * 1.0;
      line(L, px, py, nx, ny, bright ? hairHl : hairDk, bright ? 0.16 + rng() * 0.16 : 0.2 + rng() * 0.2, 1.2);
      px = nx;
      py = ny;
    }
  }
  // sheen on the crown
  L.softEllipse(X(0.44), Y(0.155), X(0.085), Y(0.02), 0, hairHl, 0.45, 0.15);
  L.softEllipse(X(0.585), Y(0.142), X(0.05), Y(0.015), 0, hairHl, 0.35, 0.15);
  L.softEllipse(X(0.5), Y(0.205), X(0.16), Y(0.02), 0, hairHl, 0.18, 0.2);
  // soften the hairline edge: short strokes that cross it
  for (let i = 0; i < 110; i++) {
    const t = rng();
    const x0 = 0.272 + t * 0.456;
    const y0 = 0.351 - 0.104 * Math.pow(Math.sin(Math.PI * t), 1.5);
    const nx = x0 + (rng() - 0.5) * 0.024;
    const ny = y0 + 0.004 + rng() * 0.035;
    line(L, X(x0), Y(y0), X(nx), Y(ny), rng() < 0.45 ? hair : hairDk, 0.28 + rng() * 0.32, 1.4);
  }

  // Photo finishing: a light soften, a little desaturation and a vignette on
  // the big layer; the grain and skin texture go on AFTER the downsample, so
  // they survive at output scale instead of being averaged away.
  blurBox(L, 1);
  const inv = 1 / (S * S);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = L.d[i],
        g = L.d[i + 1],
        b = L.d[i + 2];
      const lum = 0.3 * r + 0.52 * g + 0.18 * b;
      const k = 0.3;
      const vx = (x / W - 0.5) * 2;
      const vy = (y / H - 0.5) * 2;
      const vig = 1 - 0.17 * Math.min(1, vx * vx + vy * vy);
      L.d[i] = Math.max(0, Math.min(255, (r * (1 - k) + lum * k) * vig));
      L.d[i + 1] = Math.max(0, Math.min(255, (g * (1 - k) + lum * k) * vig));
      L.d[i + 2] = Math.max(0, Math.min(255, (b * (1 - k) + lum * k) * vig));
    }
  }
  const tex = mulberry32(555);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const k = ((y * S + j) * W + (x * S + i)) * 4;
          r += L.d[k];
          g += L.d[k + 1];
          b += L.d[k + 2];
        }
      }
      r *= inv;
      g *= inv;
      b *= inv;
      const gn = (tex() - 0.5) * 8;
      const spot = tex() < 0.01 ? (tex() - 0.6) * 16 : 0;
      img.px(bx + x, by + y, r + gn + spot, g + gn + spot, b + gn + spot * 0.7, 1);
    }
  }
}


// ---------------------------------------------------------------------------
// MRZ (ICAO 9303 TD3)
// ---------------------------------------------------------------------------
function checkDigit(s) {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    let v;
    if (ch >= '0' && ch <= '9') v = ch.charCodeAt(0) - 48;
    else if (ch >= 'A' && ch <= 'Z') v = ch.charCodeAt(0) - 55;
    else v = 0;
    sum += v * w[i % 3];
  }
  return String(sum % 10);
}

// ---------------------------------------------------------------------------
// Stamps: three different houses' layouts, so the page reads as a real
// collection of stamps rather than one template.
// ---------------------------------------------------------------------------
function stampBar(opts) {
  const w = opts.w,
    h = opts.h;
  const L = new Img(w, h);
  const ink = opts.ink;
  const a = opts.inkAlpha ?? 0.88;
  L.rectOutline(2, 2, w - 4, h - 4, 3, ink[0], ink[1], ink[2], a);
  L.rect(2, 2, w - 4, 30, ink[0], ink[1], ink[2], a * 0.92);
  L.text('sans12b', opts.country, w / 2, 24, [252, 250, 245], 1, 1.4, 'c');
  L.text('sans10', opts.action, 14, 50, ink, a, 1.0, 'l');
  L.text('mono12', opts.date, 14, h - 16, ink, a, 0.4, 'l');
  L.text('sans10', opts.note ?? '', w - 14, 50, ink, a * 0.9, 0.4, 'r');
  L.text('sans10', opts.port, w - 14, h - 16, ink, a * 0.85, 0.3, 'r');
  if (opts.star) {
    starShape(L, w - 18, h - 30, 7, ink, a * 0.9);
  }
  inkNoise(L, mulberry32(opts.seed ?? 1), [7, 4], 0.72, 1.06);
  return L;
}

function stampBox(opts) {
  const w = opts.w,
    h = opts.h;
  const L = new Img(w, h);
  const ink = opts.ink;
  const a = opts.inkAlpha ?? 0.88;
  L.rectOutline(1, 1, w - 2, h - 2, 2.4, ink[0], ink[1], ink[2], a);
  L.rectOutline(6, 6, w - 12, h - 12, 1, ink[0], ink[1], ink[2], a * 0.7);
  L.text('mono13', opts.country, w / 2, 26, ink, a, 1.6, 'c');
  L.hline(10, w - 10, 32, 1, ink[0], ink[1], ink[2], a * 0.6);
  L.text('sans13', opts.action, w / 2, 52, ink, a, 1.0, 'c');
  L.text('mono12', opts.date, w / 2, 70, ink, a, 0.6, 'c');
  L.text('sans9', opts.note ?? opts.port, w / 2, 86, ink, a * 0.85, 0.4, 'c');
  inkNoise(L, mulberry32(opts.seed ?? 2), [5, 4], 0.74, 1.05);
  return L;
}

function stampArch(opts) {
  const w = opts.w,
    h = opts.h;
  const L = new Img(w, h);
  const ink = opts.ink;
  const a = opts.inkAlpha ?? 0.88;
  L.rectOutline(2, 2, w - 4, h - 4, 2.6, ink[0], ink[1], ink[2], a);
  L.hline(10, w - 10, 30, 1, ink[0], ink[1], ink[2], a * 0.7);
  L.hline(10, w - 10, h - 26, 1, ink[0], ink[1], ink[2], a * 0.7);
  L.text('serif13', opts.country, w / 2, 24, ink, a, 1.2, 'c');
  L.text('sans15b', opts.action, 14, 56, ink, a, 0.8, 'l');
  L.text('mono12', opts.date, w - 14, 56, ink, a, 0, 'r');
  L.text('sans10', opts.port, 14, h - 12, ink, a * 0.85, 0.4, 'l');
  L.text('mono10', opts.note ?? '', w - 14, 74, ink, a * 0.8, 0.3, 'r');
  inkNoise(L, mulberry32(opts.seed ?? 3), [6, 3], 0.72, 1.06);
  return L;
}

function starShape(L, cx, cy, r, col, a) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.42;
    pts.push([cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)]);
  }
  L.fillPoly(pts, col, a);
}

function arcText(L, cx, cy, r, text, style, col, a, which) {
  const adv = [];
  let total = 0;
  for (const ch of text) {
    const g = glyphOf(style, ch);
    adv.push(g.adv);
    total += g.adv;
  }
  const half = total / 2;
  let along = -half;
  for (let i = 0; i < text.length; i++) {
    const mid = along + adv[i] / 2;
    along += adv[i];
    const frac = mid / r;
    let theta, phi;
    if (which === 'top') {
      theta = -Math.PI / 2 + frac;
      phi = theta + Math.PI / 2;
    } else {
      theta = Math.PI / 2 - frac;
      phi = theta - Math.PI / 2;
    }
    const gx = cx + r * Math.cos(theta);
    const gy = cy + r * Math.sin(theta);
    const c = Math.cos(phi),
      s = Math.sin(phi);
    L.blitGlyphRot(gx - (adv[i] / 2) * c, gy - (adv[i] / 2) * s, glyphOf(style, text[i]), col, a, phi);
  }
}

function stampOval(opts) {
  const R = opts.r;
  const size = 2 * (R + 8);
  const L = new Img(size, size);
  const c = size / 2;
  const ink = opts.ink;
  const a = opts.inkAlpha ?? 0.88;
  L.ellipseStroke(c, c, R, 3.2, ink, a);
  L.ellipseStroke(c, c, R - 6, 1.3, ink, a * 0.8);
  L.ellipseStroke(c, c, R - 22, 1, ink, a * 0.45);
  arcText(L, c, c, R - 14, opts.top, 'sans11b', ink, a, 'top');
  arcText(L, c, c, R - 14, opts.bottom, 'sans11', ink, a * 0.95, 'bottom');
  let y = c - opts.center.length * 8 + 7;
  for (const [txt, sty] of opts.center) {
    L.text(sty, txt, c, y, ink, a, 0.5, 'c');
    y += 16;
  }
  starShape(L, c, c - R + 30, 6, ink, a * 0.85);
  inkNoise(L, mulberry32(opts.seed ?? 4), [6, 6], 0.74, 1.05);
  return L;
}

// ---------------------------------------------------------------------------
// Visa sticker
// ---------------------------------------------------------------------------
function visaLayer(w, h) {
  const L = new Img(w, h);
  const ink = [30, 40, 60];
  L.rect(0, 0, w, h, 230, 237, 246, 1);
  guilloche(L, 0, 0, w, h, [188, 204, 228], 0.5, 20, 33);
  L.rectOutline(1, 1, w - 2, h - 2, 2.4, ink[0], ink[1], ink[2], 0.9);
  L.rectOutline(7, 7, w - 14, h - 14, 1, ink[0], ink[1], ink[2], 0.6);
  L.rect(8, 8, w - 16, 36, 220, 229, 244, 1);
  L.hline(8, w - 8, 44, 1.2, ink[0], ink[1], ink[2], 0.7);
  L.text('sans15b', 'FEDERATION OF SVALVIK', 20, 33, ink, 1, 1.0, 'l');
  L.text('sans11', 'VISA · VIISA', w - 20, 33, ink, 0.95, 0.6, 'r');
  L.text('sans11', 'TYPE', 22, 68, ink, 0.8, 0.4, 'l');
  L.text('serif22', 'C', 22, 94, ink, 1, 0, 'l');
  L.text('sans11', 'VALID FROM', 64, 68, ink, 0.8, 0.4, 'l');
  L.text('mono13', '03 JAN 2025', 64, 92, ink, 1, 0, 'l');
  L.text('sans11', 'VALID UNTIL', 196, 68, ink, 0.8, 0.4, 'l');
  L.text('mono13', '02 APR 2025', 196, 92, ink, 1, 0, 'l');
  L.text('sans11', 'VISA No.', 22, 124, ink, 0.8, 0.4, 'l');
  L.text('mono13', 'SV-2025-04417', 22, 148, ink, 1, 0, 'l');
  L.text('sans11', 'PURPOSE / DAYS', 200, 124, ink, 0.8, 0.4, 'l');
  L.text('sans13', 'TOURISM · 30 DAYS', 200, 148, ink, 1, 0.3, 'l');
  L.rect(16, 170, w - 32, 30, 198, 40, 44, 1);
  L.text('sans12b', 'NO PAID EMPLOYMENT — ART. 14(2)', w / 2, 190, [255, 255, 255], 1, 0.7, 'c');
  L.text('serif11', 'Issued at SVALVIK HARBOUR. The bearer must leave before the visa expires.', 22, 222, ink, 0.85, 0.2, 'l');
  // barcode with guard bars
  const rng = mulberry32(9911);
  const barY = 238,
    barH = 26;
  L.rect(20, barY, 2, barH, ink[0], ink[1], ink[2], 0.9);
  let bx = 26;
  while (bx < w - 28) {
    const bw = 1 + Math.round(rng() * 3);
    L.rect(bx, barY, bw, barH, ink[0], ink[1], ink[2], 0.85);
    bx += bw + 2 + Math.round(rng() * 3);
  }
  L.rect(w - 24, barY, 2, barH, ink[0], ink[1], ink[2], 0.9);
  L.text('mono10', 'SV-2025-04417<<<<<<<<<<<', 20, 284, ink, 0.8, 0.4, 'l');
  return L;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------
const W = 1024,
  H = 1024;
const PL = 0,
  PLW = 508;
const PR = 516,
  PRW = 508;
const CX = 26,
  CW = PLW - 52;

const DATA = {
  country: 'REPUBLIC OF VESTMARK',
  native: 'REPUBLIKEN VESTMARK',
  code: 'VSM',
  passportNo: 'VSM482011',
  surname: 'SØRENSEN',
  given: 'INGRID MARIT',
  nationality: 'VESTMARISH',
  dob: '14 MAR 1991',
  dobMrz: '910314',
  sex: 'F',
  pob: 'HOLMVIK',
  issue: '12 MAR 2024',
  expiry: '11 MAR 2034',
  expiryMrz: '340311',
  authority: 'RÍKISLÖGREGLAN',
  personal: '1403912748',
  langs: 'VESTMARISH · ENGLISH',
};

function deaccentUpper(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '<')
    .replace(/<+/g, '<');
}

function buildMRZ() {
  const num = DATA.passportNo.padEnd(9, '<');
  const nameField = (deaccentUpper(DATA.surname) + '<<' + deaccentUpper(DATA.given)).padEnd(39, '<').slice(0, 39);
  const l1 = ('P<' + DATA.code + nameField).padEnd(44, '<').slice(0, 44);
  const cd1 = checkDigit(num);
  const cd2 = checkDigit(DATA.dobMrz);
  const cd3 = checkDigit(DATA.expiryMrz);
  const pers = DATA.personal.padEnd(14, '<').slice(0, 14);
  const cd4 = checkDigit(pers);
  const cd5 = checkDigit(num + cd1 + DATA.dobMrz + cd2 + DATA.expiryMrz + cd3 + pers + cd4);
  const l2 = (num + cd1 + DATA.code + DATA.dobMrz + cd2 + DATA.sex + DATA.expiryMrz + cd3 + pers + cd4 + cd5)
    .padEnd(44, '<')
    .slice(0, 44);
  return [l1, l2];
}

function drawLeftPage(img) {
  img.rect(PL, 0, PLW, H, PAPER_L[0], PAPER_L[1], PAPER_L[2], 1);
  guilloche(img, 4, 8, PLW - 8, H - 16, GUIL_L, 0.32, 26, 7);
  drawEmblem(img, 254, 726, 152, [150, 165, 150], 0.05, false);

  drawEmblem(img, 254, 60, 35, NAVY, 0.95, false);
  img.text('serif30b', DATA.country, 254, 140, NAVY, 1, 0.4, 'c');
  img.text('sans10', DATA.native.split('').join(' '), 254, 164, SUB, 0.95, 1.6, 'c');
  img.hline(CX, CX + CW, 178, 2.2, NAVY[0], NAVY[1], NAVY[2], 0.95);
  img.text('serif48b', 'PASSPORT', 254, 228, NAVY, 1, 12, 'c');
  img.text('sans10', 'BIOMETRIC · SERIES C', 254, 248, SUB, 0.9, 2.4, 'c');

  const by0 = 264,
    by1 = 324;
  img.rect(CX, by0, CW, by1 - by0, 226, 231, 224, 0.75);
  img.rectOutline(CX, by0, CW, by1 - by0, 1.4, NAVY[0], NAVY[1], NAVY[2], 0.75);
  img.vline(CX + 78, by0, by1, 1, NAVY[0], NAVY[1], NAVY[2], 0.5);
  img.vline(CX + 172, by0, by1, 1, NAVY[0], NAVY[1], NAVY[2], 0.5);
  img.text('sans9', 'TYPE / TIPE', CX + 12, by0 + 20, LABEL, 1, 0.8, 'l');
  img.text('serif22', 'P', CX + 12, by0 + 48, INK, 1, 0, 'l');
  img.text('sans9', 'CODE', CX + 90, by0 + 20, LABEL, 1, 0.8, 'l');
  img.text('serif22', DATA.code, CX + 90, by0 + 48, INK, 1, 0, 'l');
  img.text('sans9', 'PASSPORT No. / PASS No.', CX + 184, by0 + 20, LABEL, 1, 0.8, 'l');
  img.text('mono17', DATA.passportNo, CX + 184, by0 + 48, INK, 1, 0, 'l');

  // Portrait + laminate patch
  const px0 = CX + 4,
    py0 = 342,
    pw = 168,
    ph = 218;
  drawPortrait(img, px0, py0, pw, ph);
  img.rectOutline(px0 - 1, py0 - 1, pw + 2, ph + 2, 1.4, INK[0], INK[1], INK[2], 0.8);
  for (let y = 0; y < ph; y++) {
    const tt = y / ph;
    const r = 176 + 46 * Math.sin(tt * 11);
    const g = 190 + 40 * Math.sin(tt * 11 + 2);
    const b = 210 + 30 * Math.sin(tt * 11 + 4);
    for (let d = 0; d < 15; d++) {
      const fade = d < 2 ? 0.5 : 0.22 * (1 - (d - 2) / 13);
      img.px(px0 + pw - 15 + d, py0 + 2 + y, r, g, b, fade);
    }
  }
  img.text('sans8b', 'VESTMARK', px0 + pw - 8, py0 + ph / 2 + 26, [250, 250, 250], 0.5, 0.6, 'c');

  const flx = CX + 190,
    fvx = CX + 324;
  const rows = [
    ['SURNAME / ETTERNAVN', DATA.surname, 'serif20b'],
    ['GIVEN NAMES / FORNAVN', DATA.given, 'serif18'],
    ['NATIONALITY / STATSB.', DATA.nationality, 'serif18'],
    ['BIRTH DATE / FØDSELSD.', DATA.dob, 'serif18'],
    ['PERSONAL No. / PERS.NR.', DATA.personal, 'mono13'],
    ['SEX / KJØNN', DATA.sex, 'serif18'],
    ['PLACE OF BIRTH / FØDEST.', DATA.pob, 'serif18'],
    ['ISSUED / UTSTEDT', DATA.issue, 'serif18'],
    ['EXPIRY / UTLØPER', DATA.expiry, 'serif18'],
    ['AUTHORITY / MYNDE', DATA.authority, 'serif15'],
  ];
  let ry = 358;
  for (const [lab, val, sty] of rows) {
    img.text('sans9', lab, flx, ry, LABEL, 1, 0.3, 'l');
    img.text(sty, val, fvx, ry + 3, INK, 1, 0, 'l');
    img.hline(flx, CX + CW, ry + 12, 1, HAIR[0], HAIR[1], HAIR[2], 0.6);
    ry += 22;
  }

  img.hline(CX, CX + CW, 588, 1.4, NAVY[0], NAVY[1], NAVY[2], 0.75);
  img.text('sans11b', 'OBSERVATIONS · IMPORTANT', CX, 606, NAVY, 1, 1.6, 'l');
  const notes = [
    'This passport is the property of the Republic of Vestmark and must be',
    'surrendered on demand. The bearer is a citizen of Vestmark; the right of',
    'abode extends to all fourteen islands of the Vestmarish archipelago.',
    'Marine, bird and shore life are protected under the Sea Act 2019; a sea',
    'permit is required for landing on the bird islands (§14).',
  ];
  let ny = 626;
  for (const t of notes) {
    img.text('serif12', t, CX, ny, INK, 0.95, 0, 'l');
    ny += 18;
  }
  img.hline(CX, CX + CW, 728, 1, HAIR[0], HAIR[1], HAIR[2], 0.6);
  img.text('sans9', 'LANGUAGES / SPRÅK', CX, 746, LABEL, 1, 0.3, 'l');
  img.text('serif15', DATA.langs, CX + 150, 747, INK, 1, 0, 'l');
  img.text('sans9', 'RIGHT OF ABODE', CX, 770, LABEL, 1, 0.3, 'l');
  img.text('serif15', 'ALL FOURTEEN ISLANDS', CX + 150, 771, INK, 1, 0, 'l');
  img.text('sans9', 'HOLDER’S SIGNATURE', CX, 802, LABEL, 1, 0.3, 'l');
  const sglyph = mulberry32(4242);
  let sx = CX + 150,
    sy = 808;
  for (let i = 0; i < 26; i++) {
    const nx = sx + 9 + sglyph() * 5;
    const nyt = sy + Math.sin(i * 1.1) * 6 + (sglyph() - 0.5) * 4;
    line(img, sx, sy, nx, nyt, [40, 48, 96], 0.85, 1.6);
    sx = nx;
    sy = nyt;
  }
  img.hline(CX + 150, CX + CW, 818, 1, HAIR[0], HAIR[1], HAIR[2], 0.6);
  img.rectOutline(CX, 828, CW, 50, 1, NAVY[0], NAVY[1], NAVY[2], 0.4);
  img.text('sans8', 'FOR OFFICIAL USE · ENDORSEMENTS', CX + 8, 842, LABEL, 0.9, 0.8, 'l');
  img.hline(CX + 8, CX + CW - 8, 852, 1, HAIR[0], HAIR[1], HAIR[2], 0.5);
  img.hline(CX + 8, CX + CW - 8, 866, 1, HAIR[0], HAIR[1], HAIR[2], 0.5);

  const mrzY = 892;
  img.rect(PL, mrzY, PLW, H - mrzY, 244, 245, 240, 1);
  img.hline(PL, PLW, mrzY, 1.4, NAVY[0], NAVY[1], NAVY[2], 0.6);
  const [l1, l2] = buildMRZ();
  const mw = img.tw('mono17', l1, 0);
  const mx = Math.round((PLW - mw) / 2);
  img.text('mono17', l1, mx, mrzY + 50, INK, 1, 0, 'l');
  img.text('mono17', l2, mx, mrzY + 78, INK, 1, 0, 'l');
  img.text('sans8', 'VSM · HOLMVIK · 12 MAR 2024 · SERIES C', PLW / 2, mrzY + 106, SUB, 0.85, 1.4, 'c');
  img.rect(PL, H - 6, PLW, 6, 226, 230, 222, 1);
}

function drawRightPage(img) {
  img.rect(PR, 0, PRW, H, PAPER_R[0], PAPER_R[1], PAPER_R[2], 1);
  guilloche(img, PR + 4, 8, PRW - 8, H - 16, GUIL_R, 0.4, 30, 11);
  drawEmblem(img, PR + PRW / 2, 500, 168, [186, 176, 150], 0.055, false);
  // security border
  img.rectOutline(PR + 12, 12, PRW - 24, H - 24, 1, GOLD[0], GOLD[1], GOLD[2], 0.55);
  img.rectOutline(PR + 16, 16, PRW - 32, H - 32, 2.6, GOLD[0], GOLD[1], GOLD[2], 0.3);

  img.text('sans12b', 'VISAS  ·  OBSERVATIONS', PR + PRW / 2, 54, NAVY, 1, 1.8, 'c');
  img.hline(PR + 26, PR + PRW - 26, 66, 1.2, NAVY[0], NAVY[1], NAVY[2], 0.7);

  img.compositeRot(
    stampBar({
      w: 186,
      h: 92,
      country: 'VESTMARK',
      action: 'DEPARTURE',
      port: 'HOLMVIK',
      date: '02 JUN 2024',
      note: 'UTREISE',
      ink: STAMP_BLUE,
      seed: 21,
    }),
    PR + 118,
    162,
    -8,
    0.9,
  );
  img.compositeRot(
    stampBar({
      w: 196,
      h: 92,
      country: 'NORÐREY',
      action: 'ENTRY',
      port: 'SEYÐISFJÖRÐUR',
      date: '02 JUN 2024',
      note: 'INNREISA',
      star: true,
      ink: STAMP_GREEN,
      seed: 22,
    }),
    PR + 352,
    178,
    6,
    0.9,
  );
  img.compositeRot(
    stampArch({
      w: 196,
      h: 88,
      country: 'Norðrey Customs',
      action: 'EXIT',
      port: 'SEYÐISFJÖRÐUR',
      date: '09 JUN 2024',
      note: 'ÚTREISA · O.114',
      ink: STAMP_GREEN,
      seed: 23,
    }),
    PR + 152,
    268,
    -5,
    0.86,
  );
  img.compositeRot(
    stampBar({
      w: 188,
      h: 92,
      country: 'VESTMARK',
      action: 'ARRIVAL',
      port: 'HOLMVIK',
      date: '09 JUN 2024',
      note: 'INNREISE',
      ink: STAMP_BLUE,
      seed: 24,
    }),
    PR + 380,
    312,
    7,
    0.9,
  );
  img.compositeRot(
    stampBar({
      w: 200,
      h: 92,
      country: 'BRIMNESS',
      action: 'ENTRY',
      port: 'PORT BRIM',
      date: '15 AUG 2024',
      note: 'ADMITTED 30 DAYS',
      ink: STAMP_RED,
      seed: 25,
    }),
    PR + 126,
    396,
    -9,
    0.9,
  );
  img.compositeRot(
    stampBox({
      w: 150,
      h: 96,
      country: 'BRIMNESS',
      action: 'DEPARTED',
      date: '22 AUG 2024',
      port: 'PORT BRIM',
      ink: STAMP_RED,
      seed: 26,
    }),
    PR + 388,
    402,
    5,
    0.88,
  );
  img.compositeRot(
    stampOval({
      r: 62,
      top: 'KETILSEY',
      bottom: 'KETILSEY HAVN',
      center: [
        ['ENTRY', 'sans11b'],
        ['04 NOV', 'mono12'],
        ['2024', 'mono12'],
      ],
      ink: STAMP_VIOLET,
      seed: 27,
    }),
    PR + 140,
    508,
    -6,
    0.9,
  );
  img.compositeRot(
    stampArch({
      w: 176,
      h: 84,
      country: 'Norðrey Grænsevakt',
      action: 'ENTRY',
      port: 'SEYÐISFJÖRÐUR',
      date: '27 MAY 2025',
      note: 'INNREISA · O.207',
      ink: STAMP_SEPIA,
      inkAlpha: 0.62,
      seed: 28,
    }),
    PR + 366,
    536,
    8,
    0.72,
  );

  img.compositeRot(
    stampBox({
      w: 148,
      h: 92,
      country: 'KETILSEY',
      action: 'DEPARTED',
      date: '05 JAN 2025',
      port: 'KETILSEY HAVN',
      ink: STAMP_VIOLET,
      seed: 32,
    }),
    PR + 332,
    486,
    7,
    0.86,
  );

  const vis = visaLayer(400, 300);
  img.compositeRot(vis, PR + PRW / 2 + 4, 706, 1.5, 1);
  img.text('sans9', 'SVALVIK · VISA STICKER', PR + 40, 596, SUB, 0.9, 1.0, 'l');
  img.text('serifIt14', 'single entry — see page 7', PR + 250, 636, [60, 70, 120], 0.7, 0.2, 'c');

  img.compositeRot(
    stampOval({
      r: 66,
      top: 'REPUBLIC OF VESTMARK',
      bottom: 'HOLMVIK HARBOUR',
      center: [
        ['HARBOUR', 'sans11b'],
        ['DUES 60 KR', 'mono12'],
        ['02 VI 24', 'mono12'],
      ],
      ink: STAMP_BLUE,
      seed: 29,
    }),
    PR + 116,
    894,
    -7,
    0.9,
  );
  img.compositeRot(
    stampOval({
      r: 58,
      top: 'SVALVIK',
      bottom: 'ENTRY · SVALVIK',
      center: [
        ['ENTRY', 'sans11b'],
        ['03 JAN', 'mono12'],
        ['2025', 'mono12'],
      ],
      ink: STAMP_BLACK,
      seed: 30,
    }),
    PR + 396,
    900,
    9,
    0.88,
  );
  img.compositeRot(
    stampBox({
      w: 140,
      h: 92,
      country: 'VESTMARK',
      action: 'TRANSIT',
      date: '11 JAN 2025',
      port: 'HOLMVIK',
      ink: STAMP_BLUE,
      inkAlpha: 0.6,
      seed: 31,
    }),
    PR + 250,
    880,
    -3,
    0.7,
  );
}

function main() {
  const t0 = Date.now();
  const img = new Img(W, H);
  img.rect(0, 0, W, H, 118, 116, 110, 1);
  img.rect(PL, 0, PLW, H, PAPER_L[0], PAPER_L[1], PAPER_L[2], 1);
  img.rect(PR, 0, PRW, H, PAPER_R[0], PAPER_R[1], PAPER_R[2], 1);
  drawLeftPage(img);
  drawRightPage(img);

  // Paper grain (deterministic), applied in 2x2 blocks so it costs little
  // after PNG filtering; then the gutter shadow that reads as an open book.
  const gr = mulberry32(8686);
  for (let by = 0; by < H; by += 2) {
    for (let bx = 0; bx < W; bx += 2) {
      const n = (gr() - 0.5) * 6;
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const x = bx + i,
            y = by + j;
          if (x >= W || y >= H) continue;
          const k = (y * W + x) * 4;
          img.d[k] = Math.max(0, Math.min(255, img.d[k] + n));
          img.d[k + 1] = Math.max(0, Math.min(255, img.d[k + 1] + n));
          img.d[k + 2] = Math.max(0, Math.min(255, img.d[k + 2] + n));
        }
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (let d = 0; d < 16; d++) {
      const a = 0.5 * (1 - d / 16) * (1 - d / 16);
      img.px(PLW - 1 - d, y, 58, 56, 52, a * 0.5);
      img.px(PR + d, y, 58, 56, 52, a * 0.5);
    }
  }
  img.rect(PLW, 0, PR - PLW, H, 92, 90, 84, 1);
  for (let y = 0; y < H; y++) {
    for (let d = 0; d < 12; d++) {
      const a = 0.6 * (1 - d / 12) * (1 - d / 12);
      img.px(PLW + d, y, 36, 34, 30, a);
      img.px(PR - 1 - d, y, 36, 34, 30, a);
    }
  }

  const rgb = img.toRGB();
  const png = encodePNG(W, H, rgb);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'entry.png');
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} ${png.length} bytes in ${Date.now() - t0} ms (${W}x${H})`);
}

main();
