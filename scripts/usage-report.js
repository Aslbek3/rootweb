// Token sarfini audit-logdan hisobot qilib chiqaradi.
//
// Maqsad: "oddiy vazifa uchun limitning 30% i ketdi" degan holatni
// taxmin bilan emas, RAQAM bilan tushuntirish.
//
// Eng muhim ustun — `kesh%`: Claude Code suhbat kontekstini keshlaydi va
// keshdan o'qish to'liq narxdan ancha arzon. Agar bu foiz past bo'lsa
// (masalan < 50%), demak kesh ishlamayapti va butun suhbat har bir
// xabarda qaytadan to'liq narxda hisoblanmoqda — bu aynan "terminalda
// bunchalik emas" degan farqni beradi.
//
// Ishga tushirish:  node scripts/usage-report.js [nechta_oxirgi_navbat]

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'server', 'data', 'audit.log');
const limit = Math.max(1, Number(process.argv[2]) || 30);

let lines;
try {
  lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
} catch {
  console.error(`audit.log topilmadi: ${LOG_FILE}`);
  process.exit(1);
}

const turns = [];
for (const line of lines) {
  try {
    const e = JSON.parse(line);
    if (e.event === 'turn_usage') turns.push(e);
  } catch { /* buzuq qator — tashlab ketamiz */ }
}

if (!turns.length) {
  console.log('Hali bitta ham `turn_usage` yozuvi yo\'q.');
  console.log('Bu yozuv yangi kod bilan qo\'shildi — deploy qilib, bir-ikki');
  console.log('xabar yozing, keyin shu skriptni qayta ishga tushiring.');
  process.exit(0);
}

const recent = turns.slice(-limit);
const fmt = (n) => Number(n || 0).toLocaleString('uz-UZ');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

console.log(`Oxirgi ${recent.length} ta navbat (jami ${turns.length} ta yozuv)\n`);
console.log('vaqt              kirish     kesh-o\'qish  kesh-yozish  chiqish   kesh%   $');
console.log('─'.repeat(78));

let sumIn = 0; let sumRead = 0; let sumWrite = 0; let sumOut = 0;
for (const t of recent) {
  const totalIn = (t.input || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
  sumIn += t.input || 0;
  sumRead += t.cacheRead || 0;
  sumWrite += t.cacheWrite || 0;
  sumOut += t.output || 0;
  const time = String(t.ts || '').slice(11, 19);
  console.log(
    time.padEnd(10)
    + fmt(t.input).padStart(11)
    + fmt(t.cacheRead).padStart(13)
    + fmt(t.cacheWrite).padStart(13)
    + fmt(t.output).padStart(9)
    + `${pct(t.cacheRead, totalIn)}%`.padStart(8)
    + (t.costUsd != null ? t.costUsd.toFixed(4) : '—').padStart(9),
  );
}

const totalIn = sumIn + sumRead + sumWrite;
console.log('─'.repeat(78));
console.log(
  'JAMI'.padEnd(10)
  + fmt(sumIn).padStart(11)
  + fmt(sumRead).padStart(13)
  + fmt(sumWrite).padStart(13)
  + fmt(sumOut).padStart(9)
  + `${pct(sumRead, totalIn)}%`.padStart(8),
);

console.log('\nXulosa:');
const cacheRatio = pct(sumRead, totalIn);
if (cacheRatio >= 70) {
  console.log(`  Kesh yaxshi ishlayapti (${cacheRatio}%). Sarfning asosiy sababi`);
  console.log('  kesh emas — suhbat uzunligi yoki bajarilayotgan ish hajmi.');
} else if (cacheRatio >= 30) {
  console.log(`  Kesh qisman ishlayapti (${cacheRatio}%). Bir qismi qayta hisoblanmoqda.`);
} else {
  console.log(`  ⚠️ Kesh deyarli ishlamayapti (${cacheRatio}%) — butun suhbat har bir`);
  console.log('  xabarda to\'liq narxda qayta hisoblanmoqda. Sarfning asosiy sababi shu.');
}

const avgIn = Math.round(totalIn / recent.length);
console.log(`\n  Har bir navbatga o'rtacha ${fmt(avgIn)} kirish tokeni.`);
if (avgIn > 100000) {
  console.log('  ⚠️ Bu juda katta — suhbat kontekstini tozalash kerak ("chatni tozalash").');
}
