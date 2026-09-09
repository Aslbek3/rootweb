// override: true — pm2 avvalgi restartlardan process env'ni keshlab qolishi mumkin
// (masalan eski APP_PASSWORD), .env fayli har doim haqiqiy manba bo'lishi kerak.
require('dotenv').config({ override: true });

// Ushbu server ba'zan mavjud "claude" CLI sessiyasi ichidan (masalan PM2 orqali)
// ishga tushirilishi mumkin — bunda u tasodifan o'sha sessiyaning CLAUDE_* muhit
// o'zgaruvchilarini meros qiladi. Bu o'zgaruvchilar ichki spawn qilinadigan
// "claude" binary'ni chalg'itib, uni ishga tushirilmasligiga sabab bo'lishi mumkin
// ("native binary ... failed to launch"), shuning uchun tozalab tashlaymiz.
for (const key of Object.keys(process.env)) {
  if (key === 'CLAUDECODE' || key === 'AI_AGENT' || key.startsWith('CLAUDE_')) {
    delete process.env[key];
  }
}

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const projects = require('./projects');
const fileApi = require('./fileApi');
const sessionManager = require('./sessionManager');
const authManager = require('./authManager');
const pm2Manager = require('./pm2Manager');
const auditLog = require('./auditLog');
const authLib = require('./auth');

const PORT = process.env.PORT || 3210;
const HOST = process.env.HOST || '0.0.0.0';
const APP_PASSWORDS = (process.env.APP_PASSWORD || '').split(',').map((s) => s.trim()).filter(Boolean);
const PROJECT_DIR = path.resolve(process.env.PROJECT_DIR || path.join(__dirname, '..', 'workspace'));
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
// Set to '1' when running behind a reverse proxy (nginx) that terminates HTTPS,
// so Express reads X-Forwarded-Proto and marks the session cookie Secure.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Ilova ochiladigan manzil, masalan `https://rootweb.example`. Origin
// tekshiruvi uchun ishlatiladi; ko'rsatilmasa so'rovning o'z `Host`
// sarlavhasi bilan solishtiriladi (nginx `proxy_set_header Host $host`
// qilgani uchun bu ham to'g'ri ishlaydi).
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';

if (APP_PASSWORDS.length === 0) {
  console.error('Xatolik: .env faylida APP_PASSWORD ko\'rsatilmagan.');
  console.error('.env.example faylidan nusxa oling: cp .env.example .env');
  process.exit(1);
}

// Always registers the configured PROJECT_DIR as a known project (without
// resetting its position if the user already switched to something else).
projects.seed(PROJECT_DIR, 'workspace');

const { issueToken, verifyToken } = authLib.createAuth(SESSION_SECRET);

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// ---------------- xavfsizlik sarlavhalari ----------------
// Avval hech qanday sarlavha yo'q edi. Eng muhimi `frame-ancestors`/
// `X-Frame-Options`: usiz hujumchi sayt rootweb'ni ko'rinmas iframe'da ochib,
// foydalanuvchini "Ruxsat berish" tugmasini bosishga aldashi mumkin edi
// (clickjacking) — ya'ni Bash siyosatini foydalanuvchining o'z qo'li bilan
// chetlab o'tish.
//
// `script-src 'self'` — sahifalarda inline `<script>` qolmagani uchun
// (hammasi alohida .js fayllarga chiqarildi) va highlight.js endi CDN'dan
// emas, `public/vendor/`dan yuklangani uchun qat'iy siyosat mumkin.
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    // `style-src`da 'unsafe-inline' qoladi: `auth.html`dagi <style> bloki va
    // JS'dan qo'yiladigan inline uslublar (textarea balandligi, progress-bar
    // kengligi) shusiz ishlamaydi. Bu XSS uchun sezilarli vektor emas.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '));
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Unauthenticated health check so another claude-web instance's "Qurilmalar"
// (devices) list can tell whether this machine is reachable without needing to
// be logged in first.
//
// Hostname endi faqat autentifikatsiyadan o'tganlarga ko'rsatiladi — avval u
// `Access-Control-Allow-Origin: *` bilan birga har qanday saytga oshkor
// bo'lardi.
app.get('/api/ping', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ ok: true, ...(isAuthed(req) ? { host: os.hostname() } : {}) });
});

