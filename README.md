# Claude Code Web

Telefon (yoki istalgan brauzer)dan Claude Code'ga o'xshab ishlaydigan veb-interfeys: xabar yozasiz, Claude fayllarni o'qiydi/yozadi, buyruq (PowerShell/Bash) bajaradi — har bir xavfli amal uchun ekranda **Ruxsat berish / Rad etish** tugmalari chiqadi.

## Ishga tushirish

```bash
npm install
```

`.env` faylini oching va:
- `APP_PASSWORD` — telefondan kirishda so'raladigan parolni o'zgartiring
- `PROJECT_DIR` — Claude ishlashi kerak bo'lgan papka yo'li (standart: `./workspace`)

Autentifikatsiya kerak: yoki terminalda `claude login` qilingan bo'lishi kerak (Pro/Max obuna), yoki `.env` ga `ANTHROPIC_API_KEY` qo'shing.

Serverni ishga tushirish:

```bash
npm start
```

Kompyuterda ochish: `http://localhost:3210`

## Telefondan foydalanish

1. Telefon va kompyuter **bir xil Wi-Fi** tarmog'ida bo'lishi kerak.
2. Telefon brauzerida kompyuterning lokal IP manzilini oching, masalan: `http://192.168.100.19:3210`
3. Parolni kiriting.
4. Brauzer menyusidan **"Add to Home Screen" / "Bosh ekranga qo'shish"** ni tanlasangiz, ilova kabi ochiladi.

Kompyuteringizning joriy lokal IP manzili:

```bash
ipconfig
```

("Wireless LAN adapter Wi-Fi" ostidagi IPv4 Address qatoriga qarang.)

## Xavfsizlik haqida eslatma

- Bu server hozircha faqat **lokal tarmoq** uchun mo'ljallangan (parol + cookie bilan himoyalangan, lekin HTTPS yo'q).
- Internetga (masalan, uydan tashqarida ham ishlashi uchun) chiqarish uchun tunnel (Cloudflare Tunnel, Tailscale va h.k.) yoki HTTPS bilan hosting kerak bo'ladi — buni alohida sozlash tavsiya etiladi.
- `Read`, `Grep`, `Glob`, `TodoWrite` avtomatik ruxsat etiladi (faqat o'qish). `Write`, `Edit`, `Bash`/`PowerShell`, `WebFetch` kabi amallar tasdiq so'raydi — `SAFE_TOOLS` ro'yxati `server/sessionManager.js` faylida.
- "Avto" (`acceptEdits`) rejimda Bash buyruqlari **allowlist + denylist** siyosatidan o'tadi (`server/bashPolicy.js`). Siyosat testlar bilan qoplangan: `npm test`.
- Sessiya cookie'si 24 soat amal qiladi; "Chiqish" barcha mavjud sessiyalarni bekor qiladi.
- WebSocket ulanishi `Origin` sarlavhasini tekshiradi (CSWSH himoyasi). Domen aniq bo'lsa `.env`ga `PUBLIC_ORIGIN=https://...` qo'shing.
- Login urinishlari cheklangan: 4 urinish / 15 daqiqa, keyin `429`.
- Sahifa qayta yuklansa (refresh) yoki ulanish uzilsa, suhbat davom etadi — tarix diskda (`server/data/sessions_meta.json`) saqlanadi va qayta ulanishda tiklanadi.

> Batafsil xavfsizlik hujjati: [`docs/xavfsizlik-tuzatishlari.md`](docs/xavfsizlik-tuzatishlari.md)

## VPS'ga joylashtirish

Bu qadamlar Ubuntu/Debian VPS uchun. Domeningiz bo'lsa HTTPS ham olasiz (tavsiya etiladi — aks holda parolingiz tarmoqda ochiq ketadi).

**1. Node.js o'rnatish (VPS'da, SSH orqali):**
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
```

**2. Kodni VPS'ga ko'chirish** (lokal kompyuterdan, `git` yoki `scp` bilan):
```bash
scp -r "D:\Claude hujjatlari\claude web" user@VPS_IP:/home/user/claude-code-web
```

**3. VPS'da o'rnatish:**
```bash
cd ~/claude-code-web
npm install --omit=dev
```

**4. `.env` faylini VPS uchun sozlash** — quyidagilarni o'zgartiring:
```
HOST=127.0.0.1
TRUST_PROXY=1
ANTHROPIC_API_KEY=sk-ant-...    # VPS headless bo'lgani uchun "claude login" o'rniga API kalit ishlating
```
`APP_PASSWORD` va `SESSION_SECRET` allaqachon sozlangan — xohlasangiz o'zgartiring.

**5. systemd xizmati sifatida doim ishlab turishi uchun** ([deploy/claude-code-web.service](deploy/claude-code-web.service)):
```bash
sudo cp deploy/claude-code-web.service /etc/systemd/system/
sudo nano /etc/systemd/system/claude-code-web.service   # USERNAME va yo'llarni to'g'rilang
sudo systemctl daemon-reload
sudo systemctl enable --now claude-code-web
sudo systemctl status claude-code-web
```

**6. nginx orqali chiqarish** ([deploy/nginx.conf](deploy/nginx.conf)):
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/claude-code-web
sudo nano /etc/nginx/sites-available/claude-code-web   # DOMAIN o'rniga domeningizni yozing
sudo ln -s /etc/nginx/sites-available/claude-code-web /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**7. HTTPS olish (domeningiz bo'lsa):**
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d DOMAIN
```

**8. Firewall — faqat 80/443 tashqariga ochiq bo'lsin, 3210 port to'g'ridan-to'g'ri yopiq qolsin:**
```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

Shundan keyin sayt `https://DOMAIN` manzilida, dunyoning istalgan joyidan telefon orqali ochiladi.

## Loyiha tuzilishi

```
server/index.js   — Express + WebSocket server, Claude Agent SDK bilan bog'lanadi
public/           — mobil-qulay chat interfeysi (vanilla HTML/CSS/JS, PWA)
workspace/        — Claude standart ishlaydigan papka (PROJECT_DIR bilan o'zgartiriladi)
deploy/           — VPS uchun nginx va systemd konfiguratsiya shablonlari
```
