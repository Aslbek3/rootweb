// PM2 process ro'yxati/boshqaruvi — yangi npm bog'liqlik (masalan `pm2` moduli)
// qo'shmaslik uchun ataylab mavjud `pm2` CLI'ni `child_process` orqali
// chaqiradi (xuddi Claude Bash tool orqali qilgani kabi, faqat UI'dan
// to'g'ridan-to'g'ri, Claude'ning token/xarajatisiz va tezroq).
//
// Xavfsizlik eslatmasi: bu yerdagi amallar (restart/stop) `server/index.js`
// darajasida allaqachon autentifikatsiya talab qiladi (butun `/api/*`
// himoyalangan). `name` parametri PM2'ning o'z process nomi bo'lishi kerak —
// shell orqali EMAS, `execFile` orqali argument sifatida uzatiladi, shuning
// uchun buyruq in'ektsiyasi (`;`, `&&`, backtick va h.k.) mumkin emas.

const { execFile } = require('child_process');

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('pm2', args, { timeout: opts.timeout || 10000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr && stderr.trim() ? stderr.trim() : err.message));
      resolve(stdout);
    });
  });
}

// PM2 process nomlari harflar/raqam/`-`/`_`/`.` bilan cheklangan bo'ladi —
// bundan tashqari belgi kelsa (shell metasimvoli, bo'shliq va h.k.) rad
// etamiz, chunki bu haqiqiy PM2 nomi emasligini bildiradi.
const VALID_NAME = /^[a-zA-Z0-9_.-]+$/;

function assertValidName(name) {
  if (typeof name !== 'string' || !VALID_NAME.test(name)) {
    throw new Error("Noto'g'ri PM2 process nomi");
  }
}

async function list() {
  const stdout = await run(['jlist']);
  let raw;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error("PM2 javobini o'qib bo'lmadi (jlist)");
  }
  return raw.map((p) => ({
    name: p.name,
    pmId: p.pm_id,
    status: p.pm2_env && p.pm2_env.status,
    restarts: p.pm2_env && p.pm2_env.restart_time,
    uptime: p.pm2_env && p.pm2_env.pm_uptime,
    cpu: p.monit && p.monit.cpu,
    memory: p.monit && p.monit.memory,
    // Ikkala PM2 muhitida ("root" va "claudeweb") bir xil nom
    // takrorlanishi mumkinligi haqidagi eslatma (loyihalar hujjatidagi
    // "nom to'qnashuvi" — masalan poster-01 vs kanal-01) — shuning uchun
    // `namespace`ni ham qaytaramiz, UI kerak bo'lsa ko'rsatishi mumkin.
    namespace: p.pm2_env && p.pm2_env.namespace,
  }));
}

async function restart(name) {
  assertValidName(name);
  await run(['restart', name]);
}

async function stop(name) {
  assertValidName(name);
  await run(['stop', name]);
}

async function logs(name, lines) {
  assertValidName(name);
  const n = Math.max(1, Math.min(500, Number(lines) || 50));
  // `--nostream` bo'lmasa pm2 logs abadiy tugamaydi (tail -f kabi) — bu
  // yerda bitta so'rov uchun bitta natija kerak.
  const stdout = await run(['logs', name, '--lines', String(n), '--nostream', '--raw']);
  return stdout;
}

module.exports = { list, restart, stop, logs };
