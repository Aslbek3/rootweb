// VPS holati — Claude'siz, to'g'ridan-to'g'ri o'qiladigan ko'rsatkichlar.
//
// Nega bu Claude orqali emas: "hujum bo'ldimi", "yuklama qanday", "disk
// to'lmadimi" — bular DETERMINISTIK savollar. Claude'dan so'ralganda u
// 5-10 ta buyruq ishga tushiradi, natijalar kontekstga tushadi va sessiya
// oxirigacha har navbatda qayta yuboriladi. Bu yerda esa bir so'rov, nol
// token, va javob har doim bir xil shaklda.
//
// Barcha buyruqlar shellsiz (`execFile`) va faqat O'QISH.

const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const EXEC_TIMEOUT = 6000;

// Buyruq topilmasa yoki xato bersa — `null`, ilova yiqilmaydi.
// Har bir ko'rsatkich mustaqil: biri ishlamasa qolgani ko'rinadi.
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: EXEC_TIMEOUT, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

function bytesToGb(b) {
  return Math.round((b / 1024 / 1024 / 1024) * 10) / 10;
}

// --- xotira: /proc/meminfo (Linux). MemAvailable eng to'g'ri ko'rsatkich,
// "free" emas — kesh hisobga olinadi.
function readMemory() {
  try {
    const txt = fs.readFileSync('/proc/meminfo', 'utf8');
    const num = (key) => {
      const m = txt.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
      return m ? Number(m[1]) * 1024 : null;
    };
    const total = num('MemTotal');
    const available = num('MemAvailable');
    if (!total) return null;
    const used = available != null ? total - available : null;
    return {
      totalGb: bytesToGb(total),
      usedGb: used != null ? bytesToGb(used) : null,
      usedPct: used != null ? Math.round((used / total) * 100) : null,
    };
  } catch {
    // Linux bo'lmasa (lokal sinov) — os moduli bilan taxminiy
    const total = os.totalmem();
    const used = total - os.freemem();
    return { totalGb: bytesToGb(total), usedGb: bytesToGb(used), usedPct: Math.round((used / total) * 100) };
  }
}

function readLoad() {
  const [m1, m5, m15] = os.loadavg();
  const cores = os.cpus().length || 1;
  return {
    cores,
    m1: Math.round(m1 * 100) / 100,
    m5: Math.round(m5 * 100) / 100,
    m15: Math.round(m15 * 100) / 100,
    // Yadro soniga nisbatan foiz — 100% dan oshsa navbat hosil bo'lyapti.
    pct: Math.round((m1 / cores) * 100),
  };
}

async function readDisk() {
  const out = await run('df', ['-B1', '/']);
  if (!out) return null;
  const line = out.trim().split('\n').pop();
  const parts = line.trim().split(/\s+/);
  const total = Number(parts[1]);
  const used = Number(parts[2]);
  if (!total) return null;
  return { totalGb: bytesToGb(total), usedGb: bytesToGb(used), usedPct: Math.round((used / total) * 100) };
}

// --- fail2ban: nechta IP banlangan, qaysi jail'larda ---
async function readFail2ban() {
  const status = await run('fail2ban-client', ['status']);
  if (!status) return null;
  const m = status.match(/Jail list:\s*(.*)/);
  const jails = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
  const detail = [];
  let totalBanned = 0;
  for (const jail of jails.slice(0, 12)) {
    const out = await run('fail2ban-client', ['status', jail]);
    if (!out) continue;
    const cur = Number((out.match(/Currently banned:\s*(\d+)/) || [])[1] || 0);
    const tot = Number((out.match(/Total banned:\s*(\d+)/) || [])[1] || 0);
    totalBanned += cur;
    detail.push({ jail, banned: cur, totalBanned: tot });
  }
  // Ko'p banlangani birinchi — muammoli jail darhol ko'rinsin.
  detail.sort((a, b) => b.banned - a.banned);
  return { jails: detail, totalBanned };
}

// --- SSH: oxirgi 24 soatdagi muvaffaqiyatsiz kirish urinishlari ---
// `journalctl` bo'lmasa `/var/log/auth.log` ga tushamiz.
async function readSshFailures() {
  const out = await run('journalctl', ['-u', 'ssh', '-u', 'sshd', '--since', '-24h', '--no-pager', '-q']);
  const text = out != null ? out : (() => {
    try { return fs.readFileSync('/var/log/auth.log', 'utf8'); } catch { return null; }
  })();
  if (text == null) return null;
  const failed = (text.match(/Failed password|Invalid user|authentication failure/g) || []).length;
  const accepted = (text.match(/Accepted (password|publickey)/g) || []).length;
  return { failed, accepted };
}

async function readUptime() {
  try {
    const secs = Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
    return Math.round(secs);
  } catch {
    return Math.round(os.uptime());
  }
}

// Barcha ko'rsatkichlarni parallel yig'adi. Biri ishlamasa `null` qaytadi
// va UI "mavjud emas" deb ko'rsatadi — butun panel yiqilmaydi.
async function collect() {
  const [disk, fail2ban, ssh, uptime] = await Promise.all([
    readDisk(),
    readFail2ban(),
    readSshFailures(),
    readUptime(),
  ]);
  return {
    host: os.hostname(),
    at: new Date().toISOString(),
    uptimeSec: uptime,
    load: readLoad(),
    memory: readMemory(),
    disk,
    fail2ban,
    ssh,
  };
}

module.exports = { collect };
