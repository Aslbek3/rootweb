// Terminal buyrug'ini oddiy o'zbek tiliga o'giradi va xavf darajasini
// aniqlaydi — ruxsat kartochkasida ko'rsatish uchun.
//
// Nega alohida fayl: bu foydalanuvchiga "faqat o'qiydi" yoki "xavfli" deb
// ko'rsatadigan mantiq. Noto'g'ri yorliq (masalan `rm -rf` ni "xavfsiz"
// deyish) foydalanuvchini o'ylamasdan tasdiqlashga undaydi, ya'ni bu
// xavfsizlikka taalluqli kod va TEST bilan qoplanishi kerak
// (`test/bashExplain.test.js`).
//
// Fayl DOM'ga bog'liq emas, shuning uchun brauzerda ham, Node testida ham
// ishlaydi.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.RW = root.RW || {};
    Object.assign(root.RW, api);
  }
}(typeof self !== 'undefined' ? self : globalThis, function () {
  // Ro'yxat to'liq bo'lishi shart emas: mos kelmasa "noma'lum" deymiz va
  // foydalanuvchini ehtiyot bo'lishga chaqiramiz. Yangi buyruq turlari
  // paydo bo'lsa shu yerga qo'shiladi.
  const BASH_EXPLAINERS = [
    // --- faqat o'qish ---
    { re: /^\s*(ls|dir)\b/, risk: 'read', title: "Papka ichidagi fayllar ro'yxatini ko'radi" },
    { re: /^\s*(cat|head|tail|less|more)\b/, risk: 'read', title: 'Fayl ichini o\'qiydi' },
    { re: /\bgit\s+(status|log|diff|show|branch|rev-parse|ls-files|blame)\b/, risk: 'read', title: "Kod tarixini va o'zgarishlarni ko'radi" },
    { re: /\b(grep|rg|egrep|fgrep)\b/, risk: 'read', title: 'Fayllar ichidan matn qidiradi' },
    { re: /\bfind\b/, risk: 'read', title: 'Fayl yoki papka qidiradi' },
    { re: /\bpm2\s+(list|jlist|ls|status|describe|show)\b/, risk: 'read', title: "Botlar ro'yxati va holatini ko'radi" },
    { re: /\bpm2\s+logs\b/, risk: 'read', title: 'Bot loglarini o\'qiydi' },
    { re: /\bsystemctl\s+status\b/, risk: 'read', title: 'Xizmat holatini tekshiradi' },
    { re: /\b(df|du|free|uptime|ps|top)\b/, risk: 'read', title: 'Server resurslarini (disk, xotira) tekshiradi' },
    { re: /\bnginx\s+-t\b/, risk: 'read', title: 'Nginx sozlamasini xatolarga tekshiradi' },
    { re: /\b(curl|wget)\b/, risk: 'read', title: 'Internetdan ma\'lumot yuklab oladi' },
    { re: /\bnpm\s+(test|run\s+test)\b/, risk: 'read', title: 'Testlarni ishga tushiradi' },
    { re: /\b(echo|printf|pwd|whoami|date|which)\b/, risk: 'read', title: 'Oddiy ma\'lumot chiqaradi' },

    // --- o'zgartiradi, lekin xavfsiz ---
    { re: /\bgit\s+(add|commit)\b/, risk: 'write', title: "O'zgarishlarni saqlaydi (commit qiladi)" },
    { re: /\bgit\s+(pull|fetch|merge|checkout|switch)\b/, risk: 'write', title: "Kod nusxasini yangilaydi yoki shox almashtiradi" },
    { re: /\bmkdir\b/, risk: 'write', title: 'Yangi papka yaratadi' },
    { re: /\btouch\b/, risk: 'write', title: 'Bo\'sh fayl yaratadi' },
    { re: /\bcp\b/, risk: 'write', title: 'Fayl nusxasini oladi' },
    { re: /\bmv\b/, risk: 'write', title: "Faylni ko'chiradi yoki nomini o'zgartiradi" },
    { re: /\b(tar|zip|unzip|gzip)\b/, risk: 'write', title: 'Fayllarni arxivlaydi yoki ochadi' },
    { re: /\bnpm\s+(install|i|ci)\b/, risk: 'write', title: 'Kerakli kutubxonalarni o\'rnatadi' },
    { re: /\bnpm\s+run\b/, risk: 'write', title: 'Loyiha skriptini ishga tushiradi' },
    { re: /\bsed\s+-i\b/, risk: 'write', title: 'Fayl ichidagi matnni o\'zgartiradi' },

    // --- ishlab turgan xizmatga tegadi ---
    { re: /\bgit\s+push\b/, risk: 'service', title: "O'zgarishlarni GitHub'ga yuboradi" },
    { re: /\bpm2\s+(restart|reload)\b/, risk: 'service', title: 'Botni qayta ishga tushiradi (bir necha soniya ishlamaydi)' },
    { re: /\b(systemctl|service)\s+\S*\s*(restart|reload)\b/, risk: 'service', title: 'Server xizmatini qayta ishga tushiradi' },
    { re: /\bnginx\s+-s\s+reload\b/, risk: 'service', title: 'Nginx sozlamasini qayta yuklaydi' },

    // --- xavfli ---
    { re: /\bpm2\s+(stop|delete|kill)\b/, risk: 'danger', title: "Botni TO'XTATADI — qo'lda yoqmaguncha ishlamaydi" },
    { re: /\b(systemctl|service)\s+\S*\s*(stop|disable|mask)\b/, risk: 'danger', title: "Server xizmatini TO'XTATADI" },
    { re: /\brm\b/, risk: 'danger', title: "Fayl yoki papkani O'CHIRADI — qaytarib bo'lmaydi" },
    { re: /\bsudo\b/, risk: 'danger', title: 'To\'liq administrator huquqi bilan bajaradi' },
    { re: /\b(shutdown|reboot|poweroff|halt)\b/, risk: 'danger', title: 'SERVERNI o\'chiradi yoki qayta yuklaydi' },
    { re: /\b(useradd|userdel|usermod|passwd)\b/, risk: 'danger', title: 'Server foydalanuvchi hisoblarini o\'zgartiradi' },
    { re: /\b(iptables|ufw|firewall-cmd)\b/, risk: 'danger', title: 'Server xavfsizlik devorini (firewall) o\'zgartiradi' },
    { re: /\bDROP\s+(DATABASE|TABLE|SCHEMA)\b/i, risk: 'danger', title: 'Ma\'lumotlar bazasini O\'CHIRADI' },
    { re: /\bdocker\s+(rm|rmi|stop|kill)\b/, risk: 'danger', title: 'Docker konteynerini to\'xtatadi/o\'chiradi' },
    { re: /\bgit\s+push\b[^|;&\n]*(--force|-f)\b/, risk: 'danger', title: "GitHub'dagi tarixni MAJBURAN qayta yozadi" },
    { re: /\b(mkfs|fdisk|parted|wipefs)\b/, risk: 'danger', title: 'Diskni formatlaydi — HAMMA narsa yo\'qoladi' },
    { re: /\bdd\s+if=/, risk: 'danger', title: 'Diskka to\'g\'ridan-to\'g\'ri yozadi — juda xavfli' },
    { re: /\bchmod\b|\bchown\b/, risk: 'danger', title: 'Fayllarga kirish huquqlarini o\'zgartiradi' },
    { re: /\bcrontab\s+-r\b/, risk: 'danger', title: 'Barcha rejalashtirilgan vazifalarni o\'chiradi' },
    { re: /\bapt(-get)?\s+(remove|purge|autoremove)\b/, risk: 'danger', title: 'Server dasturlarini o\'chiradi' },
  ];

  const RISK_LABEL = {
    read: "Faqat o'qiydi — hech narsa o'zgarmaydi",
    write: "Fayllarni o'zgartiradi",
    service: 'Ishlab turgan xizmatga tegadi',
    danger: "Xavfli — yo'qotish mumkin",
    unknown: "Noma'lum buyruq — diqqat bilan qarang",
  };

  const RISK_ORDER = { read: 0, write: 1, service: 2, danger: 3 };

  // Buyruqni tahlil qiladi. Zanjirdagi (`&&`, `;`, `|`) qismlardan ENG
  // XAVFLISI ustun turadi — masalan `git status && rm -rf /tmp/x` "xavfli"
  // deb belgilanadi, "faqat o'qiydi" deb emas.
  function explainBash(command) {
    const cmd = String(command == null ? '' : command);
    if (!cmd.trim()) return { risk: 'unknown', title: "Terminal buyrug'i bajariladi" };
    let best = null;
    for (const e of BASH_EXPLAINERS) {
      if (!e.re.test(cmd)) continue;
      if (!best || RISK_ORDER[e.risk] > RISK_ORDER[best.risk]) best = e;
    }
    if (best) return { risk: best.risk, title: best.title };
    return { risk: 'unknown', title: "Terminal buyrug'i bajariladi" };
  }

  return { explainBash, RISK_LABEL, BASH_EXPLAINERS };
}));
