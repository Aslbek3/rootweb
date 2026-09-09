// Umumiy UI poydevori: ustma-ust oynalar steki + dialoglar.
//
// Nega alohida fayl: `app.js` allaqachon 1700+ qator edi va bu yerdagi kod
// undan mustaqil — hech qanday chat/WS holatiga tayanmaydi. Modul tizimi
// (`type="module"`) ishlatilmadi, chunki loyihada build qadami yo'q va
// yuklanish tartibi `index.html`da aniq ko'rinib turgani ma'qul.
window.RW = window.RW || {};

(() => {
  // ---------------- ustma-ust oynalar (overlay) steki ----------------
  //
  // `display: standalone` PWA'da Android'ning "orqaga" tugmasi ochiq oynani
  // yopmasdan ILOVANI yopib yuborardi. Yechim: ochilgan har bir oyna
  // `history.pushState` bilan bitta yozuv qo'shadi, yopish esa har doim
  // `history.back()` orqali ketadi — shunda "orqaga", "yopish" tugmasi va
  // Escape bir xil yo'ldan boradi va brauzer tarixi ekrandagi holatga mos
  // qoladi.
  const overlayStack = [];

  function openOverlay(name, closeFn) {
    overlayStack.push({ name, close: closeFn });
    history.pushState({ rootwebOverlay: name }, '');
  }

  function requestCloseOverlay(name) {
    if (!overlayStack.length) return;
    if (name && !overlayStack.some((o) => o.name === name)) return;
    history.back();
  }

  function hasOverlay(name) {
    return overlayStack.some((o) => o.name === name);
  }

  window.addEventListener('popstate', () => {
    const top = overlayStack.pop();
    if (top) top.close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayStack.length) {
      e.preventDefault();
      history.back();
    }
  });

  // ---------------- dialoglar ----------------
  //
  // Native `confirm()`/`prompt()` o'rniga. Avval ular 6 joyda ishlatilardi:
  // mobil brauzerda xunuk ko'rinadi, ilovaning qolgan dizayniga umuman mos
  // emas, va `prompt()` ba'zi PWA kontekstlarida umuman ishlamaydi — ya'ni
  // fayl nomini o'zgartirish funksiyasi shunchaki ishlamay qolardi.

  let openDialogCount = 0;

  function buildDialog({ title, message, confirmText, cancelText, danger, input }) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'dialog-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('div');
    titleEl.className = 'dialog-title';
    titleEl.textContent = title || '';
    sheet.appendChild(titleEl);

    if (message) {
      const msgEl = document.createElement('div');
      msgEl.className = 'dialog-message';
      // Ko'p qatorli xabar (masalan "Fayllar O'ZGARMAYDI ...") saqlanadi.
      msgEl.textContent = message;
      sheet.appendChild(msgEl);
    }

    let inputEl = null;
    if (input) {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'dialog-input';
      inputEl.value = input.value || '';
      if (input.placeholder) inputEl.placeholder = input.placeholder;
      sheet.appendChild(inputEl);
    }

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'dialog-btn dialog-cancel';
    cancelBtn.textContent = cancelText || 'Bekor qilish';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = `dialog-btn dialog-ok${danger ? ' danger' : ''}`;
    okBtn.textContent = confirmText || 'Tasdiqlash';
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    sheet.appendChild(actions);

    overlay.appendChild(sheet);
    return { overlay, sheet, okBtn, cancelBtn, inputEl };
  }

  // Ichki umumiy dialog. `input` berilsa prompt, berilmasa confirm bo'ladi.
  function showDialog(opts) {
    return new Promise((resolve) => {
      const { overlay, sheet, okBtn, cancelBtn, inputEl } = buildDialog(opts);
      const name = `dialog-${++openDialogCount}`;
      let settled = false;

      // Fokusni dialog ichida ushlab turish (focus trap) — avval drawer va
      // modal oynalarda bu umuman yo'q edi.
      const focusables = () => sheet.querySelectorAll('button, input, textarea, [href]');
      function onKeydown(e) {
        if (e.key === 'Tab') {
          const items = Array.from(focusables());
          if (!items.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        } else if (e.key === 'Enter' && inputEl && document.activeElement === inputEl) {
          e.preventDefault();
          finish(true);
        }
      }

      function cleanup() {
        document.removeEventListener('keydown', onKeydown, true);
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 160);
      }

      // Yopilish `overlayStack` orqali ketadi, shunda Escape va "orqaga"
      // tugmasi ham dialogni yopadi.
      function settle(value) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      }

      function finish(ok) {
        if (settled) return;
        // `history.back()` -> popstate -> registered close -> settle
        pendingResult = ok ? (inputEl ? inputEl.value.trim() : true) : (inputEl ? null : false);
        requestCloseOverlay(name);
      }

      let pendingResult = inputEl ? null : false;

      okBtn.addEventListener('click', () => finish(true));
      cancelBtn.addEventListener('click', () => finish(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
      document.addEventListener('keydown', onKeydown, true);

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));

      openOverlay(name, () => settle(pendingResult));

      // Fokus: prompt bo'lsa maydonga, aks holda tasdiqlash tugmasiga.
      setTimeout(() => {
        if (inputEl) { inputEl.focus(); inputEl.select(); } else okBtn.focus();
      }, 40);
    });
  }

  // `confirm()` o'rnini bosadi. Promise<boolean> qaytaradi.
  function confirmDialog(opts) {
    return showDialog(typeof opts === 'string' ? { title: opts } : opts);
  }

  // `prompt()` o'rnini bosadi. Promise<string|null> qaytaradi
  // (bekor qilinsa yoki bo'sh qoldirilsa `null`).
  function promptDialog(opts) {
    return showDialog({ ...opts, input: { value: opts.value, placeholder: opts.placeholder } })
      .then((v) => (typeof v === 'string' && v ? v : null));
  }

  Object.assign(window.RW, {
    openOverlay,
    requestCloseOverlay,
    hasOverlay,
    confirmDialog,
    promptDialog,
  });
})();
