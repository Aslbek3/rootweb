# rootweb — Claude foydalanish (usage) ko'rsatkichini "fayllar" yoniga qo'shish

## Kontekst

Foydalanuvchi topbar'da "fayllar" tugmasi yonida Claude sessiyasining foydalanish statistikasini (token/xarajat) ko'rsatadigan yangi element so'radi ("claude limit" dedi, keyin "usage nazarda tutdim" deb aniqlashtirdi — ya'ni obuna rate-limit foizi emas, balki qancha token/pul sarflanganini ko'rsatuvchi statistika).

Tekshiruv (Explore agent, `@anthropic-ai/claude-agent-sdk` v0.3.226 manba kodi + `sessionManager.js` o'qilgan) shuni aniqladi:
- `query()`dan qaytadigan `Query` obyekti (`server/sessionManager.js:131`dagi `q`) stream qiladigan `SDKResultMessage` (har bir navbat oxirida keladi, `sessionManager.js:198`dagi `case 'result':`da allaqachon qabul qilinadi) tarkibida **`usage`** (shu navbat uchun kirish/chiqish token soni — Anthropic Messages API standart shakli) va **`total_cost_usd`** (butun `query()` sessiyasi uchun **kumulyativ** dollar xarajati) maydonlari bor.
- Hozir `sessionManager.js:198-205`dagi `case 'result':` faqat `message.is_error`/`message.errors`ni o'qiydi — `usage`/`total_cost_usd` **qabul qilinadi-yu, tashlab yuboriladi**. Bularni ushlab qolish uchun yangi tarmoq/API chaqiruvi SHART EMAS — allaqachon oqib kelayotgan ma'lumot.
- Bundan tashqari SDK'da eksperimental `q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` metodi ham bor — bu haqiqiy obuna rate-limit (5-soatlik/haftalik %) ma'lumotini beradi, lekin nomi ham aytib turganidek **beqaror/eksperimental** va foydalanuvchi aniq "usage" (sarflangan token/pul) so'ragani uchun **bu safar ishlatilmaydi** — kelajakda alohida so'ralsa qo'shiladi.
- `usage.input_tokens`/`output_tokens` **har bir navbat uchun alohida** keladi (kumulyativ emas) — sessiya davomidagi umumiy sonni ko'rsatish uchun server tomonda yig'ib borish kerak. `total_cost_usd` esa SDK'ning o'zi kumulyativ hisoblab beradi — shunchaki oxirgi qiymatni saqlash kifoya.
- `public/app.js`da hozircha "usage"/"cost"/"token" bilan bog'liq HECH NARSA yo'q (grep bilan tasdiqlangan) — bu butunlay yangi UI elementi.

## Yondashuv

**Server (`server/sessionManager.js`):**
- Session closure'iga ikkita yangi holat o'zgaruvchisi qo'shiladi: `let cumulativeInputTokens = 0;`, `let cumulativeOutputTokens = 0;`, `let totalCostUsd = 0;` (`permissionMode` o'zgaruvchisi joylashgan joy atrofida, ~69-qator).
- `case 'result':` (198-205-qator) ichida, mavjud `emit({type:'result',...})`dan keyin: agar `message.usage` mavjud bo'lsa `cumulativeInputTokens`/`cumulativeOutputTokens`ga `input_tokens`/`output_tokens`ni qo'shish (`+=`), agar `message.total_cost_usd` raqam bo'lsa `totalCostUsd`ni shu qiymatga tenglashtirish (`=`, chunki SDK allaqachon kumulyativ beradi). Shundan keyin `emit({ type: 'usage_update', inputTokens: cumulativeInputTokens, outputTokens: cumulativeOutputTokens, totalCostUsd })` — joriy holatdagi jonli ulangan clientlarga darhol yetkaziladi.
- `snapshot()` (280-292-qator) qaytaradigan obyektga `usage: { inputTokens: cumulativeInputTokens, outputTokens: cumulativeOutputTokens, totalCostUsd }` maydoni qo'shiladi (xuddi `permissionMode` kabi — bu orqali qayta ulanadigan/loyiha almashtirilgan client tarixni qayta o'ynatishga bog'liq bo'lmasdan, darhol to'g'ri joriy summani oladi, `MAX_HISTORY=500` kesilishidan mustaqil).

**Server (`server/index.js`):**
- `attachToProject()` (~373-386-qator)dagi `session_state` xabariga `usage: snap.usage,` maydoni qo'shiladi (boshqa `snap.*` maydonlari qatorida).