// ---------------- auth (signed cookie, single shared password) ----------------

function isAuthed(req) {
  return verifyToken(authLib.parseCookies(req).session);
}

function sessionCookie(req, value, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  return `session=${encodeURIComponent(value)}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
}

// So'rov shu saytning o'zidan kelganmi?
//
// Brauzer cross-site so'rovda `Origin`ni HAR DOIM qo'shadi, shuning uchun
// mos kelmagan Origin — ishonchli "boshqa saytdan" belgisi. `Origin` umuman
// bo'lmasa ruxsat beramiz: curl/skript kabi brauzer bo'lmagan mijozlar uni
// yubormaydi, va ular uchun cookie'ni avtomatik biriktiruvchi brauzer
// mexanizmi ham yo'q (ya'ni CSRF xavfi yo'q).
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const expected = PUBLIC_ORIGIN ? (() => { try { return new URL(PUBLIC_ORIGIN).host; } catch { return ''; } })() : req.headers.host;
  return !!expected && originHost === expected;
}

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';

  // ⚠️ Ilova darajasidagi cheklov — fail2ban'ga bog'liq, `server/auth.js`dagi
  // izohga qara. Chegaraga yetganda 401 EMAS, 429 qaytariladi, shunda parolni
  // adashib teruvchi haqiqiy foydalanuvchi fail2ban tomonidan 24 soatga
  // IP-ban qilinmaydi.
  const gate = authLib.checkLoginAllowed(ip);
  if (!gate.allowed) {
    auditLog.log('login_throttled', { ip });
    res.setHeader('Retry-After', String(gate.retryAfterSec));
    return res.status(429).json({ error: `Juda ko'p urinish. ${gate.retryAfterSec} soniyadan keyin qayta urinib ko'ring.` });
  }

  const password = req.body && req.body.password;
  if (typeof password !== 'string' || !APP_PASSWORDS.some((p) => authLib.timingSafeEqualStr(password, p))) {
    authLib.recordLoginFailure(ip);
    auditLog.log('login_failed', { ip });
    return res.status(401).json({ error: "Parol noto'g'ri" });
  }

  authLib.clearLoginFailures(ip);
  res.setHeader('Set-Cookie', sessionCookie(req, issueToken(), Math.floor(authLib.SESSION_MAX_AGE_MS / 1000)));
  auditLog.log('login_success', { ip });
  res.json({ ok: true });
});

// Chiqish endi HAQIQATAN sessiyani bekor qiladi: `revokeAll()` diskdagi
// `sessionVersion`ni oshiradi, ya'ni o'g'irlangan/nusxa olingan cookie ham
// shu zahoti yaroqsiz bo'ladi. Avval faqat brauzerdagi cookie o'chirilardi va
// tokenning o'zi abadiy amal qilaverardi.
app.post('/api/logout', (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'origin rad etildi' });
  authLib.revokeAll();
  auditLog.log('logout', { ip: req.ip });
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  res.json({ ok: true });
});

// `/api/login` bu yerda YO'Q — u yuqorida, shu middleware'dan oldin
// ro'yxatdan o'tgan, ya'ni bu ro'yxatga qo'shilsa o'lik yozuv bo'lib qolardi.
const OPEN_PATHS = new Set(['/login.html', '/login.js', '/style.css', '/manifest.json', '/icon.svg']);
// Ikonkalar ham ochiq bo'lishi kerak: `manifest.json` login sahifasida ham
// ulanadi va brauzer ikonkalarni autentifikatsiyasiz so'raydi — himoyalangan
// bo'lsa ular `login.html`ga yo'naltirilib, ikonka buzilgan ko'rinardi.
const OPEN_PREFIXES = ['/icons/'];

app.use((req, res, next) => {
  if (OPEN_PATHS.has(req.path) || OPEN_PREFIXES.some((p) => req.path.startsWith(p))) return next();
  if (!isAuthed(req)) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    return res.redirect('/login.html');
  }
  // Holatni o'zgartiruvchi so'rovlar faqat shu saytning o'zidan kelishi kerak
  // (CSRF himoyasi). `SameSite=Lax` cookie allaqachon ko'p holatni yopadi,
  // lekin u brauzerga bog'liq kafolat — bu esa serverdagi tekshiruv.
  if (req.method !== 'GET' && req.method !== 'HEAD' && !originAllowed(req)) {
    auditLog.log('origin_rejected', { ip: req.ip, path: req.path, origin: req.headers.origin });
    return res.status(403).json({ error: 'origin rad etildi' });
  }
  return next();
});

// ---------------- device info ----------------

// Lets the "Qurilmalar" tab show this machine's own local-network address(es)
// so the user doesn't have to run ipconfig/ifconfig to find what to type
// into another device's "add device" form.
app.get('/api/device-info', (req, res) => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ name, address: net.address });
      }
    }
  }
  res.json({ host: os.hostname(), port: Number(PORT), ips });
});

// ---------------- projects & file browser ----------------

app.get('/api/projects', (req, res) => {
  const list = projects.list().map((p) => ({ ...p, ...sessionManager.getStatus(p.id) }));
  res.json({ projects: list });
});

app.post('/api/projects', (req, res) => {
  const { path: rawPath, label, description, pm2Name } = req.body || {};
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return res.status(400).json({ error: "Papka yo'li kiritilmagan" });
  }
  try {
    const entry = projects.upsert(
      rawPath.trim(),
      typeof label === 'string' ? label.trim() : undefined,
      typeof description === 'string' ? description : undefined,
      typeof pm2Name === 'string' ? pm2Name.trim() : undefined,
    );
    res.json({ project: entry });
  } catch (err) {
    res.status(400).json({ error: err.code === 'ENOENT' ? 'Bunday papka topilmadi' : err.message });
  }
});

app.post('/api/projects/create', (req, res) => {
  const { parent, name, label, description, pm2Name } = req.body || {};
  if (typeof parent !== 'string' || !parent.trim()) {
    return res.status(400).json({ error: "Ota papka yo'li kiritilmagan" });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: "Yangi papka nomi kiritilmagan" });
  }
  try {
    const entry = projects.createAndAdd(
      parent.trim(),
      name.trim(),
      typeof label === 'string' ? label.trim() : undefined,
      typeof description === 'string' ? description : undefined,
      typeof pm2Name === 'string' ? pm2Name.trim() : undefined,
    );
    res.json({ project: entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Loyihaning `description`/`pm2Name`ini keyinroq tahrirlash uchun (yaratishda
// kiritilmagan bo'lsa ham qo'shib qo'yish imkoni).
app.patch('/api/projects/:id', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Loyiha topilmadi' });
  const { label, description, pm2Name } = req.body || {};
  try {
    const entry = projects.upsert(
      project.path,
      typeof label === 'string' ? label.trim() : undefined,
      typeof description === 'string' ? description : undefined,
      typeof pm2Name === 'string' ? pm2Name.trim() : undefined,
    );
    res.json({ project: entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  if (projects.list().length <= 1) {
    return res.status(400).json({ error: "Oxirgi loyihani o'chirib bo'lmaydi" });
  }
  const project = projects.getById(req.params.id);
  // Mavjud bo'lmagan id uchun avval ham `200 OK` qaytarilardi va audit-logga
  // `label: undefined` yozilardi — endi ochiq-oydin 404.
  if (!project) return res.status(404).json({ error: 'Loyiha topilmadi' });
  // Loyiha ro'yxatdan o'chishidan OLDIN uning faol Claude sessiyasini (agar
  // bo'lsa) to'liq yopamiz — aks holda ro'yxatdan yo'qolgan, lekin hali
  // ishlab turgan `claude` subprocess RAM'da abadiy "zombi" bo'lib qoladi
  // (xuddi "chatni tozalash" tugmasidagi avvalgi bag' kabi — bu yerda ham
  // sessionManager.resetSession() chaqirilmasa xuddi shu muammo takrorlanadi).
  //
  // MUHIM: bu faqat rootweb'ning "loyihalar" ro'yxatidan (papka-yorlig'i +
  // chat) o'chirish — PM2'dagi tegishli botga/xizmatga HECH QANDAY ta'sir
  // qilmaydi, fayllar ham diskda qoladi.
  sessionManager.resetSession(req.params.id);
  projects.remove(req.params.id);
  auditLog.log('project_deleted', { projectId: req.params.id, label: project.label, path: project.path });
  res.json({ ok: true });
});

// ---------------- PM2 (botlar) ----------------

app.get('/api/pm2/list', async (req, res) => {
  try {
    res.json({ processes: await pm2Manager.list() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pm2/:name/restart', async (req, res) => {
  try {
    await pm2Manager.restart(req.params.name);
    auditLog.log('pm2_restart', { name: req.params.name });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/pm2/:name/stop', async (req, res) => {
  try {
    await pm2Manager.stop(req.params.name);
    auditLog.log('pm2_stop', { name: req.params.name });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Jonli log oqimi (Server-Sent Events). Bitta surat olish uchun pastdagi
// `/logs` ishlatiladi; bu esa `tail -f` kabi ochiq turadi.
app.get('/api/pm2/:name/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // ⚠️ Nginx standart holatda proxy javobini buferlaydi — usiz loglar
  // real vaqtda emas, bo'lak-bo'lak kechikib kelardi.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sse = (event, data) => {
    if (res.writableEnded) return;
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let stop = null;
  try {
    stop = pm2Manager.streamLogs(
      req.params.name,
      (chunk) => sse(null, chunk),
      (reason) => { sse('end', reason || ''); res.end(); },
    );
  } catch (err) {
    sse('error', err.message);
    return res.end();
  }

  // Proksi va mobil tarmoqlar jim turgan ulanishni uzib qo'yadi — har 20
  // soniyada izoh (comment) qatori yuboramiz.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 20000);

  // Klient uzilganda `pm2 logs` jarayonini O'LDIRISH shart — aks holda u
  // abadiy qolib ketadi.
  const cleanup = () => {
    clearInterval(heartbeat);
    if (stop) stop();
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);

  auditLog.log('pm2_logs_stream', { ip: req.ip, name: req.params.name });
});

app.get('/api/pm2/:name/logs', async (req, res) => {
  try {
    res.json({ logs: await pm2Manager.logs(req.params.name, req.query.lines) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------- audit log (faqat o'qish) ----------------

app.get('/api/audit', (req, res) => {
  res.json({ events: auditLog.readRecent(req.query.limit) });
});

// Fayllar API'si loyiha (`projectId`) YOKI to'g'ridan-to'g'ri absolyut yo'l
// (`root`) orqali ishlaydi — ikkinchisi "/root'ga o'tish" kabi tezkor
// yo'llar uchun kerak. rootweb izolyatsiyasiz (root sifatida) ishlagani
// uchun bu yangi xavf sinfi emas — Bash tooli allaqachon butun tizimga
// cheklanmagan yetadi (`CLAUDE.md`ga qarang).
//
// ⚠️ LEKIN kuzatuvchanlik jihatidan farq bor edi: Bash orqali qilingan ish
// audit-logga tushadi, fayl API orqali qilingani esa tushmasdi. Ya'ni
// `DELETE /api/file?root=/&file=etc` — na tasdiq, na iz. Endi barcha
// o'zgartiruvchi fayl amallari `auditLog`ga yoziladi (pastga qara).
function resolveBrowseRoot(req) {
  if (req.query.projectId) {
    const project = projects.getById(req.query.projectId);
    return project ? project.path : null;
  }
  if (typeof req.query.root === 'string' && path.isAbsolute(req.query.root)) {
    return path.resolve(req.query.root);
  }
  return null;
}

app.get('/api/files', (req, res) => {
  const root = resolveBrowseRoot(req);
  if (!root) return res.status(404).json({ error: 'Loyiha/papka topilmadi' });
  try {
    res.json({ entries: fileApi.listDir(root, req.query.dir || '.') });
  } catch (err) {
    res.status(400).json({ error: err.code === 'ENOENT' ? 'Papka topilmadi' : err.message });
  }
});

app.get('/api/file', (req, res) => {
  const root = resolveBrowseRoot(req);
  if (!root) return res.status(404).json({ error: 'Loyiha/papka topilmadi' });
  try {
    res.json(fileApi.readFileSafe(root, req.query.file || ''));
  } catch (err) {
    res.status(400).json({ error: err.code === 'ENOENT' ? 'Fayl topilmadi' : err.message });
  }
});

app.post('/api/files/mkdir', (req, res) => {
  const root = resolveBrowseRoot(req);
  if (!root) return res.status(404).json({ error: 'Loyiha/papka topilmadi' });
  const { name } = req.body || {};
  try {
    const out = fileApi.mkdir(root, req.query.dir || '.', name);
    auditLog.log('file_mkdir', { ip: req.ip, root, dir: req.query.dir || '.', name: out.name });
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/file', (req, res) => {
  const root = resolveBrowseRoot(req);
  if (!root) return res.status(404).json({ error: 'Loyiha/papka topilmadi' });
  try {
    fileApi.deleteEntry(root, req.query.file || '');
    auditLog.log('file_delete', { ip: req.ip, root, file: req.query.file || '' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.code === 'ENOENT' ? 'Topilmadi' : err.message });
  }
});

app.post('/api/file/rename', (req, res) => {
  const root = resolveBrowseRoot(req);
  if (!root) return res.status(404).json({ error: 'Loyiha/papka topilmadi' });
  const { newName } = req.body || {};
  try {
    const out = fileApi.renameEntry(root, req.query.file || '', newName);
    auditLog.log('file_rename', { ip: req.ip, root, file: req.query.file || '', newName: out.name });
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(400).json({ error: err.code === 'ENOENT' ? 'Topilmadi' : err.message });
  }
});

// ---------------- fayl yuklash / yuklab olish ----------------

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const root = resolveBrowseRoot(req);
        if (!root) return cb(new Error('Loyiha/papka topilmadi'));
        const dir = fileApi.resolveWithin(root, req.query.dir || '.');
        if (!fs.statSync(dir).isDirectory()) return cb(new Error("Bu yo'l papka emas"));
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      // Faqat fayl nomining o'zi (papka segmentlarisiz) — path traversal'dan himoya.
      const base = path.basename(file.originalname).replace(/[\x00-\x1f]/g, '').trim()
        || `fayl-${Date.now()}`;
      // Mavjud faylni JIMGINA qayta yozib yubormaymiz. Avval shunday edi va
      // `.env` yoki `server/index.js` ustiga tasodifan yozib yuborish real
      // xavf edi — `mkdir`/`rename` esa allaqachon "allaqachon mavjud" deb
      // xato qaytarardi, ya'ni o'zaro nomuvofiqlik ham bor edi.
      // Endi nomga `-1`, `-2` ... qo'shiladi.
      try {
        const dir = fileApi.resolveWithin(resolveBrowseRoot(req), req.query.dir || '.');
        cb(null, uniqueName(dir, base));
      } catch (err) {
        cb(err);
      }
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// `dir` ichida band bo'lmagan nom tanlaydi: "hisobot.pdf" band bo'lsa
// "hisobot-1.pdf", u ham band bo'lsa "hisobot-2.pdf" ...
function uniqueName(dir, base) {
  if (!fs.existsSync(path.join(dir, base))) return base;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

app.post('/api/files/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Fayl yuborilmadi' });
    auditLog.log('file_upload', {
      ip: req.ip, dir: req.query.dir || '.', name: req.file.filename, size: req.file.size,
    });
    res.json({ ok: true, name: req.file.filename, size: req.file.size });
  });
});

app.get('/api/file/download', (req, res) => {
  const root = resolveBrowseRoot(req);
  if (!root) return res.status(404).json({ error: 'Loyiha/papka topilmadi' });
  try {
    const filePath = fileApi.resolveWithin(root, req.query.file || '');
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error("Bu yo'l fayl emas");
    const name = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(400).json({ error: err.code === 'ENOENT' ? 'Fayl topilmadi' : err.message });
  }
});

app.put('/api/file', (req, res) => {
  const root = resolveBrowseRoot(req);
  if (!root) return res.status(404).json({ error: 'Loyiha/papka topilmadi' });
  const { content } = req.body || {};
  if (typeof content !== 'string') {
    return res.status(400).json({ error: "Fayl matni kiritilmagan" });
  }
  try {
    const out = fileApi.writeFileSafe(root, req.query.file || '', content);
    auditLog.log('file_write', { ip: req.ip, root, file: req.query.file || '', size: out.size });
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------- claude auth (hisob ulash, saytdan) ----------------

app.post('/api/auth/start', (req, res) => {
  res.json(authManager.start());
});

app.get('/api/auth/status', (req, res) => {
  res.json(authManager.getState());
});

app.post('/api/auth/submit', (req, res) => {
  const { code } = req.body || {};
  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: "Kod kiritilmagan" });
  }
  try {
    authManager.submitCode(code.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
// maxPayload — bitta WS xabari uchun chegara. Avval `ws`ning standart 100MB'i
// amal qilardi; rasm biriktirish uchun ~40MB (6 × 7MB) dan ortig'i hech qachon
// kerak emas.
const wss = new WebSocketServer({ noServer: true, maxPayload: 48 * 1024 * 1024 });

// ⚠️ WebSocket handshake'ida `Origin` tekshiruvi — eng jiddiy tuzatilgan
// xato shu.
//
// WebSocket Same-Origin Policy'ga BO'YSUNMAYDI: siz rootweb'ga login qilgan
// holda istalgan boshqa saytga kirsangiz, o'sha sayt shunchaki
// `new WebSocket('wss://<domen>/ws')` ocha olardi — cookie avtomatik
// biriktirilardi — va keyin `{type:'chat', text:'...'}` yuborib butun VPS'da
// buyruq bajartira olardi (standart rejim "avto" bo'lgani uchun ko'pi
// so'rovsiz ketardi), javoblarni ham o'qiy olardi. Bu Cross-Site WebSocket
// Hijacking (CSWSH) deb ataladi.
//
// Brauzer WS handshake'ida `Origin`ni HAR DOIM yuboradi, shuning uchun bu
// yerda uning MAVJUDLIGI ham talab qilinadi (HTTP so'rovlaridan farqli):
// brauzer bo'lmagan mijoz (masalan test skripti) `Origin` sarlavhasini
// o'zi qo'shishi kerak.
server.on('upgrade', (req, socket, head) => {
  const ok = req.url === '/ws' && isAuthed(req) && req.headers.origin && originAllowed(req);
  if (!ok) {
    if (req.headers.origin && !originAllowed(req)) {
      auditLog.log('ws_origin_rejected', { origin: req.headers.origin, ip: req.socket.remoteAddress });
    }
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  handleConnection(ws).catch((err) => {
    console.error('Ulanishda xatolik:', err);
    try { ws.close(); } catch { /* noop */ }
  });
});

async function handleConnection(ws) {
  let currentSession = null;

  function safeSend(obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  // Attaches this connection to a project's persistent session (creating it
  // the first time it's used since the server started) and replays its
  // history so the client can rebuild the conversation it left off at.
  function attachToProject(project) {
    if (currentSession) currentSession.detach(ws);
    currentSession = sessionManager.getOrCreateSession(project.id, project.path, project.description);
    currentSession.attach(ws);
    const snap = currentSession.snapshot();
    safeSend({
      type: 'session_state',
      cwd: snap.cwd,
      sessionId: snap.sessionId,
      busy: snap.busy,
      permissionMode: snap.permissionMode,
      usage: snap.usage,
      history: snap.history,
      pm2Name: project.pm2Name || null,
    });
  }

  // Defensive fallback: the DELETE route refuses to remove the last project,
  // but if the data file was ever hand-edited into an empty list, re-seed
  // PROJECT_DIR rather than crash the connection on `undefined.path`.
  if (!projects.list().length) projects.seed(PROJECT_DIR, 'workspace');
  attachToProject(projects.list()[0]);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === 'chat' && typeof msg.text === 'string') {
      // `.slice(0, 6)` — rasm SONI ham cheklanadi. Avval faqat har bir
      // rasmning hajmi tekshirilardi, soni emas: mijoz 1000 ta 7MB'lik rasm
      // yuborsa hammasi xotiraga olinardi (`pushUserMessage` faqat keyinroq
      // 6 tagacha kesardi, ya'ni juda kech).
      const images = Array.isArray(msg.images)
        ? msg.images.filter((img) => img && typeof img.data === 'string' && typeof img.mediaType === 'string'
            && img.mediaType.startsWith('image/') && img.data.length < 7 * 1024 * 1024) // ~5MB decoded
          .slice(0, 6)
        : [];
      if (msg.text.trim() || images.length) {
        currentSession.pushUserMessage(msg.text, images);
      }
    } else if (msg.type === 'permission' && typeof msg.id === 'string') {
      currentSession.resolvePermission(msg.id, !!msg.approve);
    } else if (msg.type === 'question_answer' && typeof msg.id === 'string') {
      const answers = (msg.answers && typeof msg.answers === 'object') ? msg.answers : {};
      const response = typeof msg.response === 'string' ? msg.response : undefined;
      currentSession.answerQuestion(msg.id, answers, response);
    } else if (msg.type === 'stop') {
      currentSession.interrupt();
    } else if (msg.type === 'switch_project' && typeof msg.id === 'string') {
      const project = projects.getById(msg.id);
      if (project) {
        projects.touch(project.id);
        attachToProject(project);
      }
    } else if (msg.type === 'clear_chat') {
      const project = projects.getById(currentSession.projectId);
      if (project) {
        // Avval o'zimizni sessiyadan uzamiz, keyin reset qilamiz: shunda
        // `resetSession` ichidagi `invalidate()` xabari BOSHQA ulangan
        // klientlarga (masalan kompyuterdagi ochiq tab) boradi, bizga emas —
        // biz pastda darhol yangi `session_state` olamiz.
        currentSession.detach(ws);
        sessionManager.resetSession(project.id);
        auditLog.log('chat_cleared', { projectId: project.id, label: project.label });
        attachToProject(project);
      }
    } else if (msg.type === 'set_permission_mode' && typeof msg.mode === 'string') {
      const allowed = new Set(['default', 'plan', 'acceptEdits']);
      if (allowed.has(msg.mode)) {
        currentSession.setPermissionMode(msg.mode).catch(() => {});
      }
    } else if (msg.type === 'get_rate_limits') {
      currentSession.getRateLimits().then((data) => safeSend({ type: 'rate_limit_data', data }));
    }
  });

  ws.on('close', () => {
    if (currentSession) currentSession.detach(ws);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Claude Code Web http://${HOST}:${PORT} manzilida ishga tushdi`);
  console.log(`Loyiha papkasi (Claude ishlaydigan joy): ${PROJECT_DIR}`);
});
