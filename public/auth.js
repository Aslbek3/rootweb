// Claude hisobini ulash sahifasining mantiqi.
//
// ⚠️ Bu yerda HAQIQIY XSS bor edi. Avvalgi kod:
//
//     output.innerHTML = linkify(state.output || '');
//
// `state.output` — bu `claude auth login` jarayonining XOM terminal chiqishi
// (faqat ANSI kodlari tozalangan). HTML escaping umuman yo'q edi, ya'ni
// chiqishda `<img src=x onerror=...>` ko'rinishidagi matn paydo bo'lsa —
// xato xabari, URL yoki server javobi orqali — root huquqli origin ichida
// ixtiyoriy JS ishga tushardi. `linkify` ham xavfli edi: `<a href="${url}">`
// ichidagi qo'shtirnoq atributdan chiqib ketardi.
//
// Endi matn faqat `textContent` orqali qo'yiladi va havolalar DOM API bilan
// (createElement) yasaladi — satr sifatida HTML umuman qurilmaydi.

const startBtn = document.getElementById('startBtn');
const submitBtn = document.getElementById('submitBtn');
const codeInput = document.getElementById('codeInput');
const codeCard = document.getElementById('codeCard');
const linkArea = document.getElementById('linkArea');
const output = document.getElementById('output');
const statusMsg = document.getElementById('statusMsg');

let polling = null;

// Faqat http(s) havolalarni qabul qiladi — `javascript:` kabi sxemalar
// `<a href>` orqali kod ishga tushirishi mumkin edi.
function safeHttpUrl(raw) {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch {
    return null;
  }
}

// Matnni DOM tugunlariga aylantiradi: oddiy qismlar matn, URL'lar <a>.
// Hech qachon HTML satri qurilmaydi.
function renderLinkified(el, text) {
  el.textContent = '';
  const re = /https?:\/\/\S+/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const href = safeHttpUrl(m[0]);
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = m[0];
      el.appendChild(a);
    } else {
      el.appendChild(document.createTextNode(m[0]));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

function render(state) {
  const text = state.output || '';
  renderLinkified(output, text);
  output.scrollTop = output.scrollHeight;

  const urlMatch = text.match(/https?:\/\/\S+/);
  const href = urlMatch ? safeHttpUrl(urlMatch[0]) : null;
  if (href) {
    linkArea.textContent = '';
    const box = document.createElement('div');
    box.className = 'auth-link-box';
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = urlMatch[0];
    box.appendChild(a);
    linkArea.appendChild(box);
    codeCard.style.display = '';
  }

  if (state.done) {
    clearInterval(polling);
    polling = null;
    startBtn.disabled = false;
    submitBtn.disabled = true;
    codeInput.disabled = true;
    statusMsg.className = 'auth-status ' + (state.success ? 'ok' : 'err');
    statusMsg.textContent = state.success
      ? 'Muvaffaqiyatli ulandi!'
      : 'Xatolik yuz berdi (yuqoridagi output-ni ko\'ring)';
  } else if (state.running) {
    statusMsg.className = 'auth-status dim';
    statusMsg.textContent = 'Jarayon ishlamoqda…';
  }
}

async function poll() {
  try {
    const res = await fetch('/api/auth/status');
    render(await res.json());
  } catch {
    /* vaqtinchalik tarmoq uzilishi — keyingi poll'da qayta uriniladi */
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  output.textContent = '';
  linkArea.textContent = '';
  codeCard.style.display = 'none';
  submitBtn.disabled = false;
  codeInput.disabled = false;
  statusMsg.className = 'auth-status dim';
  statusMsg.textContent = 'Boshlanmoqda…';
  try {
    const res = await fetch('/api/auth/start', { method: 'POST' });
    render(await res.json());
  } catch {
    statusMsg.className = 'auth-status err';
    statusMsg.textContent = 'Serverga ulanib bo\'lmadi';
    startBtn.disabled = false;
    return;
  }
  clearInterval(polling);
  polling = setInterval(poll, 1500);
});

submitBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim();
  if (!code) return;
  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      statusMsg.className = 'auth-status err';
      statusMsg.textContent = data.error || 'Xatolik';
      submitBtn.disabled = false;
      return;
    }
    codeInput.value = '';
    setTimeout(poll, 500);
  } catch {
    statusMsg.className = 'auth-status err';
    statusMsg.textContent = 'Serverga ulanib bo\'lmadi';
    submitBtn.disabled = false;
  }
});

poll();
