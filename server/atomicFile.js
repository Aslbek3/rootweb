// Bitta joyda turadigan atomik JSON yozuvi.
//
// Avval `sessionManager.js` atomik yozardi (tmp fayl + rename), `projects.js`
// esa to'g'ridan-to'g'ri `writeFileSync` qilardi — bir xil papkadagi, bir xil
// muhimlikdagi ikki fayl uchun ikki xil kafolat. `projects.json` yozilayotgan
// paytda protsess o'lsa (pm2 restart, OOM-kill) fayl yarim yozilgan holda
// qolardi, keyingi `load()` esa `catch`ga tushib **bo'sh ro'yxat** qaytarardi —
// ya'ni barcha loyihalar jimgina yo'qolardi.
//
// `rename()` POSIX'da atomik: o'quvchi yo eski to'liq faylni, yo yangi to'liq
// faylni ko'radi, yarmini hech qachon ko'rmaydi.

const fs = require('fs');
const path = require('path');

// `data` obyektini `filePath`ga atomik yozadi. Xato bo'lsa `false` qaytaradi
// (chaqiruvchi o'zi log qiladi) — yozuv xatosi hech qachon asosiy oqimni
// to'xtatmasligi kerak.
function writeJsonAtomic(filePath, data, pretty) {
  const tmp = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, pretty ? 2 : undefined));
    fs.renameSync(tmp, filePath); // atomik almashtirish
    return true;
  } catch (err) {
    console.error(`${path.basename(filePath)} saqlashda xato:`, err && err.message);
    try { fs.unlinkSync(tmp); } catch { /* tmp qolib ketmasin, bo'lmasa ham mayli */ }
    return false;
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = { writeJsonAtomic, readJson };
