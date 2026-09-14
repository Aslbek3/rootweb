# Resurs cheklovi — nega kerak va qanday qo'yiladi

**VPS:** 12 GB RAM, 6 vCPU, 200 GB SSD, 300 Mbit/s (Contabo Cloud VPS 6)

## Muammo

O'lchangan holat (2026-09-13, `/api/pm2/list` orqali):

| Nima | Xotira |
|---|---|
| 26 ta root PM2 boti | ~3.3 GB |
| 8 ta sandbox (claudeuz) boti | ~1.2 GB |
| PostgreSQL, nginx, tizim | ~0.5 GB |
| **Claude ishlamaganda band** | **~5.0 GB / 12 GB** |

Har bir ochiq Claude sessiyasi ustiga **300-400 MB** qo'shadi — bu alohida
`claude` subprocess. Bundan tashqari Claude `npm install`, build yoki test
ishga tushirishi mumkin, bular bir zumda 1 GB olishi mumkin.

**Hech qanday cheklov yo'q edi.** ACL izolyatsiyasi *nimaga kirishni*
cheklaydi, *qancha yeyishni* emas. Xotira tugaganda Linux'ning OOM killer'i
qurbonni **o'zi tanlaydi** — u PostgreSQL'ni yoki to'lov botini olishi
mumkin. Ya'ni kod yozish paytidagi xato mijozlarga xizmat qiladigan
botlarni yiqitishi mumkin edi.

12 GB — bu yetarli zaxira. Muammo hajmda emas, **taqsimot yo'qligida**.

## Uch qatlamli yechim

### 1. systemd cgroup (eng muhimi — kodsiz)

Butun daraxtni qamrab oladi: veb-server + uning PM2 botlari + barcha
`claude` subprocesslari. Chegaraga urilganda faqat o'sha cgroup
ta'sirlanadi.

| Daraxt | Xotira | Protsessor | Fayl |
|---|---|---|---|
| root (rootweb + 26 bot) | 6 GB | 4 yadro | `deploy/systemd-limits-root.conf` |
| sandbox (claudeuz + 8 bot) | 3 GB | 2 yadro | `deploy/systemd-limits-sandbox.conf` |
| tizim, PostgreSQL, nginx | ~3 GB | 1+ yadro | — |

Bitta yadro har doim tizimga qoladi — VPS band bo'lganda ham SSH bilan
kirish imkoni saqlanadi.

```bash
# claudeuz
sudo mkdir -p /etc/systemd/system/pm2-claudeweb.service.d
sudo cp deploy/systemd-limits-sandbox.conf \
        /etc/systemd/system/pm2-claudeweb.service.d/limits.conf

# root
sudo mkdir -p /etc/systemd/system/pm2-root.service.d
sudo cp deploy/systemd-limits-root.conf \
        /etc/systemd/system/pm2-root.service.d/limits.conf

sudo systemctl daemon-reload
sudo systemctl restart pm2-claudeweb
sudo systemctl restart pm2-root

# tekshirish
systemctl show pm2-claudeweb -p MemoryMax -p CPUQuota -p TasksMax
systemctl status pm2-claudeweb | grep Memory
```

**rootweb uchun eslatma:** u root'ning umumiy PM2 daemonida ishlaydi, ya'ni
cheklov 26 ta botga ham tegadi — ular bitta cgroup'da. Bu VPS uchun himoya
(OOM butun tizim bo'ylab emas, shu cgroup ichida ishlaydi), lekin
rootweb'ning sessiyasi ko'p xotira olsa o'sha cgroup ichidagi **bot**
o'ldirilishi mumkin. Butunlay ajratish uchun
`deploy/systemd-limits-root.conf` oxiridagi **B variant**ga qarang —
rootweb'ni alohida systemd xizmatiga chiqarish.

### 2. Ilova ichidagi cheklov (kodda, allaqachon ishlaydi)

`server/config.js`:

| Sozlama | root | sandbox | Nima qiladi |
|---|---|---|---|
| `MAX_SESSIONS` | 3 | 2 | Bir vaqtda ochiq Claude sessiyalari. Oshsa eng uzoq ishlatilmagani yopiladi. |
| `SESSION_IDLE_MINUTES` | 45 | 45 | Shuncha vaqt ishlatilmagan sessiya yopiladi. |

Ikkalasida ham **suhbat yo'qolmaydi** — tarix diskda (`sessions_meta.json`)
qoladi va keyingi ochilishda `resume` bilan tiklanadi. Faqat subprocess
xotiradan bo'shaydi.

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
# O'lchangan: ko'p botlar 130-150 MB
pm2 restart poster-01 --max-memory-restart 300M

# Eng kattalari alohida
pm2 restart postyubor-bot --max-memory-restart 400M   # hozir 270 MB
pm2 restart zayafka-bot   --max-memory-restart 400M   # hozir 222 MB
pm2 save
```

Yoki `ecosystem.config.js` da:

```js
{ name: 'poster-01', script: 'bot.js', max_memory_restart: '300M' }
```

⚠️ `zayafka-bot` da **139 ta restart** bor (boshqalarda 2-13) — bu
crash-loop alomati, xotira cheklovidan alohida tekshirish kerak:
`pm2 logs zayafka-bot --err`.

## Disk

200 GB dan hozir qancha bandligini holat panelida ko'rasiz. Disk to'lsa
**hamma** yiqiladi (PostgreSQL yozolmaydi, loglar to'xtaydi).

```bash
# uid 1001 (claudeweb) uchun 20 GB kvota
sudo setquota -u claudeweb 19000000 20000000 0 0 /
```

Kvota faylsistemda yoqilgan bo'lishi kerak (`/etc/fstab` da `usrquota`).
Yoqilmagan bo'lsa holat panelidagi disk foizi yetarli nazorat beradi.

## Tekshirish

```bash
systemd-cgtop -1                  # jonli iste'mol, cgroup bo'yicha
systemctl status pm2-claudeweb    # "Memory: X (max: Y)"
journalctl -u pm2-claudeweb | grep -i "memory\|killed"
free -h                           # umumiy holat
```

Ilova darajasidagi cheklov audit-logda:

```bash
grep -E "session_evicted|session_limit_exceeded" server/data/audit.log | tail
```
