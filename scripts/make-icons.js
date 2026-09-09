// PWA ikonkalarini (PNG) `public/icon.svg` uslubida generatsiya qiladi.
//
// Nega kerak: manifestda faqat bitta SVG ikonka bor edi (`sizes: "any"`).
// Android ba'zi joylarda SVG'ni qabul qiladi, lekin iOS `apple-touch-icon`
// uchun PNG talab qiladi — ya'ni "Bosh ekranga qo'shish" da ikonka
// noto'g'ri (oq/bo'sh) ko'rinardi. Maskable variant ham yo'q edi.
//
// Tashqi bog'liqliksiz: PNG qo'lda kodlanadi (zlib Node'ning o'zida bor).
// Ishga tushirish:  node scripts/make-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');

const BG = [13, 17, 23];      // #0d1117 — tashqi fon
const ACCENT = [217, 119, 87]; // #d97757 — Claude accent
const FG = [13, 17, 23];       // belgi rangi (fon bilan bir xil)

// --- geometriya yordamchilari ---

function insideRoundedRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x >= rx + w || y >= ry + h) return false;
  const left = x - rx;
  const right = rx + w - 1 - x;
  const top = y - ry;
  const bottom = ry + h - 1 - y;
  // Burchak zonasida emasmiz — to'g'ridan-to'g'ri ichkarida.
  if (Math.min(left, right) >= r || Math.min(top, bottom) >= r) return true;
  // Qaysi burchakka yaqinligini `left < right` / `top < bottom` hal qiladi.
  // (Avval bu yerda `Math.min(...)` natijasi ishlatilgani uchun markaz
  // HAR DOIM chap-yuqori burchakka tushardi va faqat bitta burchak
  // yumaloqlanardi.)
  const cx = left < right ? rx + r : rx + w - 1 - r;
  const cy = top < bottom ? ry + r : ry + h - 1 - r;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Nuqtadan kesmagacha bo'lgan masofa — chiziqni qalinlik bilan chizish uchun.
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// `>_` belgisi: ikkita qiya kesma (chevron) + o'ng pastda gorizontal chiziq.
// Matn (font) ishlatilmaydi — shrift render qilish uchun kutubxona kerak
// bo'lardi, geometriya esa aniq va bog'liqliksiz.
//
// Koordinatalar ICHKI kvadratga nisbatan (0..1) beriladi, butun tuvalga
// emas. `maskable` variantda ichki kvadrat ancha kichik bo'ladi va agar
// belgi tuval o'lchamiga bog'lansa, u kvadratdan tashqariga chiqib ketardi.
function drawGlyph(ix, iw) {
  const p = (f) => ix + f * iw;
  const thickness = 0.083 * iw;
  const chevron = [
    [p(0.30), p(0.31), p(0.50), p(0.50)],
    [p(0.50), p(0.50), p(0.30), p(0.69)],
  ];
  const bar = [p(0.56), p(0.71), p(0.74), p(0.71)];
  return (x, y) => {
    for (const [x1, y1, x2, y2] of chevron) {
      if (distToSegment(x, y, x1, y1, x2, y2) <= thickness / 2) return true;
    }
    return distToSegment(x, y, bar[0], bar[1], bar[2], bar[3]) <= thickness / 2;
  };
}

// `maskable` ikonka uchun belgi kichikroq bo'lishi kerak: Android uni
// doira/kvadratga kesadi, chetdagi ~10% yo'qolishi mumkin.
function renderIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 3);
  const inner = maskable ? 0.30 : 0.08; // ichki kvadrat chetidan bo'shliq
  const ix = Math.round(size * inner);
  const iw = size - ix * 2;
  const outerR = maskable ? 0 : Math.round(size * 0.22);
  const innerR = Math.round(iw * 0.19);
  const isGlyph = drawGlyph(ix, iw);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = BG;
      const inOuter = maskable ? true : insideRoundedRect(x, y, 0, 0, size, size, outerR);
      if (!inOuter) {
        color = BG; // shaffof emas — PNG'ni soddaroq qilish uchun to'q fon
      } else if (insideRoundedRect(x, y, ix, ix, iw, iw, innerR)) {
        color = isGlyph(x, y) ? FG : ACCENT;
      }
      const o = (y * size + x) * 3;
      px[o] = color[0];
      px[o + 1] = color[1];
      px[o + 2] = color[2];
    }
  }
  return px;
}

// --- minimal PNG kodlovchi ---

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf);
  // Node 20 dan eski versiyalar uchun zaxira
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  // 10,11,12 = compression/filter/interlace = 0

  // Har bir qatorga filtr bayti (0 = None) qo'shiladi
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-180.png', size: 180 },                        // apple-touch-icon
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
];

for (const t of targets) {
  const png = encodePng(t.size, renderIcon(t.size, { maskable: t.maskable }));
  fs.writeFileSync(path.join(OUT_DIR, t.name), png);
  console.log(`${t.name.padEnd(24)} ${t.size}x${t.size}  ${(png.length / 1024).toFixed(1)} KB`);
}
