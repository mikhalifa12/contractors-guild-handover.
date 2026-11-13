#!/usr/bin/env node
/**
 * Generate the PWA icon set (public/icons/*.png, app/icon.png,
 * app/apple-icon.png) without external dependencies.
 *
 * The brand mark is drawn programmatically to match the design system in
 * app/globals.css: an ember gradient field, a dark industrial panel and a
 * paper "CG" ring monogram. Run `npm run icons` after changing the design.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

/* ------------------------------------------------------------------ */
/* Minimal PNG encoder (RGBA, 8-bit, no interlace)                     */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // compression, filter and interlace stay 0.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size * 4; x += 1) {
      const value = rgba[y * size * 4 + x];
      raw[y * (size * 4 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(value * 255)));
    }
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Tiny canvas with source-over blending                               */
/* ------------------------------------------------------------------ */

function makeCanvas(size) {
  return { size, data: new Float64Array(size * size * 4) };
}

function blendPixel(canvas, x, y, [r, g, b], alpha) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size || alpha <= 0) return;
  const i = (y * canvas.size + x) * 4;
  const dstA = canvas.data[i + 3];
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c += 1) {
    canvas.data[i + c] = ([r, g, b][c] * alpha + canvas.data[i + c] * dstA * (1 - alpha)) / outA;
  }
  canvas.data[i + 3] = outA;
}

/**
 * Fill a shape defined by an inside(point) predicate, 2x2 supersampled.
 * `point` is in pixel-centre coordinates (0..size).
 */
function fillShape(canvas, inside, color, alpha = 1) {
  const { size } = canvas;
  const step = 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (const [dx, dy] of [
        [-step, -step],
        [step, -step],
        [-step, step],
        [step, step],
      ]) {
        if (inside(x + dx, y + dy)) hits += 1;
      }
      if (hits > 0) blendPixel(canvas, x, y, color, alpha * (hits / 4));
    }
  }
}

/**
 * Fill the whole canvas with a colour computed per pixel (no supersampling
 * needed — gradients are smooth by nature).
 */
function fillGradient(canvas, colorAt) {
  const { size } = canvas;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      blendPixel(canvas, x, y, colorAt((x + 0.5) / size, (y + 0.5) / size), 1);
    }
  }
}

function hex(hexString) {
  const value = Number.parseInt(hexString.replace('#', ''), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

const COLORS = {
  ink950: hex('#07080a'),
  ink900: hex('#0d0f12'),
  ember500: hex('#f26a0a'),
  ember600: hex('#d9560a'),
  ember700: hex('#a8420a'),
  ember400: hex('#ff8f42'),
  paper: hex('#f4f5f7'),
};

/* ------------------------------------------------------------------ */
/* Brand composition                                                   */
/* ------------------------------------------------------------------ */

function roundRectInside(x, y, cx, cy, half, radius) {
  const qx = Math.abs(x - cx) - (half - radius);
  const qy = Math.abs(y - cy) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return Math.max(outside, Math.min(Math.max(qx, qy), 0)) - radius <= 0;
}

function ringInside(x, y, cx, cy, rOuter, rInner, gapHalfAngleDeg) {
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < rInner || dist > rOuter) return false;
  if (gapHalfAngleDeg === null) return true;
  // Gap faces right (towards positive x), centred on 0°.
  const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  return angle > gapHalfAngleDeg;
}

/**
 * Draw the full icon at the given pixel size.
 * `scale` shrinks the emblem for the maskable variant (safe zone).
 */
function drawIcon(size, { maskable = false } = {}) {
  const canvas = makeCanvas(size);
  const s = size;

  // 1. Ember gradient field (top-left ember-500 to bottom-right ember-700).
  fillShape(canvas, () => true, COLORS.ink950);
  fillGradient(canvas, (u, v) => {
    const t = (u + v) / 2;
    const a = COLORS.ember500;
    const b = COLORS.ember700;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  });

  // 2. Dark industrial panel with a thin ember keyline.
  const panelHalf = (maskable ? 0.29 : 0.33) * s;
  const cx = s / 2;
  const cy = s / 2;
  const keyline = 0.014 * s;
  fillShape(canvas, (x, y) => roundRectInside(x, y, cx, cy, panelHalf, 0.09 * s), COLORS.ember400);
  fillShape(
    canvas,
    (x, y) => roundRectInside(x, y, cx, cy, panelHalf - keyline, 0.08 * s),
    COLORS.ink900
  );

  // 3. CG ring monogram.
  const ringR = (maskable ? 0.095 : 0.108) * s;
  const ringOuter = ringR;
  const ringInner = ringR - 0.038 * s;
  const offset = ringR * 1.28;
  const cy2 = cy;
  fillShape(
    canvas,
    (x, y) => ringInside(x, y, cx - offset, cy2, ringOuter, ringInner, 55),
    COLORS.paper
  );
  fillShape(
    canvas,
    (x, y) => ringInside(x, y, cx + offset, cy2, ringOuter, ringInner, 55),
    COLORS.paper
  );
  // Crossbar of the G.
  const barHalf = 0.016 * s;
  fillShape(
    canvas,
    (x, y) =>
      Math.abs(y - cy2) <= barHalf &&
      x >= cx + offset - 0.01 * s &&
      x <= cx + offset + ringR * 0.92,
    COLORS.paper
  );

  return canvas;
}

function canvasToPng(canvas) {
  // encodePng scales 0..1 floats to bytes itself — pass the raw floats.
  return encodePng(canvas.size, canvas.data);
}

/* ------------------------------------------------------------------ */
/* Emission                                                            */
/* ------------------------------------------------------------------ */

const projectRoot = resolve(process.cwd());
const publicIcons = join(projectRoot, 'public', 'icons');
const appDir = join(projectRoot, 'app');
mkdirSync(publicIcons, { recursive: true });

const outputs = [
  { file: join(publicIcons, 'icon-192.png'), size: 192 },
  { file: join(publicIcons, 'icon-512.png'), size: 512 },
  { file: join(publicIcons, 'maskable-512.png'), size: 512, maskable: true },
  { file: join(appDir, 'icon.png'), size: 64 },
  { file: join(appDir, 'apple-icon.png'), size: 180 },
];

for (const { file, size, maskable } of outputs) {
  const png = canvasToPng(drawIcon(size, { maskable: Boolean(maskable) }));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`✓ ${file} (${size}x${size}${maskable ? ', maskable' : ''})`);
}
