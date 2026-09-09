// Doimiy audit-log — "chatni tozalash" yoki `sessions_meta.json`dan MUSTAQIL,
// append-only fayl (JSON-lines: har bir qator alohida JSON obyekt). Maqsad —
// 30+ loyihali muhitda "kim/qachon/nima qildi" degan izni yo'qotmaslik.
//
// Ataylab oddiy fayl (SQLite/DB emas) — qo'shimcha bog'liqlik yo'q, `tail -f`
// yoki oddiy skript bilan ham o'qib bo'ladi.

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(LOG_DIR, 'audit.log');

// Fayl shu hajmdan oshsa `audit.log.1` ga ko'chiriladi. Avval rotatsiya
// umuman yo'q edi va `readRecent()` butun faylni xotiraga o'qirdi — bir yildan
// keyin `/api/audit` so'rovi serverni bir necha soniyaga muzlatardi.
const MAX_BYTES = 5 * 1024 * 1024;
// Nechta eski nusxa saqlanadi (audit.log.1 ... audit.log.N).
const KEEP_ROTATIONS = 3;

function rotateIfNeeded() {
  let size = 0;
  try { size = fs.statSync(LOG_FILE).size; } catch { return; }
  if (size < MAX_BYTES) return;
  try {
    // Eng eskisini o'chirib, qolganini bittaga suramiz.
    try { fs.unlinkSync(`${LOG_FILE}.${KEEP_ROTATIONS}`); } catch { /* yo'q bo'lsa mayli */ }
    for (let i = KEEP_ROTATIONS - 1; i >= 1; i -= 1) {
      try { fs.renameSync(`${LOG_FILE}.${i}`, `${LOG_FILE}.${i + 1}`); } catch { /* yo'q bo'lsa mayli */ }
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch (err) {
    console.error('audit.log rotatsiyasida xato:', err && err.message);
  }
}

function log(event, details) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...details,
    });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    // Audit-log o'zi hech qachon asosiy oqimni to'xtatmasligi kerak —
    // yozib bo'lmasa, konsolga chiqarib qo'ya qolamiz.
    console.error('audit.log yozishda xato:', err && err.message);
  }
}

// Faylning faqat OXIRGI qismini o'qiydi (butun faylni emas) — rotatsiya
// bo'lguncha ham fayl 5MB gacha yetishi mumkin, uni har bir so'rovda to'liq
// xotiraga olish shart emas.
const TAIL_BYTES = 512 * 1024;

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    let text = buf.toString('utf8');
    // Boshidan kesilgan bo'lsa, birinchi (chala) qatorni tashlab yuboramiz.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

// Oxirgi N qatorni o'qish (eng yangisi birinchi).
function readRecent(limit) {
  try {
    const lines = readTail(LOG_FILE).split('\n').filter(Boolean);
    const slice = lines.slice(-Math.max(1, Math.min(1000, Number(limit) || 100)));
    return slice.reverse().map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { log, readRecent };
