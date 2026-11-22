// Erzeugt die PNG-Icons ohne externe Abhängigkeiten (gleiches Motiv wie icons/icon.svg).
// Aufruf: node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x1f, 0x6f, 0x5c];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Abstand eines Punkts zu einer Strecke
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Liefert [r,g,b,a] im 512er-Koordinatensystem. full = randlos (iOS/maskable).
function sample(x, y, full) {
  let inside = true;
  if (!full) {
    const r = 112;
    const cx = Math.min(Math.max(x, r), 512 - r);
    const cy = Math.min(Math.max(y, r), 512 - r);
    inside = Math.hypot(x - cx, y - cy) <= r && x >= 0 && y >= 0 && x <= 512 && y <= 512;
  }
  if (!inside) return [0, 0, 0, 0];
  // Weißer Haken
  const d = Math.min(segDist(x, y, 168, 300, 228, 360), segDist(x, y, 228, 360, 344, 232));
  if (d <= 22) return [255, 255, 255, 1];
  // Halbtransparenter Balken
  const bx = Math.min(Math.max(x, 148), 364);
  if (Math.hypot(x - bx, y - 170) <= 20) return BG.map((c) => Math.round(c + (255 - c) * 0.55)).concat(1);
  return [...BG, 1];
}

function render(size, full) {
  const S = 4; // Supersampling für glatte Kanten
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const [cr, cg, cb, ca] = sample(((px + (sx + 0.5) / S) / size) * 512, ((py + (sy + 0.5) / S) / size) * 512, full);
        r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
      }
      const o = 1 + px * 4;
      if (a) { row[o] = Math.round(r / a); row[o + 1] = Math.round(g / a); row[o + 2] = Math.round(b / a); }
      row[o + 3] = Math.round((a / (S * S)) * 255);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = new URL("../icons/", import.meta.url);
writeFileSync(new URL("icon-192.png", out), render(192, true));
writeFileSync(new URL("icon-512.png", out), render(512, true));
writeFileSync(new URL("apple-touch-icon.png", out), render(180, true));
console.log("Icons erzeugt.");
