// Instansiya sozlamalari — bitta kod, ikki xil o'rnatma.
//
// Bu loyiha VPS'da IKKI marta ishlaydi va ular ikki xil "shaxs":
//
//   INSTANCE_MODE=root     — to'liq VPS boshqaruvi (rootweb). Root sifatida,
//                            izolyatsiyasiz. Butun tizimga yetadi.
//   INSTANCE_MODE=sandbox  — kod yozish muhiti (claudeuz). Alohida tizim
//                            foydalanuvchisi (uid 1001), ACL bilan o'z uy
//                            papkasiga qamalgan, ALOHIDA Claude hisobi.
//
// Ikkalasi alohida repo, alohida hisob, alohida limit — lekin KOD BIR XIL.
// Farqlar faqat shu faylda to'planadi, shunda bir joyda qilingan tuzatish
// ikkalasiga ham tushadi va "bir marta tuzatib, ikkinchisida unutish"
// muammosi yo'qoladi.

const MODE = process.env.INSTANCE_MODE === 'sandbox' ? 'sandbox' : 'root';
const IS_ROOT = MODE === 'root';

// Yangi sessiya qaysi ruxsat rejimida boshlanadi.
//
// root'da "avto" (acceptEdits): bu shaxsiy vosita, egasi har safar qo'lda
// [avto] bosishni xohlamaydi, va Bash siyosati (`bashPolicy.js`) baribir
// allowlist bilan cheklab turadi.
//
// sandbox'da "manual" (default): u yerda ishlaydigan kod mijozlarga xizmat
// qiladigan botlar — har o'zgarish ko'z bilan tasdiqlansin.
const DEFAULT_PERMISSION_MODE = IS_ROOT ? 'acceptEdits' : 'default';

// Ichki veb-ilovaga proksi (`/savdo` kabi). 0 bo'lsa o'chirilgan.
// sandbox'da `savdo-hisob` shu orqali ochiladi, chunki u foydalanuvchida
// root/SSH yo'qligi sababli o'z nginx bloki va domeniga ega bo'la olmaydi.
const PROXY_PREFIX = process.env.PROXY_PREFIX || '/savdo';
const PROXY_PORT = Number(process.env.PROXY_PORT) || 0;

// "Qurilmalar" tabi — bir xil tarmoqdagi boshqa claude-web nusxalariga
// tezkor o'tish ro'yxati (localStorage'da). Lokal Wi-Fi holati uchun
// yaratilgan; VPS'da ixtiyoriy.
const SHOW_DEVICES_TAB = process.env.SHOW_DEVICES_TAB === '1';

// Bir vaqtda ochiq bo'lishi mumkin bo'lgan Claude sessiyalari soni.
// HAR BIR sessiya alohida `claude` subprocess (~300-400 MB), shuning uchun
// bu to'g'ridan-to'g'ri xotira cheklovi. VPS'da 26 ta root bot + 8 ta
// sandbox bot allaqachon ~4.5 GB egallaydi — cheklovsiz qoldirilsa,
// bir nechta loyiha ochilganda OOM killer tasodifiy botni o'ldiradi.
const MAX_SESSIONS = Math.max(1, Number(process.env.MAX_SESSIONS) || 3);

// Shuncha daqiqa ishlatilmagan sessiya avtomatik yopiladi (subprocess
// o'ldiriladi). Tarix diskda qoladi, keyingi ochilishda tiklanadi.
const SESSION_IDLE_MINUTES = Math.max(5, Number(process.env.SESSION_IDLE_MINUTES) || 45);

module.exports = {
  MODE,
  IS_ROOT,
  DEFAULT_PERMISSION_MODE,
  PROXY_PREFIX,
  PROXY_PORT,
  SHOW_DEVICES_TAB,
  MAX_SESSIONS,
  SESSION_IDLE_MINUTES,
};