**Client (`public/app.js`):**
- `handleMessage()` switch'iga (~433-qator, `case 'result':` yonida) yangi `case 'usage_update':` qo'shiladi — kelgan `inputTokens`/`outputTokens`/`totalCostUsd`ni modul darajasidagi `usageState` obyektiga yozadi va agar panel ochiq bo'lsa uni qayta chizadi (`renderUsagePanel()`).
- `case 'session_state':` handleridagi tarix-replay tsiklidan OLDIN (yoki alohida) `usageState`ni `msg.usage`dan to'ldirish (server snapshot orqali yuborgan joriy qiymat — tarix-replay orqali emas, to'g'ridan-to'g'ri).
- Yangi `usageBtn`/`usagePanel` const'lari, click handler: panelni ochish/yopish (`.hidden` klassi toggle), tashqariga bosilganda yopish (mavjud `drawerOverlay` kabi alohida overlay shart emas — oddiy `document.addEventListener('click', ...)` bilan panel tashqarisiga bosishni aniqlash, chunki bu kichik popover, to'liq-ekran overlay emas).
- `renderUsagePanel()` funksiyasi: panel ichini `usageState`dan yangilaydi — "Kirish: N", "Chiqish: N", "Xarajat: $X.XXXX" qatorlari (`toLocaleString()` bilan formatlangan sonlar, xarajat `toFixed(4)` bilan).

**HTML (`public/index.html`):**
- Topbar `.tl-actions` ichida, `filesBtn`dan KEYIN (foydalanuvchi "fayllar yoniga" dedi), yangi `<button class="icon-btn" id="usageBtn" title="Foydalanish statistikasi">` — ichida oddiy bar-chart (statistika) SVG ikonkasi (`<path d="M5 20V11"/><path d="M12 20V4"/><path d="M19 20v-7"/>`, boshqa ikonkalar bilan bir xil outline uslubda).
- Shu tugma yonida (yoki `.app-shell` ichida, `position: absolute` bilan joylashtiriladigan) bo'sh `<div id="usagePanel" class="usage-panel hidden"></div>` konteyneri — `app.js` uni to'ldiradi.

**CSS (`public/style.css`):**
- `.usage-panel` — kichik suzuvchi kartochka: `position: absolute; top: <topbar balandligi>; right: 10px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; font-size: 12.5px; box-shadow: 0 12px 30px -10px rgba(0,0,0,0.4); z-index: 50; min-width: 190px;` + `.hidden { display:none; }`.
- Ichidagi qatorlar uchun `.usage-row { display:flex; justify-content:space-between; gap:12px; padding:3px 0; color: var(--text-dim); }` va qiymat uchun `.usage-row span:last-child { color: var(--text); font-family: var(--mono); }`.
- Nafis-accent qoidasiga mos ravishda (oldingi ishda tasdiqlangan): rang portlashi YO'Q, faqat neytral kartochka, ehtimol sarlavha/ikonka accent rangda bo'lishi mumkin (masalan panel sarlavhasi "Foydalanish" so'zi yoki eng yuqori qiymat accent rangda ajratiladi) — to'liq bo'yash YO'Q.

## Doiradan tashqarida (bu safar qilinmaydi)

- Obuna rate-limit foizi (5-soatlik/haftalik) — `usage_EXPERIMENTAL_...()` orqali texnik jihatdan mumkin, lekin (a) beqaror/eksperimental API, (b) foydalanuvchi aniq "usage" (sarf) so'radi, "limit" emas. Kerak bo'lsa alohida so'rov sifatida keyinroq qo'shiladi.
- Model bo'yicha taqsimot (`modelUsage`) — mavjud, lekin v1'da soddalik uchun faqat umumiy kirish/chiqish/xarajat ko'rsatiladi.
- Cache-token'lar (`cache_read_input_tokens`/`cache_creation_input_tokens`) alohida ko'rsatilmaydi — soddalik uchun asosiy `input_tokens`/`output_tokens`ga e'tibor qaratiladi.
- Bu ma'lumot **faqat joriy server-sessiya davomida** (pm2 restart bo'lgunча) kumulyativ — doimiy saqlanmaydi (DB/fayl yo'q), bu chegara qabul qilinadi (v1 uchun yetarli).

## Tekshirish

1. `node -c server/sessionManager.js`, `node -c server/index.js`, `node -c public/app.js` — sintaksis.
2. `pm2 restart rootweb --update-env`, `pm2 logs rootweb --err --lines 30 --nostream` — xatosiz ko'tarilishi.
3. HTTPS orqali login qilib (`curl` bilan, avvalgi usul), bosh sahifa/`app.js`/`style.css` 200 qaytarishini va yangi kod (`usage_update`, `usageBtn`, `usage-panel`) xizmat qilinayotganini tasdiqlash.
4. Haqiqiy funksional tekshiruv uchun (Claude bilan real xabar almashish, `usage` qiymati chindan kelayotganini ko'rish) — Chrome kengaytmasi ulanganda vizual sinov, yoki WS orqali qo'lda test skript bilan (`node22` + `ws` paketi, cookie olib ulanib, bitta xabar yuborib `usage_update` xabari kelishini kuzatish) tasdiqlash.
5. O'zgarishlar keyin `/root/vps/projects/web/rootweb/`ga ko'chirilib GitHub'ga (`Aslbek3/vps`) push qilinadi, avvalgi workflow'ga muvofiq.
