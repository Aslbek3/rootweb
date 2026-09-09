// Saqlangan mavzuni sahifa chizilishidan oldin qo'llaydi (FOUC'ga qarshi).
// Alohida fayl, chunki inline `<script>` bo'lsa CSP'da `script-src` uchun
// 'unsafe-inline' talab qilinardi.
//
// `app.js`dagi `resolveTheme()` bilan bir xil mantiq: "system" qiymati
// OS sozlamasiga qarab hal qilinadi.
(function () {
  try {
    var t = localStorage.getItem('rootwebTheme') || 'claude';
    if (t === 'system') {
      t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'claude'
        : 'light';
    }
    if (t !== 'claude') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    /* localStorage o'chirilgan bo'lishi mumkin — standart mavzu qoladi */
  }
})();
