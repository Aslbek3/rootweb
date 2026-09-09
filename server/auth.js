// Sessiya (imzolangan cookie) + login urinishlarini cheklash.
//
// Avval bu mantiq `index.js` ichida edi va tokeni **o'zgarmas konstanta** edi:
// `sign('ok')` har doim bir xil satr chiqarardi. Oqibatlari:
//   - cookie'ning muddati serverda umuman tekshirilmasdi (`Max-Age` faqat
//     brauzer tomonidagi maslahat — qo'lda qaytarib qo'yilgan eski cookie
//     ishlayverardi);
//   - `/api/logout` faqat brauzerdagi nusxani o'chirardi, ya'ni **o'g'irlangan
//     cookie'ni bekor qilishning hech qanday yo'li yo'q edi** (root shell
//     beruvchi ilova uchun bu juda jiddiy).
//
// Endi imzolanadigan qiymat ichida `iat` (yaratilgan vaqt), `n` (tasodifiy
// nonce) va `v` (sessiya versiyasi) bor. `verify()` uchalasini ham tekshiradi,
// `revokeAll()` esa versiyani oshirib barcha mavjud cookie'larni darhol
// yaroqsiz qiladi.

const crypto = require('crypto');
const path = require('path');
const { writeJsonAtomic, readJson } = require('./atomicFile');

const STATE_FILE = path.join(__dirname, 'data', 'auth_state.json');

// Cookie qancha vaqt amal qiladi. Diskdagi `sessionVersion` bilan birga
// ishlaydi: muddat tugashini kutmasdan ham barcha sessiyani uzish mumkin.
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS) || 24 * 60 * 60 * 1000;

// ⚠️ fail2ban bilan bog'liq — `CLAUDE.md`dagi `rootweb-login` jail'i
// `/api/login`ga kelgan **401** javoblarni sanaydi (5 urinish → 24 soat ban).
// Shuning uchun ilovaning o'z chegarasi undan PAST bo'lishi shart: 4-chi
// noto'g'ri urinishdan keyin biz 401 emas, **429** qaytaramiz. 429 fail2ban
// regexiga tushmaydi, ya'ni parolni adashib teruvchi haqiqiy foydalanuvchi
// 24 soatga IP-ban bo'lib qolmaydi — shunchaki qisqa kutish oynasiga tushadi.
// Bu ikkisi bir-biriga bog'liq: bu yerdagi `MAX_FAILED` o'zgarsa,
// `jail.local`dagi `maxretry` ham qayta ko'rilishi kerak (fail2ban chegarasi
// doim ilova chegarasidan yuqori turishi shart).
const MAX_FAILED = Number(process.env.LOGIN_MAX_FAILED) || 4;
const WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS) || 15 * 60 * 1000;

function loadState() {
  const state = readJson(STATE_FILE, null);
  if (state && typeof state.sessionVersion === 'number') return state;
  return { sessionVersion: 1 };
}

let state = loadState();

function saveState() {
  writeJsonAtomic(STATE_FILE, state);
}

function createAuth(secret) {
  function hmac(value) {
    return crypto.createHmac('sha256', secret).update(value).digest('hex');
  }

  function sign(value) {
    return `${Buffer.from(value, 'utf8').toString('base64url')}.${hmac(value)}`;
  }

  // Imzo to'g'ri bo'lsa payload obyektini, aks holda `null` qaytaradi.
  function unsign(signed) {
    if (typeof signed !== 'string') return null;
    const idx = signed.lastIndexOf('.');
    if (idx < 0) return null;
    let value;
    try {
      value = Buffer.from(signed.slice(0, idx), 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const sig = signed.slice(idx + 1);
    const expected = hmac(value);
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function issueToken() {
    return sign(JSON.stringify({
      v: state.sessionVersion,
      iat: Date.now(),
      n: crypto.randomBytes(12).toString('base64url'),
    }));
  }

  // Imzo + muddat + sessiya versiyasi — uchalasi ham to'g'ri bo'lsagina `true`.
  function verifyToken(signed) {
    const payload = unsign(signed);
    if (!payload || typeof payload.iat !== 'number' || payload.v !== state.sessionVersion) return false;
    if (Date.now() - payload.iat > SESSION_MAX_AGE_MS) return false;
    return true;
  }

  return { issueToken, verifyToken };
}

// Barcha mavjud sessiyalarni darhol bekor qiladi (logout, yoki shubha tug'ilsa
// qo'lda `auth_state.json` ni o'chirish orqali ham).
function revokeAll() {
  state.sessionVersion += 1;
  saveState();
  return state.sessionVersion;
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // Uzunlik mos kelmasa ham har doim bitta solishtirish bajariladi, aks holda
  // javob vaqti parol uzunligini oshkor qilardi.
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    try {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      /* buzuq percent-encoding — shu cookie'ni e'tiborsiz qoldiramiz */
    }
  });
  return out;
}

// ---------------- login urinishlarini cheklash ----------------

const failedByIp = new Map(); // ip -> { count, firstAt }

function pruneFailures(now) {
  for (const [ip, rec] of failedByIp) {
    if (now - rec.firstAt > WINDOW_MS) failedByIp.delete(ip);
  }
}

// Bu IP hozir urinib ko'ra oladimi? Yo'q bo'lsa qancha kutishi kerakligini
// (soniyada) qaytaradi.
function checkLoginAllowed(ip) {
  const now = Date.now();
  pruneFailures(now);
  const rec = failedByIp.get(ip);
  if (!rec || rec.count < MAX_FAILED) return { allowed: true };
  return { allowed: false, retryAfterSec: Math.ceil((rec.firstAt + WINDOW_MS - now) / 1000) };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const rec = failedByIp.get(ip);
  if (!rec || now - rec.firstAt > WINDOW_MS) failedByIp.set(ip, { count: 1, firstAt: now });
  else rec.count += 1;
}

function clearLoginFailures(ip) {
  failedByIp.delete(ip);
}

module.exports = {
  createAuth,
  revokeAll,
  timingSafeEqualStr,
  parseCookies,
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  SESSION_MAX_AGE_MS,
  LOGIN_LIMITS: { MAX_FAILED, WINDOW_MS },
};
