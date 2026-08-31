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

const PORT = process.env.PORT || 3210;
const HOST = process.env.HOST || '0.0.0.0';
const APP_PASSWORDS = (process.env.APP_PASSWORD || '').split(',').map((s) => s.trim()).filter(Boolean);
const PROJECT_DIR = path.resolve(process.env.PROJECT_DIR || path.join(__dirname, '..', 'workspace'));
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
// Set to '1' when running behind a reverse proxy (nginx) that terminates HTTPS,
// so Express reads X-Forwarded-Proto and marks the session cookie Secure.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

if (APP_PASSWORDS.length === 0) {
  console.error('Xatolik: .env faylida APP_PASSWORD ko\'rsatilmagan.');
  console.error('.env.example faylidan nusxa oling: cp .env.example .env');
  process.exit(1);
}

// Always registers the configured PROJECT_DIR as a known project (without
// resetting its position if the user already switched to something else).
projects.seed(PROJECT_DIR, 'workspace');

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// Unauthenticated, CORS-open health check so another claude-web instance's
// "Qurilmalar" (devices) list can tell whether this machine is reachable
// without needing to be logged in first. Only leaks the hostname.
app.get('/api/ping', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ ok: true, host: os.hostname() });
});

// ---------------- auth (signed cookie, single shared password) ----------------

function sign(value) {
  const h = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}

function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  return crypto.timingSafeEqual(sigBuf, expBuf) ? value : null;
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  return verify(parseCookies(req).session) === 'ok';
}

app.post('/api/login', (req, res) => {
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || !APP_PASSWORDS.some((p) => timingSafeEqualStr(password, p))) {
    return res.status(401).json({ error: "Parol noto'g'ri" });
  }
  const token = sign('ok');
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax${secure}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
  res.json({ ok: true });
});

const OPEN_PATHS = new Set(['/login.html', '/api/login', '/style.css', '/manifest.json', '/icon.svg']);

app.use((req, res, next) => {
  if (OPEN_PATHS.has(req.path) || isAuthed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login.html');
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
  const { path: rawPath, label } = req.body || {};
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return res.status(400).json({ error: "Papka yo'li kiritilmagan" });
  }
  try {
    const entry = projects.upsert(rawPath.trim(), typeof label === 'string' ? label.trim() : undefined);
    res.json({ project: entry });
  } catch (err) {
    res.status(400).json({ error: err.code === 'ENOENT' ? 'Bunday papka topilmadi' : err.message });
  }
});

app.post('/api/projects/create', (req, res) => {
  const { parent, name, label } = req.body || {};
  if (typeof parent !== 'string' || !parent.trim()) {
    return res.status(400).json({ error: "Ota papka yo'li kiritilmagan" });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: "Yangi papka nomi kiritilmagan" });
  }
  try {
    const entry = projects.createAndAdd(parent.trim(), name.trim(), typeof label === 'string' ? label.trim() : undefined);
    res.json({ project: entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  if (projects.list().length <= 1) {
    return res.status(400).json({ error: "Oxirgi loyihani o'chirib bo'lmaydi" });
  }
  // Loyiha ro'yxatdan o'chishidan OLDIN uning faol Claude sessiyasini (agar
  // bo'lsa) to'liq yopamiz — aks holda ro'yxatdan yo'qolgan, lekin hali
  // ishlab turgan `claude` subprocess RAM'da abadiy "zombi" bo'lib qoladi
  // (xuddi "chatni tozalash" tugmasidagi avvalgi bag' kabi — bu yerda ham
  // sessionManager.resetSession() chaqirilmasa xuddi shu muammo takrorlanadi).
  sessionManager.resetSession(req.params.id);
  projects.remove(req.params.id);
  res.json({ ok: true });
});

// Fayllar API'si loyiha (`projectId`) YOKI to'g'ridan-to'g'ri absolyut yo'l
// (`root`) orqali ishlaydi — ikkinchisi "Papkalar" yorliqlari (istalgan VPS
// yo'liga tezkor kirish) uchun kerak. rootweb izolyatsiyasiz (root sifatida)
// ishlagani uchun bu yangi xavf sinfi emas — Bash tooli allaqachon butun
// tizimga cheklanmagan yetadi (`CLAUDE.md`ga qarang).
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
    res.json({ ok: true, ...fileApi.mkdir(root, req.query.dir || '.', name) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/file', (req, res) => {
  const root = resolveBrowseRoot(req);
  if (!root) return res.status(404).json({ error: 'Loyiha/papka topilmadi' });
  try {
    fileApi.deleteEntry(root, req.query.file || '');
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
    res.json({ ok: true, ...fileApi.renameEntry(root, req.query.file || '', newName) });
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
      const base = path.basename(file.originalname).replace(/[\x00-\x1f]/g, '').trim();
      cb(null, base || `fayl-${Date.now()}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

app.post('/api/files/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Fayl yuborilmadi' });
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
    res.json({ ok: true, ...fileApi.writeFileSafe(root, req.query.file || '', content) });
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
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws' || !isAuthed(req)) {
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
    currentSession = sessionManager.getOrCreateSession(project.id, project.path);
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
      const images = Array.isArray(msg.images)
        ? msg.images.filter((img) => img && typeof img.data === 'string' && typeof img.mediaType === 'string'
            && img.mediaType.startsWith('image/') && img.data.length < 7 * 1024 * 1024) // ~5MB decoded
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
        sessionManager.resetSession(project.id);
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
