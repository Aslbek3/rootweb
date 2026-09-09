// Service worker — ilova qobig'ini (shell) keshlaydi.
//
// Nega kerak: avval SW umuman yo'q edi, ya'ni "Bosh ekranga qo'shish"
// qilingan ilova internetsiz umuman ochilmasdi va har safar barcha
// fayllarni qaytadan yuklardi (app.js ~75KB, style.css ~45KB,
// highlight.js ~120KB).
//
// ⚠️ Ehtiyotkorlik: noto'g'ri yozilgan SW eski fayllarni abadiy keshda
// ushlab, ilovani "yangilanmaydigan" holatga tushirib qo'yishi mumkin.
// Shuning uchun:
//   - `CACHE_VERSION` har deployda o'zgaradi (pastga qara);
//   - HTML va API so'rovlari HECH QACHON keshdan berilmaydi (network-first),
//     faqat tarmoq butunlay ishlamasa zaxira sifatida ishlatiladi;
//   - `skipWaiting` + `clients.claim` — yangi versiya darhol kuchga kiradi.

// Deploy paytida o'zgartirilishi kerak bo'lgan yagona qator.
// Statik fayllar o'zgarganda uni oshiring (yoki deploy skriptida
// avtomatlashtiring), aks holda foydalanuvchi eski qobiqni ko'rishda
// davom etadi.
const CACHE_VERSION = 'rootweb-v3';

// Faqat login talab qilmaydigan yoki o'zgarmas statik resurslar.
const SHELL = [
  '/style.css',
  '/app.js',
  '/ui-core.js',
  '/bash-explain.js',
  '/theme-boot.js',
  '/manifest.json',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/vendor/highlight.min.js',
  '/vendor/highlight-github-dark.min.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // `reload` — o'rnatish paytida brauzerning o'z keshidan emas,
      // tarmoqdan olinsin.
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      // Bitta fayl topilmasa ham o'rnatish buzilmasin (masalan hali
      // deploy qilinmagan yangi fayl).
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API, WebSocket, SSE va HTML — hech qachon keshdan berilmaydi.
  // Sabab: `/` va `/index.html` autentifikatsiyaga qarab `login.html`ga
  // yo'naltiriladi; bu javobni keshlash chiqib ketgan foydalanuvchini
  // eski sahifada qoldirib qo'yardi.
  const isApi = url.pathname.startsWith('/api/');
  const isDoc = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
  if (isApi || isDoc) return;

  // Statik resurslar: avval keshdan (tez), fonda yangilab qo'yamiz.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
