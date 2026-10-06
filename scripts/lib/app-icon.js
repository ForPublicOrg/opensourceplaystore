/* The app icon as PNG files, for the web app manifest and the iPhone home
   screen. Phones want bitmaps there (Android's installer and iOS both pass
   over SVG icons), so the build draws the mark from public/favicon.svg's own
   geometry instead of keeping PNG copies in the repo that could drift from it.

   Zero dependencies: each pixel's coverage comes from its distance to the
   shapes (the edge is anti-aliased over one pixel), and the file is written
   with the zlib that ships with Node. */
'use strict';

const zlib = require('zlib');

/* favicon.svg, in its 64-unit box: a green square with 16-unit corners and
   an outlined play triangle, a 5.5-unit white stroke with round joins. */
const BOX = 64;
const CORNER = 16;
const STROKE = 5.5;
const TRIANGLE = [[25, 18.5], [25, 45.5], [47.5, 32]];
const GREEN = [0x0c, 0x7c, 0x59];
const WHITE = [0xff, 0xff, 0xff];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/* Signed distance to the rounded square: negative inside. */
function squareDistance(px, py) {
  const qx = Math.abs(px - BOX / 2) - BOX / 2 + CORNER;
  const qy = Math.abs(py - BOX / 2) - BOX / 2 + CORNER;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - CORNER;
}

/* A stroke with round joins covers exactly the points within half its
   width of the outline, so the distance to the nearest edge is all it takes. */
function triangleDistance(px, py) {
  let d = Infinity;
  for (let i = 0; i < TRIANGLE.length; i++) {
    d = Math.min(d, segmentDistance(px, py, TRIANGLE[i], TRIANGLE[(i + 1) % TRIANGLE.length]));
  }
  return d;
}

/* `fullBleed` paints every pixel green, for platforms that cut their own
   shape out of the icon (Android's maskable icons, the iPhone home screen).
   `glyph` scales the triangle about the centre: a maskable icon keeps its
   content inside the middle 80%, so its triangle is drawn at 0.8. */
function drawIcon(size, { fullBleed = false, glyph = 1 } = {}) {
  const k = size / BOX;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    /* Each row starts with its filter type byte, 0 (none). */
    for (let x = 0; x < size; x++) {
      const ux = (x + 0.5) / k;
      const uy = (y + 0.5) / k;
      const back = fullBleed ? 1 : clamp01(0.5 - squareDistance(ux, uy) * k);
      const gx = BOX / 2 + (ux - BOX / 2) / glyph;
      const gy = BOX / 2 + (uy - BOX / 2) / glyph;
      const fore = clamp01(0.5 - (triangleDistance(gx, gy) - STROKE / 2) * glyph * k);
      /* White stroke over the green square, kept as straight alpha. */
      const alpha = fore + back * (1 - fore);
      const o = y * stride + 1 + x * 4;
      for (let c = 0; c < 3; c++) {
        raw[o + c] = alpha ? Math.round((WHITE[c] * fore + GREEN[c] * back * (1 - fore)) / alpha) : 0;
      }
      raw[o + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, raw);
}

/* ---------- PNG ---------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/* 8-bit RGBA, no interlacing; `raw` already carries each row's filter byte. */
function encodePng(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* Every icon the site ships, by the path it is served from. The manifest
   (public/site.webmanifest) and the page head refer to these names. */
const APP_ICONS = {
  'icons/icon-192.png': [192],
  'icons/icon-512.png': [512],
  'icons/icon-maskable-512.png': [512, { fullBleed: true, glyph: 0.8 }],
  'icons/apple-touch-icon.png': [180, { fullBleed: true }],
};

module.exports = { drawIcon, APP_ICONS };
