# rootweb (claude-code-web, root nusxasi)

> Bu faylning **maxfiy** (parol/manzil bilan) versiyasi `CLAUDE.md` faqat serverda mahalliy saqlanadi va bu public repo'ga qo'shilmaydi. Quyida shu faylning tahlil uchun ochiq (redacted) nusxasi.

Telefon/brauzer uchun Claude Code veb-interfeysi. Express + WebSocket server, `@anthropic-ai/claude-agent-sdk` orqali ishlaydi. Bu `/root/vps/claudeweb/`dan nusxa olingan **ikkinchi instansiya** — u yerdagidan farqli, bu **to'liq root huquqi bilan, izolyatsiyasiz** ishlaydi (shaxsiy, butun VPS'ni boshqarish uchun vosita).

## Manzil va kirish

- **URL:** [REDACTED — maxfiy, public repo'da ko'rsatilmaydi]
- **Parol:** `.env` dagi `APP_PASSWORD` ([REDACTED — qiymati faqat serverdagi `.env`da, repo'da saqlanmaydi])
- nginx (`/etc/nginx/sites-available/rootweb`) + certbot HTTPS orqali lokal portga proxy qiladi. Server o'zi faqat `127.0.0.1`da tinglaydi.
- Qo'shimcha himoya: `fail2ban` jaili `rootweb-login` (`/api/login`ga 5 marta noto'g'ri parol → 24 soat ban).

## claudeweb'dan farqi — IZOLYATSIYA YO'Q, ATAYLAB

- **`claudeweb` (uid 1001) EMAS, ROOT sifatida ishlaydi** — pm2 process `rootweb`, root'ning ASOSIY pm2 daemonida, alohida daemon/systemd unit YO'Q.
- **ACL yo'q** — root VPS'dagi hamma narsaga to'liq kira oladi. Fayl-brauzer/muharrir faqat ilovaning o'z UI qulayligi uchun boshlang'ich nuqta — **Bash toolining o'zi hech qanday jildga qamalmagan**, `cd`/absolute path bilan butun tizimga yetadi. Bu xavfsizlik chegarasi emas.
- **Claude hisobi — shaxsiy hisob** (mahalliy `~/.claude/` konfiguratsiyasi orqali) — alohida ikkinchi hisob YO'Q, claudeweb'dan farqli. Ya'ni bu ilova va terminal `claude` sessiyalari BIR XIL obuna/rate-limitni baham ko'radi.
- Node: root'ning o'z nvm'i ishlatiladi.
- Kod papkasi: `/root/vps/rootweb/`.

## Standart ruxsat rejimi — "avto" (`acceptEdits`), claudeweb'dan farqli

`server/sessionManager.js`da har bir yangi sessiya **standart ravishda "avto" rejimda** boshlanadi (claudeweb'da standart "manual"). Xatti-harakat:

- Write/Edit/NotebookEdit — so'rovsiz.
- Bash — `DANGEROUS_BASH_PATTERNS` denylist'iga tushmagan HAR QANDAY buyruq so'rovsiz (pm2 restart, git, npm/apt install, nginx -t/reload, fayl tahrirlash va h.k.).
- Denylist claudeweb'nikidan **KUCHAYTIRILGAN** (root blast-radius kattaligi uchun) — umumiy ro'yxatga (`sudo`, `rm -rf`, `dd if=`, `mkfs`, fork bomb, `chmod 777`, `chown -R`, curl/wget|sh, `git push --force`, `shutdown/reboot`, `killall`, `iptables/ufw`, `>>/etc/`, `crontab -r`, `--no-preserve-root`) ustiga qo'shilgan bir nechta ish-servis darajasidagi buyruq guruhlari (bot/konteyner/xizmat/hisob boshqaruvi bilan bog'liq).
- So'rovsiz QOLADI (kundalik ish): `pm2 restart <nom>`, kod tahrirlash, `pm2 logs/list`, `systemctl restart/reload`, `git push` (force'siz), paket o'rnatish, log ko'rish.
- `bypassPermissions` HECH QACHON ishlatilmaydi — denylist'ga tushgan narsa har doim chatda ruxsat kartochkasi chiqarib to'xtaydi, faqat tasdiqlangach davom etadi.
- `[manual]/[plan]/[avto]` tugmasi composer ustida — istalgan payt qo'lda almashtirsa bo'ladi.

## Loyihalar ("loyihalar" paneli)

Standart: `/root` (label "workspace"). Qo'shimcha qo'shilgan: `/root/vps` (label "vps") — fayl yuklash/yuklab olish shu yerdan qulay. Yangi loyiha istalgan payt "loyihalar" panelidagi "+ yo'l bo'yicha qo'shish" orqali qo'shiladi.

## Fayllar paneli — to'liq boshqaruv + "Papkalar" tabi (claudeweb'dan farqli, faqat rootweb'da)

Fayllar API'si (`server/index.js`) `projectId` YOKI to'g'ridan-to'g'ri absolyut `root` query-parametri bilan ishlaydi (`resolveBrowseRoot()`). Bu ikkita imkoniyatni beradi:

- **Fayl/papka boshqaruvi** — har bir qatorda yuklab olish ustiga endi nomini o'zgartirish (qalam) va o'chirish (chiqindi, tasdiqlash bilan) tugmalari bor. Server: `fileApi.deleteEntry`/`renameEntry` (`../` chiqishdan va loyiha/papka ILDIZINI o'chirishdan himoyalangan), `DELETE /api/file`, `POST /api/file/rename`.
- **"Yuqoriga" (`..`) qatori** — `currentDir !== '.'` bo'lganda fayl ro'yxatining boshida chiqadi, breadcrumb'ga qo'shimcha tezkor chiqish yo'li.
- **"Papkalar" tabi** — istalgan absolyut yo'lni (masalan `/etc/nginx`) `localStorage`da yorliq sifatida saqlaydi. Bosilganda `browseRoot` (client-side, `app.js`) o'sha yo'lga o'rnatiladi va fayllar paneli sakraydi — `switch_project` YUBORILMAYDI, ya'ni faol suhbat/loyiha buzilmaydi, faqat fayl ko'rinishi almashadi.
- Bularning barchasi Bash tooli allaqachon cheklanmagan bo'lgani uchun yangi xavf sinfi emas — faqat mavjud imkoniyatga qulay UI qo'shildi.

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
