// Login formasi.
//
// Avval bu `login.html` ichida inline `<script>` edi va CSP uchun
// `script-src 'unsafe-inline'` talab qilardi — bu esa XSS himoyasining
// asosiy qismini bekor qiladi. Alohida faylga chiqarilgani uchun endi
// qat'iy `script-src 'self'` siyosati ishlaydi.
const form = document.getElementById('loginForm');
const errorMsg = document.getElementById('errorMsg');
const passwordInput = document.getElementById('password');
const submitBtn = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.textContent = '';
  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    if (res.ok) {
      window.location.href = '/';
      return;
    }
    const data = await res.json().catch(() => ({}));
    // 429 — ilovaning o'z urinish cheklovi (`server/auth.js`). Bu holatda
    // aniq xabar ko'rsatiladi, aks holda foydalanuvchi parolini noto'g'ri
    // deb o'ylab qayta-qayta urinaveradi.
    errorMsg.textContent = data.error || (res.status === 429
      ? "Juda ko'p urinish — biroz kuting"
      : "Parol noto'g'ri");
  } catch {
    errorMsg.textContent = 'Serverga ulanib bo\'lmadi';
  } finally {
    submitBtn.disabled = false;
  }
});
