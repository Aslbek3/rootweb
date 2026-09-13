# Resurs cheklovi — nega kerak va qanday qo'yiladi

## Muammo

VPS'da o'lchangan holat (2026-09-13, `/api/pm2/list` orqali):

| Nima | Xotira |
|---|---|
| 26 ta root PM2 boti | ~3.3 GB |
| 8 ta sandbox (claudeuz) boti | ~1.2 GB |
| PostgreSQL, nginx, tizim | ~0.5 GB |
| **Claude ishlamaganda band** | **~5.0 GB** |

Har bir ochiq Claude sessiyasi ustiga **300-400 MB** qo'shadi — bu alohida
`claude` subprocess. Uchta loyiha ochilsa ~6 GB.

Bundan tashqari Claude `npm install`, build yoki test ishga tushirishi
mumkin — bular bir zumda 1 GB olishi mumkin.

**Hech qanday cheklov yo'q edi.** ACL izolyatsiyasi *nimaga kirishni*
cheklaydi, *qancha yeyishni* emas. Xotira tugaganda Linux'ning OOM killer'i
qurbonni **o'zi tanlaydi** — u PostgreSQL'ni yoki to'lov botini olishi
mumkin. Ya'ni kod yozish paytidagi xato mijozlarga xizmat qiladigan
botlarni yiqitishi mumkin edi.

## Uch qatlamli yechim

### 1. systemd cgroup (eng muhimi — kodsiz)

`deploy/systemd-limits.conf` faylida. Butun daraxtni qamrab oladi:
veb-server + uning PM2 botlari + barcha `claude` subprocesslari.

⚠️ **Avval VPS resursini tekshiring:**

```bash
free -h     # umumiy RAM
nproc       # yadrolar soni
```

Fayldagi standart qiymatlar **8 GB / 4 yadro** uchun. Boshqacha bo'lsa
fayl ichidagi jadvalga qarang.

```bash
# claudeuz (allaqachon alohida systemd xizmati — eng oson)
sudo mkdir -p /etc/systemd/system/pm2-claudeweb.service.d
sudo cp deploy/systemd-limits.conf /etc/systemd/system/pm2-claudeweb.service.d/limits.conf
sudo systemctl daemon-reload
sudo systemctl restart pm2-claudeweb

# tekshirish
systemctl show pm2-claudeweb -p MemoryMax -p CPUQuota -p TasksMax
systemctl status pm2-claudeweb | grep Memory
```

**rootweb uchun eslatma:** u root'ning umumiy PM2 daemonida ishlaydi, ya'ni
`pm2-root.service` ga cheklov qo'yilsa u **barcha 26 ta botga** tegadi.
Bu ham foydali (VPS'ni himoya qiladi), lekin agar faqat rootweb'ni
cheklamoqchi bo'lsangiz, uni alohida systemd xizmatiga chiqarish kerak.

### 2. Ilova ichidagi cheklov (kodda, allaqachon qo'shilgan)

`server/config.js`:

| Sozlama | Standart | Nima qiladi |
|---|---|---|
| `MAX_SESSIONS` | 3 | Bir vaqtda ochiq Claude sessiyalari. Oshsa eng uzoq ishlatilmagani yopiladi. |
| `SESSION_IDLE_MINUTES` | 45 | Shuncha vaqt ishlatilmagan sessiya yopiladi. |

Ikkalasida ham **suhbat yo'qolmaydi** — tarix diskda (`sessions_meta.json`)
qoladi va keyingi ochilishda tiklanadi. Faqat subprocess xotiradan bo'shaydi.

⚠️ **Ish bajarayotgan sessiya hech qachon yopilmaydi** — Claude o'rtada
to'xtab qolsa foydalanuvchi ishi yo'qolardi.

`.env` orqali o'zgartiriladi:

```
MAX_SESSIONS=2
SESSION_IDLE_MINUTES=30
```

### 3. PM2 `max_memory_restart` (har bot uchun)

Bot xotira oqizsa o'zi qayta ishga tushsin:

```bash
pm2 restart <bot> --max-memory-restart 300M
pm2 save
```

Yoki `ecosystem.config.js` da:

```js
{ name: 'poster-01', script: 'bot.js', max_memory_restart: '300M' }
```

O'lchangan holat: ko'p botlar 130-150 MB, eng kattasi `postyubor-bot`
270 MB va `zayafka-bot` 222 MB. `300M` ko'pchiligi uchun xavfsiz;
kattalariga alohida qiymat qo'ying.

## Disk

Disk to'lsa **hamma** yiqiladi (PostgreSQL yozolmaydi, loglar to'xtaydi).
Holat panelida disk foizi ko'rinadi. Kvota qo'yish uchun:

```bash
# uid 1001 (claudeweb) uchun 10 GB
sudo setquota -u claudeweb 9000000 10000000 0 0 /
```

Kvota faylsistemda yoqilgan bo'lishi kerak (`/etc/fstab` da `usrquota`).

## Tekshirish

Cheklov ishlayotganini ko'rish:

```bash
systemd-cgtop -1                  # jonli iste'mol
systemctl status pm2-claudeweb    # "Memory: X (max: Y)"
journalctl -u pm2-claudeweb | grep -i "memory\|killed"
```

Ilova darajasidagi cheklov audit-logda ko'rinadi:

```bash
grep -E "session_evicted|session_limit_exceeded" server/data/audit.log | tail
```
