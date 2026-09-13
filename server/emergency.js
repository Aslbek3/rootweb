// Favqulodda amallar — Claude'siz, to'g'ridan-to'g'ri.
//
// Nega Claude orqali emas: eng kerak bo'ladigan payt — o'zingiz
// fail2ban/UFW ga tushib qolgan, yoki VPS band bo'lgan payt. Aynan o'shanda
// Claude sekin bo'lishi, limitga urilishi yoki umuman javob bermasligi
// mumkin. Chiqish yo'li AI'ga bog'liq bo'lmasligi kerak.
//
// Faqat `INSTANCE_MODE=root` da yoqiladi (`config.IS_ROOT`) — sandbox
// nusxasida bu amallar uchun huquq ham yo'q.
//
// Xavfsizlik: barcha buyruqlar shellsiz (`execFile`), IP qat'iy tekshiruvdan
// o'tadi, va amallar ro'yxati QAT'IY — foydalanuvchi buyruq matnini
// boshqara olmaydi.

const { execFile } = require('child_process');

const EXEC_TIMEOUT = 8000;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: EXEC_TIMEOUT, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr && stderr.trim()) || err.message));
      resolve(String(stdout).trim());
    });
  });
}

// IPv4 yoki IPv6. Buyruqqa argument sifatida uzatilgani uchun shell
// in'ektsiyasi baribir mumkin emas, lekin noto'g'ri kirish erta rad etilsin.
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,45}$/;

function assertIp(ip) {
  if (typeof ip !== 'string' || (!IPV4.test(ip) && !IPV6.test(ip))) {
    throw new Error("Noto'g'ri IP manzil");
  }
  return ip;
}

const JAIL_NAME = /^[a-zA-Z0-9_.-]{1,64}$/;

// Berilgan IP qaysi jail'larda banlangan — barchasidan chiqaramiz.
// Jail nomini bilmaslik kerak emas: "meni chiqar" deyish yetarli.
async function unbanIp(ip) {
  assertIp(ip);
  const status = await run('fail2ban-client', ['status']);
  const m = status.match(/Jail list:\s*(.*)/);
  const jails = m ? m[1].split(',').map((s) => s.trim()).filter((j) => JAIL_NAME.test(j)) : [];
  const freed = [];
  for (const jail of jails) {
    try {
      await run('fail2ban-client', ['set', jail, 'unbanip', ip]);
      freed.push(jail);
    } catch {
      // Bu jail'da banlangan emas — normal holat, davom etamiz.
    }
  }
  return { ip, unbannedFrom: freed, checkedJails: jails.length };
}

// IP'ni doimiy ruxsat ro'yxatiga qo'shish (fail2ban qayta banlamasligi uchun
// UFW darajasida). Faqat SSH portiga — butun serverni ochib yubormaslik uchun.
async function allowIpSsh(ip) {
  assertIp(ip);
  const out = await run('ufw', ['allow', 'from', ip, 'to', 'any', 'port', '22', 'proto', 'tcp']);
  return { ip, result: out };
}

async function sshStatus() {
  const [active, ufw] = await Promise.all([
    run('systemctl', ['is-active', 'ssh']).catch(() => run('systemctl', ['is-active', 'sshd']).catch(() => 'unknown')),
    run('ufw', ['status']).catch(() => null),
  ]);
  return { sshActive: active, ufw };
}

// Banlangan IP'lar ro'yxati — "meni banlab qo'ydimi?" degan savolga javob.
async function bannedList() {
  const status = await run('fail2ban-client', ['status']);
  const m = status.match(/Jail list:\s*(.*)/);
  const jails = m ? m[1].split(',').map((s) => s.trim()).filter((j) => JAIL_NAME.test(j)) : [];
  const out = [];
  for (const jail of jails) {
    try {
      const s = await run('fail2ban-client', ['status', jail]);
      const ips = ((s.match(/Banned IP list:\s*(.*)/) || [])[1] || '').split(/\s+/).filter(Boolean);
      if (ips.length) out.push({ jail, ips });
    } catch { /* jail o'qilmadi — tashlab ketamiz */ }
  }
  return out;
}

module.exports = { unbanIp, allowIpSsh, sshStatus, bannedList };
