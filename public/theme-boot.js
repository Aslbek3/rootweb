// Saqlangan mavzuni sahifa chizilishidan oldin qo'llaydi (FOUC'ga qarshi).
// Avval bu `index.html` ichida inline `<script>` edi — CSP'da `script-src`
// uchun 'unsafe-inline' talab qilardi, ya'ni XSS himoyasini sezilarli
// zaiflashtirardi. Alohida fayl sifatida `'self'` yetarli bo'ladi.
(function () {
  try {
    var t = localStorage.getItem('rootwebTheme');
    if (t && t !== 'claude') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    /* localStorage o'chirilgan bo'lishi mumkin — standart mavzu qoladi */
  }
})();
