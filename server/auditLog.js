// Doimiy audit-log — "chatni tozalash" yoki `sessions_meta.json`dan MUSTAQIL,
// append-only fayl (JSON-lines: har bir qator alohida JSON obyekt). Maqsad —
// 30+ loyihali muhitda "kim/qachon/nima qildi" degan izni yo'qotmaslik.
//
// Ataylab oddiy fayl (SQLite/DB emas) — qo'shimcha bog'liqlik yo'q, `tail -f`
// yoki oddiy skript bilan ham o'qib bo'ladi. Yozish har doim faylning
// oxiriga qo'shiladi (`flags: 'a'`), hech qachon qayta yozilmaydi/kesilmaydi.

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(LOG_DIR, 'audit.log');

function log(event, details) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
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

// Oxirgi N qatorni o'qish (eng yangisi birinchi) — kichik UI panel yoki
// tezkor tekshiruv uchun. Katta fayllarda ham xotira jihatidan xavfsiz
// bo'lishi uchun butun faylni o'qib, oxiridan kesadi (audit.log odatda
// kichik matn fayli bo'lgani uchun bu yetarli — millionlab qatorga yetsa,
// keyinroq stream-based tail'ga o'tkazish kerak bo'ladi).
function readRecent(limit) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const slice = lines.slice(-Math.max(1, Math.min(1000, Number(limit) || 100)));
    return slice.reverse().map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { log, readRecent };
