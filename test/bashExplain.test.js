// Ruxsat kartochkasidagi tushuntirish va xavf darajasi testlari.
//
// Nega muhim: foydalanuvchi dasturchi emas va kartochkadagi yorliqqa
// ("faqat o'qiydi" / "xavfli") qarab qaror qabul qiladi. Xavfli buyruqni
// xavfsiz deb belgilash — eng yomon xato turi, chunki u foydalanuvchini
// o'ylamasdan tasdiqlashga undaydi.

const test = require('node:test');
const assert = require('node:assert');
const { explainBash, RISK_LABEL } = require('../public/bash-explain');

test('faqat o\'qiydigan buyruqlar to\'g\'ri belgilanadi', () => {
  const readOnly = [
    'ls -la /root',
    'cat /etc/nginx/sites-available/rootweb',
    'git status',
    'git log --oneline -10',
    'grep -rn "TODO" server/',
    'pm2 list',
    'pm2 logs rootweb --lines 50',
    'systemctl status nginx',
    'df -h',
    'nginx -t',
  ];
  for (const cmd of readOnly) {
    assert.strictEqual(explainBash(cmd).risk, 'read', `"read" bo'lishi kerak edi: ${cmd}`);
  }
});

test('xavfli buyruqlar HECH QACHON xavfsiz deb belgilanmaydi', () => {
  // Bu ro'yxatdagi biror buyruq "read" deb belgilansa — jiddiy xato.
  const dangerous = [
    'rm -rf /root/vps',
    'rm eski.txt',
    'sudo apt-get install nginx',
    'pm2 stop zayafka-bot',
    'pm2 delete poster-01',
    'systemctl stop nginx',
    'reboot',
    'ufw disable',
    'chmod 777 /root/.env',
    'dd if=/dev/zero of=/dev/sda',
    'mkfs.ext4 /dev/sdb1',
    'crontab -r',
    'apt-get purge nodejs',
    'docker rm mybot',
    'git push --force',
    'psql -c "DROP DATABASE shop"',
  ];
  for (const cmd of dangerous) {
    assert.strictEqual(explainBash(cmd).risk, 'danger', `"danger" bo'lishi kerak edi: ${cmd}`);
  }
});

test('xizmatga tegadigan buyruqlar ajratiladi', () => {
  assert.strictEqual(explainBash('pm2 restart rootweb --update-env').risk, 'service');
  assert.strictEqual(explainBash('systemctl reload nginx').risk, 'service');
  assert.strictEqual(explainBash('git push').risk, 'service');
});

test('fayl o\'zgartiradigan buyruqlar "write" deb belgilanadi', () => {
  assert.strictEqual(explainBash('mkdir -p /root/yangi').risk, 'write');
  assert.strictEqual(explainBash('cp a.txt b.txt').risk, 'write');
  assert.strictEqual(explainBash('npm install').risk, 'write');
  assert.strictEqual(explainBash('git commit -m "fix"').risk, 'write');
});

test('zanjirdagi ENG XAVFLI qism ustun turadi', () => {
  // `git status` o'zi "read", lekin zanjirda `rm -rf` bor — kartochka
  // "faqat o'qiydi" deb ko'rsatsa foydalanuvchini aldagan bo'lardi.
  assert.strictEqual(explainBash('git status && rm -rf /tmp/x').risk, 'danger');
  assert.strictEqual(explainBash('ls -la; pm2 stop bot').risk, 'danger');
  assert.strictEqual(explainBash('cat log.txt && pm2 restart bot').risk, 'service');
});

test('noma\'lum va bo\'sh buyruqlar ehtiyotkorlik bilan belgilanadi', () => {
  for (const cmd of ['', '   ', null, undefined, 'qandaydir-nomalum-buyruq --flag']) {
    const r = explainBash(cmd);
    assert.strictEqual(r.risk, 'unknown', `"unknown" bo'lishi kerak edi: ${JSON.stringify(cmd)}`);
    assert.ok(r.title, 'sarlavha bo\'sh bo\'lmasligi kerak');
  }
});

test('har bir xavf darajasi uchun o\'zbekcha yorliq bor', () => {
  for (const risk of ['read', 'write', 'service', 'danger', 'unknown']) {
    assert.ok(RISK_LABEL[risk] && RISK_LABEL[risk].length > 5, `yorliq yo'q: ${risk}`);
  }
});

test('tushuntirish har doim o\'zbekcha matn qaytaradi', () => {
  for (const cmd of ['ls', 'rm -rf /', 'pm2 restart x', 'npm install']) {
    const { title } = explainBash(cmd);
    assert.ok(typeof title === 'string' && title.length > 3);
    // Xom buyruqning o'zi sarlavhaga tushib qolmasligi kerak — aynan shu
    // xato tuzatildi (avval "Terminal buyrug'i: <xom buyruq>" ko'rsatilardi).
    assert.ok(!title.includes(cmd), `sarlavhada xom buyruq bor: ${title}`);
  }
});
