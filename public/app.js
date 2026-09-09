(() => {
  // Ustma-ust oynalar steki va dialoglar `ui-core.js`da (`window.RW`) —
  // "orqaga" tugmasi / Escape boshqaruvi shu yerdan keladi.
  const { openOverlay, requestCloseOverlay, confirmDialog, promptDialog } = window.RW;

  const messagesEl = document.getElementById('messages');
  const jumpBottomBtn = document.getElementById('jumpBottomBtn');
  const enterModeBtn = document.getElementById('enterModeBtn');
  const quickCmdsBtn = document.getElementById('quickCmdsBtn');
  const quickCmdsEl = document.getElementById('quickCmds');
  const projectSwitcher = document.getElementById('projectSwitcher');
  const searchBtn = document.getElementById('searchBtn');
  const searchBar = document.getElementById('searchBar');
  const searchInput = document.getElementById('searchInput');
  const searchCount = document.getElementById('searchCount');
  const searchPrev = document.getElementById('searchPrev');
  const searchNext = document.getElementById('searchNext');
  const searchClose = document.getElementById('searchClose');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsSheet = document.getElementById('settingsSheet');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsCloseBtn = document.getElementById('settingsCloseBtn');
  const themeValue = document.getElementById('themeValue');
  const notifyValue = document.getElementById('notifyValue');
  const notifyGroup = document.getElementById('notifyGroup');
  const form = document.getElementById('composer');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusDot = document.getElementById('statusDot');
  const cwdLabel = document.getElementById('cwdLabel');
  const logoutBtn = document.getElementById('logoutBtn');
  const clearChatBtn = document.getElementById('clearChatBtn');
  const modeBtn = document.getElementById('modeBtn');

  const themeBtn = document.getElementById('themeBtn');
  const notifyBtn = document.getElementById('notifyBtn');
  const filesBtn = document.getElementById('filesBtn');
  const filesBadge = document.getElementById('filesBadge');
  const drawer = document.getElementById('drawer');
  const drawerOverlay = document.getElementById('drawerOverlay');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const drawerTabs = document.querySelectorAll('.drawer-tab');
  const panelProjects = document.getElementById('panelProjects');
  const panelFiles = document.getElementById('panelFiles');
  const panelBots = document.getElementById('panelBots');
  const botListEl = document.getElementById('botList');
  const pm2StatusBadge = document.getElementById('pm2StatusBadge');
  const panelLimit = document.getElementById('panelLimit');
  const rateLimitStats = document.getElementById('rateLimitStats');
  const usageStats = document.getElementById('usageStats');
  const addProjectForm = document.getElementById('addProjectForm');
  const newProjectPathInput = document.getElementById('newProjectPath');
  const newProjectToggle = document.getElementById('newProjectToggle');
  const newProjectMetaToggle = document.getElementById('newProjectMetaToggle');
  const newProjectMetaFields = document.getElementById('newProjectMetaFields');
  const newProjectDescriptionInput = document.getElementById('newProjectDescription');
  const newProjectPm2NameInput = document.getElementById('newProjectPm2Name');
  const createProjectForm = document.getElementById('createProjectForm');
  const newProjectParentInput = document.getElementById('newProjectParent');
  const newProjectNameInput = document.getElementById('newProjectName');
  const projectListEl = document.getElementById('projectList');
  const fileBreadcrumbEl = document.getElementById('fileBreadcrumb');
  const gotoRootBtn = document.getElementById('gotoRootBtn');
  const fileTreeEl = document.getElementById('fileTree');
  const newFolderToggle = document.getElementById('newFolderToggle');
  const createFolderForm = document.getElementById('createFolderForm');
  const newFolderNameInput = document.getElementById('newFolderName');
  const uploadFileBtn = document.getElementById('uploadFileBtn');
  const uploadFileInput = document.getElementById('uploadFileInput');
  const uploadStatus = document.getElementById('uploadStatus');
  const fileDownloadBtn = document.getElementById('fileDownloadBtn');
  const fileViewerOverlay = document.getElementById('fileViewerOverlay');
  const fileViewer = document.getElementById('fileViewer');
  const fileViewerName = document.getElementById('fileViewerName');
  const fileViewerContent = document.getElementById('fileViewerContent');
  const fileViewerEditor = document.getElementById('fileViewerEditor');
  const fileEditBtn = document.getElementById('fileEditBtn');
  const fileSaveBtn = document.getElementById('fileSaveBtn');
  const fileViewerCloseBtn = document.getElementById('fileViewerCloseBtn');
  const attachmentRow = document.getElementById('attachmentRow');
  const composerFileInput = document.getElementById('composerFileInput');

  let ws = null;
  let botPollTimer = null;
  let activeProjectPm2Name = null;
  // Files/images picked in the composer, waiting to go out with the next
  // sent message. Images are inlined as base64 (Claude vision); other files
  // are uploaded into the active project as soon as they're picked, so only
  // their name needs to travel with the chat message.
  let pendingAttachments = [];
  let busy = false;
  let reconnectDelay = 1000;
  let typingEl = null;
  let projectsList = [];
  let activeProjectId = null;
  let currentDir = '.';
  // Non-null while browsing an absolute path outside the active loyiha/project
  // (e.g. via gotoRootBtn's "/root'ga o'tish"). Kept independent of
  // activeProjectId so jumping there never sends switch_project (Claude's
  // active conversation/session stays untouched).
  let browseRoot = null;
  let lastCwd = '';
  let isSwitching = false;
  let prevPending = new Map();
  let currentFilePath = null;
  let currentFileEditable = false;

  // ---------------- skroll boshqaruvi ----------------
  // Avval `scrollToBottom()` har bir xabarda SHARTSIZ chaqirilardi: Claude
  // yozayotganda yuqoriga chiqib biror narsani o'qimoqchi bo'lsangiz, keyingi
  // blok sizni pastga tortib tushirardi. Endi avtomatik skroll faqat
  // foydalanuvchi allaqachon pastda bo'lsa ishlaydi; aks holda pastda "↓"
  // tugmasi paydo bo'ladi.
  const STICK_THRESHOLD_PX = 80;
  let stickToBottom = true;

  function distanceFromBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  }

  function updateJumpButton() {
    if (!jumpBottomBtn) return;
    jumpBottomBtn.classList.toggle('hidden', stickToBottom);
  }

  messagesEl.addEventListener('scroll', () => {
    stickToBottom = distanceFromBottom() < STICK_THRESHOLD_PX;
    if (stickToBottom) jumpBottomBtn.classList.remove('unread');
    updateJumpButton();
  });

  // `force` — foydalanuvchining o'z amali (xabar yuborish, loyiha almashish,
  // tarixni qayta chizish) uchun: bunda skroll har doim pastga tushadi.
  function scrollToBottom(force) {
    if (force) {
      stickToBottom = true;
      jumpBottomBtn.classList.remove('unread');
    }
    if (!stickToBottom) {
      // Pastda emasmiz — yangi xabar kelganini "↓" tugmasida belgilaymiz.
      jumpBottomBtn.classList.add('unread');
      updateJumpButton();
      return;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    updateJumpButton();
  }

  if (jumpBottomBtn) {
    jumpBottomBtn.addEventListener('click', () => {
      messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
      stickToBottom = true;
      jumpBottomBtn.classList.remove('unread');
      updateJumpButton();
    });
  }

  // ---------------- nusxa olish ----------------
  // Telefonda `<pre>` ichidan matn belgilash juda noqulay, holbuki Claude
  // bergan buyruqni nusxalash — bu ilovadagi eng tez-tez qilinadigan
  // amallardan biri.
  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Eski brauzer yoki ruxsat berilmagan holat uchun zaxira usul.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* qo'lda nusxalash qoladi */ }
      ta.remove();
    }
    if (btn) {
      btn.classList.add('copied');
      btn.setAttribute('aria-label', 'Nusxalandi');
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.setAttribute('aria-label', 'Nusxa olish');
      }, 1400);
    }
  }

  const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg>'
    + '<svg class="copy-done" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function makeCopyBtn(getText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Nusxa olish');
    btn.title = 'Nusxa olish';
    btn.innerHTML = COPY_SVG;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(getText(), btn);
    });
    return btn;
  }

  // Xabar ichidagi har bir kod blokiga nusxa tugmasini qo'shadi.
  function attachCodeCopyButtons(container) {
    for (const pre of container.querySelectorAll('pre')) {
      if (pre.querySelector('.copy-btn')) continue;
      pre.classList.add('has-copy');
      pre.appendChild(makeCopyBtn(() => pre.querySelector('code')?.textContent || pre.textContent));
    }
  }

  // ⚠️ Qo'shtirnoqlar ham escape qilinadi. Avval faqat `& < >` almashtirilardi,
  // lekin funksiya ba'zi joyda ATRIBUT ichida ishlatilardi (masalan
  // `alt="${escapeHtml(att.name)}"`) — u yerda `"` atributdan chiqib ketib
  // XSS'ga yo'l ochardi. Matn konteksti uchun mo'ljallangan funksiyani atribut
  // kontekstida ishlatish — sinf darajasidagi xato, shuning uchun funksiyaning
  // o'zi ham to'liq qilindi.
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Minimal markdown: kod bloklari, inline kod, qalin, kursiv, sarlavhalar,
  // ro'yxatlar, xatboshi.
  //
  // Sarlavha (`## ...`) va ro'yxat (`- ...`) qo'llab-quvvatlanmagani uchun
  // Claude javoblarining katta qismi xom markdown bo'lib ko'rinardi; izohda
  // esa "italic" deyilgan bo'lsa-da, u ham amalga oshirilmagan edi.
  function renderInline(seg) {
    return seg
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Kursiv — `**qalin**`dan keyin qo'llanadi, shunda ular to'qnashmaydi.
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  // Bitta blokni (kod bloklari orasidagi matnni) HTML'ga aylantiradi.
  function renderBlock(text) {
    const lines = text.split('\n');
    let html = '';
    let listOpen = false;
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html += `<p>${renderInline(paragraph.join('<br>'))}</p>`;
      paragraph = [];
    };
    const closeList = () => {
      if (listOpen) { html += '</ul>'; listOpen = false; }
    };

    for (const line of lines) {
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      if (heading) {
        flushParagraph(); closeList();
        const level = Math.min(6, heading[1].length + 2); // ## -> h4, kichikroq ko'rinsin
        html += `<h${level}>${renderInline(heading[2])}</h${level}>`;
      } else if (bullet) {
        flushParagraph();
        if (!listOpen) { html += '<ul>'; listOpen = true; }
        html += `<li>${renderInline(bullet[1])}</li>`;
      } else if (!line.trim()) {
        flushParagraph(); closeList();
      } else {
        closeList();
        paragraph.push(line);
      }
    }
    flushParagraph();
    closeList();
    return html;
  }

  function renderMarkdown(raw) {
    const text = escapeHtml(raw);
    const parts = text.split(/```([\s\S]*?)```/g);
    let html = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        let block = parts[i];
        const firstLine = block.split('\n')[0];
        if (firstLine && !firstLine.includes(' ') && firstLine.length < 20) {
          block = block.slice(firstLine.length + 1);
        }
        html += `<pre><code>${block}</code></pre>`;
      } else {
        html += renderBlock(parts[i]);
      }
    }
    return html;
  }

  function addBubble(role, text, attachments) {
    const wrap = document.createElement('div');
    wrap.className = `line ${role}`;
    const marker = document.createElement('span');
    marker.className = 'marker';
    marker.textContent = role === 'user' ? '❯' : '·';
    const content = document.createElement('div');
    content.className = 'line-content';
    if (attachments && attachments.length) {
      const row = document.createElement('div');
      row.className = 'line-attachments';
      for (const att of attachments) {
        if (att.kind === 'image') {
          const img = document.createElement('img');
          img.src = att.previewUrl;
          img.alt = att.name;
          row.appendChild(img);
        } else {
          const tag = document.createElement('span');
          tag.className = 'tool-tag';
          tag.textContent = '📎 ' + att.name;
          row.appendChild(tag);
        }
      }
      content.appendChild(row);
    }
    const textEl = document.createElement('div');
    textEl.innerHTML = renderMarkdown(text);
    attachCodeCopyButtons(textEl);
    content.appendChild(textEl);
    wrap.appendChild(marker);
    wrap.appendChild(content);
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return content;
  }

  function addSystemNote(text) {
    const el = document.createElement('div');
    el.className = 'system-note';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
    return (bytes / 1024 / 1024).toFixed(1) + 'M';
  }

  const TOOL_TAGS = {
    Read: 'READ', Write: 'WRITE', Edit: 'EDIT', Bash: 'BASH', PowerShell: 'PS', Grep: 'GREP',
    Glob: 'GLOB', WebFetch: 'WEB', WebSearch: 'SEARCH', Task: 'TASK', TodoWrite: 'TODO'
  };

  function toolSummary(name, input) {
    input = input || {};
    if (name === 'Bash' || name === 'PowerShell') return input.description || input.command || '';
    if (name === 'Read' || name === 'Write' || name === 'Edit') return input.file_path || '';
    if (name === 'Grep') return input.pattern || '';
    if (name === 'Glob') return input.pattern || '';
    if (name === 'WebFetch' || name === 'WebSearch') return input.url || input.query || '';
    try { return JSON.stringify(input).slice(0, 200); } catch { return ''; }
  }

  function addToolCard(id, name, input) {
    input = input || {};
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.dataset.toolId = id;
    const tag = TOOL_TAGS[name] || name.toUpperCase();
    const summary = toolSummary(name, input);
    card.innerHTML = `<div class="tool-head"><span class="tool-tag">[${escapeHtml(tag)}]</span><span class="tool-summary"></span><span class="tool-status"></span></div>`;
    card.querySelector('.tool-summary').textContent = summary;
    // Buyruqning o'zidan nusxa olish — SSH'ga ko'chirish uchun eng tez yo'l.
    if (summary) card.querySelector('.tool-head').appendChild(makeCopyBtn(() => summary));
    messagesEl.appendChild(card);
    scrollToBottom();
    return card;
  }

  // Tool natijasi kelganda kartochkani belgilaydi VA chiqish bo'lsa uni
  // ochib-yopiladigan blok sifatida qo'shadi. Avval bu yerda faqat ✓/✗
  // qo'yilardi — xom chiqish klientga umuman kelmasdi.
  function markToolResult(id, isError, output, truncated, fullLength) {
    const card = messagesEl.querySelector(`.tool-card[data-tool-id="${CSS.escape(id)}"]`);
    if (!card) return;
    card.classList.add(isError ? 'error' : 'ok');
    const statusEl = card.querySelector('.tool-status');
    if (statusEl) statusEl.textContent = isError ? '✗' : '✓';
    if (!output || card.querySelector('.tool-output')) return;

    card.classList.add('expandable');
    const head = card.querySelector('.tool-head');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tool-toggle';
    const lineCount = output.split('\n').length;
    toggle.textContent = `natija (${lineCount} qator)`;
    toggle.setAttribute('aria-expanded', 'false');

    const outWrap = document.createElement('div');
    outWrap.className = 'tool-output hidden';
    const pre = document.createElement('pre');
    pre.textContent = output;
    outWrap.appendChild(pre);
    if (truncated) {
      const note = document.createElement('div');
      note.className = 'tool-output-note';
      note.textContent = fullLength
        ? `Chiqish qisqartirildi (to'liq hajmi ${fullLength.toLocaleString('uz-UZ')} belgi)`
        : 'Chiqish qisqartirildi';
      outWrap.appendChild(note);
    }
    outWrap.appendChild(makeCopyBtn(() => output));

    toggle.addEventListener('click', () => {
      const willShow = outWrap.classList.contains('hidden');
      outWrap.classList.toggle('hidden', !willShow);
      toggle.setAttribute('aria-expanded', String(willShow));
      toggle.classList.toggle('open', willShow);
      if (willShow) scrollToBottom();
    });

    head.appendChild(toggle);
    card.appendChild(outWrap);
  }

  // Ruxsat so'rovini texnik bo'lmagan odam ham tushunadigan qisqa jumlaga
  // aylantiradi. Xom `input` pastda "texnik tafsilot" sifatida baribir
  // ko'rinadi (pcmd-full) — bu shunchaki birinchi qatorni tushunarli qiladi.
  function describeToolCall(name, input) {
    input = input || {};
    switch (name) {
      case 'Bash':
      case 'PowerShell':
        // ⚠️ Avval bu yerda XOM BUYRUQ qaytarilardi
        // ("Terminal buyrug'i ishga tushiriladi: cd /x && git log --oneline...").
        // Dasturlashni bilmaydigan odam uchun bu hech narsa anglatmasdi, va
        // eng yomoni — kartochkaning eng ko'zga tashlanadigan joyini
        // egallardi, Claude'ning o'z tushuntirishi esa pastda, mayda
        // shriftda qolardi. Endi tushuntirish `explainBash()`dan keladi,
        // xom buyruq esa "texnik tafsilot" ostiga tushadi.
        return explainBash(input.command || '').title;
      case 'Edit': {
        const fname = (input.file_path || '').split(/[\\/]/).pop() || input.file_path || 'fayl';
        return `"${fname}" faylida o'zgartirish kiritiladi`;
      }
      case 'Write': {
        const fname = (input.file_path || '').split(/[\\/]/).pop() || input.file_path || 'fayl';
        return `"${fname}" fayli yaratiladi/qayta yoziladi`;
      }
      case 'NotebookEdit':
        return `"${input.notebook_path || 'notebook'}" tahrirlanadi`;
      case 'WebFetch':
        return `Veb-sahifa ochiladi: ${input.url || ''}`;
      case 'WebSearch':
        return `Internetdan qidiriladi: ${input.query || ''}`;
      default:
        return null;
    }
  }

  // `explainBash` va `RISK_LABEL` — `bash-explain.js` modulida
  // (DOM'ga bog'liq emas, shuning uchun test bilan qoplangan:
  // `test/bashExplain.test.js`).
  const { explainBash, RISK_LABEL } = window.RW;

  // Oddiy, kutubxonasiz qatorma-qator diff (Edit tool uchun old_string/
  // new_string). Katta o'zgarishlarda to'liq algoritm emas — faqat
  // qaysi qatorlar olib tashlangan/qo'shilganini vizual ko'rsatadi.
  function renderLineDiff(oldStr, newStr) {
    const oldLines = String(oldStr || '').split('\n');
    const newLines = String(newStr || '').split('\n');
    const wrap = document.createElement('div');
    wrap.className = 'diff-view';
    for (const line of oldLines) {
      const row = document.createElement('div');
      row.className = 'diff-line diff-del';
      row.textContent = '- ' + line;
      wrap.appendChild(row);
    }
    for (const line of newLines) {
      const row = document.createElement('div');
      row.className = 'diff-line diff-add';
      row.textContent = '+ ' + line;
      wrap.appendChild(row);
    }
    return wrap;
  }

  // Ruxsat kartochkasi — dasturlashni bilmaydigan odam uchun qayta qurildi.
  //
  // Avvalgi tartib teskari edi: eng ko'zga tashlanadigan qatorda XOM BUYRUQ
  // turardi (`cd /x && git log --oneline -10 2>/dev/null; echo "==="...`),
  // Claude'ning o'z tushuntirishi esa pastda, mayda mono shriftda qolardi.
  // Natijada "nimaga ruxsat berayotganimni bilmay qoldim" degan holat.
  //
  // Yangi tartib:
  //   1) xavf darajasi (rangli yorliq) — "faqat o'qiydi" / "xavfli" ...
  //   2) oddiy o'zbekcha tushuntirish  — `explainBash()`dan
  //   3) Claude nima demoqchi bo'lgani — tool'ning o'z `description`i
  //   4) xom buyruq — yopiq holda, "texnik tafsilot" ostida
  function addPermissionCard(reqId, name, input) {
    input = input || {};
    const card = document.createElement('div');
    const isBash = name === 'Bash' || name === 'PowerShell';
    const rawCommand = isBash ? (input.command || '') : (toolSummary(name, input) || '');
    const explained = isBash ? explainBash(rawCommand) : { risk: null, title: describeToolCall(name, input) };
    // Fayl yozish/tahrirlash uchun xavf darajasini o'zimiz belgilaymiz.
    const risk = explained.risk
      || (name === 'Write' || name === 'Edit' || name === 'NotebookEdit' ? 'write' : 'unknown');
    card.className = `permission-card risk-${risk}`;

    card.innerHTML = `
      <div class="ptitle">ruxsat kerak <span class="ptag">[${escapeHtml(name)}]</span></div>
      <div class="prisk"><span class="prisk-dot"></span><span class="prisk-text"></span></div>
      <div class="pfriendly"></div>
      <div class="pintent hidden"><span class="pintent-label">Claude nima qilmoqchi:</span> <span class="pintent-text"></span></div>
      <button type="button" class="pcmd-toggle">texnik tafsilot</button>
      <div class="pcmd-full hidden"><pre><code></code></pre></div>
      <div class="permission-diff-slot"></div>
      <div class="permission-actions">
        <button class="allow">Ruxsat berish</button>
        <button class="deny">Rad etish</button>
      </div>`;

    card.querySelector('.prisk-text').textContent = RISK_LABEL[risk] || RISK_LABEL.unknown;
    card.querySelector('.pfriendly').textContent = explained.title || 'Amal bajariladi';

    // Claude o'z `description`ini bergan bo'lsa uni ham ko'rsatamiz — u
    // ko'pincha kontekstni aniqroq aytadi ("Show git log of rootweb").
    if (isBash && input.description) {
      const intent = card.querySelector('.pintent');
      intent.classList.remove('hidden');
      intent.querySelector('.pintent-text').textContent = input.description;
    }

    // Xom buyruq — yopiq holda. Nusxa olish tugmasi ham shu yerda.
    const full = card.querySelector('.pcmd-full');
    const toggle = card.querySelector('.pcmd-toggle');
    if (rawCommand) {
      full.querySelector('code').textContent = rawCommand.slice(0, 4000);
      full.appendChild(makeCopyBtn(() => rawCommand));
      toggle.addEventListener('click', () => {
        const willShow = full.classList.contains('hidden');
        full.classList.toggle('hidden', !willShow);
        toggle.textContent = willShow ? 'yashirish' : 'texnik tafsilot';
        toggle.classList.toggle('open', willShow);
      });
    } else {
      toggle.remove();
      full.remove();
    }

    if (name === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
      card.querySelector('.permission-diff-slot').appendChild(renderLineDiff(input.old_string, input.new_string));
    }

    const respond = (approve) => {
      send({ type: 'permission', id: reqId, approve });
      const resolved = document.createElement('div');
      resolved.className = 'permission-resolved ' + (approve ? 'ok' : 'deny');
      resolved.innerHTML = `<span class="permission-resolved-icon">${approve ? '✓' : '✗'}</span><span class="tool-tag">[${escapeHtml(name)}]</span><span class="permission-resolved-text"></span>`;
      resolved.querySelector('.permission-resolved-text').textContent = explained.title || rawCommand.slice(0, 70);
      card.replaceWith(resolved);
    };
    card.querySelector('.allow').addEventListener('click', () => respond(true));
    card.querySelector('.deny').addEventListener('click', () => respond(false));
    messagesEl.appendChild(card);
    scrollToBottom();
  }

  // Claude's AskUserQuestion tool: 1-4 questions, each with 2-4 clickable
  // options plus an always-available free-text "Boshqa" fallback. The tool
  // call only resolves once every question in the batch has an answer.
  function addQuestionCard(reqId, questions) {
    const card = document.createElement('div');
    card.className = 'permission-card question-card';
    const answers = {};

    function trySubmit() {
      if (Object.keys(answers).length < questions.length) return;
      send({ type: 'question_answer', id: reqId, answers });
      const resolved = document.createElement('div');
      resolved.className = 'permission-resolved ok';
      resolved.innerHTML = '<span class="permission-resolved-icon">✓</span><span class="tool-tag">[Savol]</span><span class="permission-resolved-text"></span>';
      resolved.querySelector('.permission-resolved-text').textContent = Object.values(answers).join(' · ');
      card.replaceWith(resolved);
    }

    for (const q of questions) {
      const block = document.createElement('div');
      block.className = 'question-block';
      block.innerHTML = `<div class="ptitle"><span class="ptag"></span></div><div class="question-text"></div><div class="question-options"></div><div class="question-other-row"><input type="text" placeholder="Boshqa..."><button type="button"></button></div>`;
      block.querySelector('.ptag').textContent = q.header || '';
      block.querySelector('.question-text').textContent = q.question || '';
      const optsWrap = block.querySelector('.question-options');
      const otherInput = block.querySelector('.question-other-row input');
      const otherBtn = block.querySelector('.question-other-row button');
      otherBtn.textContent = q.multiSelect ? 'Tasdiqlash' : '→';
      const buttons = [];

      function lockQuestion() {
        buttons.forEach((b) => { b.disabled = true; });
        otherInput.disabled = true;
        otherBtn.disabled = true;
      }

      for (const opt of (q.options || [])) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'question-option';
        btn.innerHTML = '<span class="question-option-label"></span><span class="question-option-desc"></span>';
        btn.querySelector('.question-option-label').textContent = opt.label;
        btn.querySelector('.question-option-desc').textContent = opt.description || '';
        btn.addEventListener('click', () => {
          if (q.multiSelect) {
            btn.classList.toggle('selected');
            return;
          }
          btn.classList.add('selected');
          answers[q.question] = opt.label;
          lockQuestion();
          trySubmit();
        });
        buttons.push(btn);
        optsWrap.appendChild(btn);
      }

      const confirmQuestion = () => {
        const otherText = otherInput.value.trim();
        if (q.multiSelect) {
          const picked = buttons.filter((b) => b.classList.contains('selected'))
            .map((b) => b.querySelector('.question-option-label').textContent);
          if (otherText) picked.push(otherText);
          if (!picked.length) return;
          answers[q.question] = picked.join(', ');
        } else {
          if (!otherText) return;
          answers[q.question] = otherText;
        }
        lockQuestion();
        trySubmit();
      };
      otherBtn.addEventListener('click', confirmQuestion);
      otherInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); confirmQuestion(); }
      });

      card.appendChild(block);
    }

    messagesEl.appendChild(card);
    scrollToBottom();
  }

  function showTyping() {
    if (typingEl) return;
    typingEl = document.createElement('div');
    typingEl.className = 'typing';
    typingEl.innerHTML = '<span class="dim">generating</span><span class="cursor-blink">▋</span>';
    messagesEl.appendChild(typingEl);
    scrollToBottom();
  }

  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  function setBusy(v) {
    busy = v;
    // Yuborish tugmasi band holatda ham KO'RINADI. Avval u yashirilardi va
    // `submit` handleri ham `if (busy) return` bilan to'sib turardi — ya'ni
    // Claude ishlayotganda unga qo'shimcha ko'rsatma yozib bo'lmasdi.
    // Terminaldagi Claude Code'da esa bu mumkin: yozgan xabaringiz navbatga
    // tushadi va joriy navbat tugagach uzatiladi. Server tomonida navbat
    // (`messageQueue`) allaqachon bor edi — faqat interfeys to'sib turardi.
    sendBtn.style.display = 'flex';
    stopBtn.style.display = v ? 'flex' : 'none';
    input.placeholder = v ? "Qo'shimcha ko'rsatma yozing (navbatga tushadi)..." : 'Xabar yozing...';
    statusDot.className = 'status-dot ' + (v ? 'working' : (ws && ws.readyState === 1 ? 'connected' : ''));
    if (v) showTyping(); else hideTyping();
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.addEventListener('open', () => {
      reconnectDelay = 1000;
      statusDot.className = 'status-dot connected';
    });

    ws.addEventListener('close', () => {
      statusDot.className = 'status-dot';
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.6, 15000);
    });

    ws.addEventListener('error', () => ws.close());

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleMessage(msg);
    });
  }

  function handleMessage(msg, isReplay) {
    switch (msg.type) {
      case 'session_state': {
        cwdLabel.textContent = msg.cwd || '';
        lastCwd = msg.cwd || '';
        syncActiveProjectFromCwd(msg.cwd);
        setActiveMode(msg.permissionMode || 'default');
        setUsage(msg.usage);
        activeProjectPm2Name = msg.pm2Name || null;
        if (activeProjectPm2Name) loadBotList(); else pm2StatusBadge.classList.add('hidden');
        messagesEl.innerHTML = '';
        // DOM tozalandi — navbat kuzatuvi ham nolga tushadi, aks holda
        // mavjud bo'lmagan elementlarga ishora qilib qolardi.
        queuedIds.length = 0;
        hideTyping();
        for (const evt of msg.history || []) handleMessage(evt, true);
        setBusy(!!msg.busy);
        // Tarix qayta chizilgandan keyin har doim pastga tushamiz — bu
        // foydalanuvchining o'z amali (ulanish/loyiha almashish) natijasi.
        scrollToBottom(true);
        if (isSwitching) {
          addSystemNote("Loyiha almashtirildi: " + (msg.cwd || ''));
          isSwitching = false;
        }
        break;
      }
      case 'user_message': {
        const note = msg.imageCount ? ` [+${msg.imageCount} rasm]` : '';
        addBubble('user', (msg.text || '(ilova)') + note);
        break;
      }
      case 'assistant':
        hideTyping();
        addBubble('assistant', msg.text);
        break;
      case 'tool_use':
        hideTyping();
        addToolCard(msg.id, msg.name, msg.input);
        break;
      case 'tool_result':
        markToolResult(msg.id, msg.isError, msg.output, msg.truncated, msg.fullLength);
        break;
      case 'permission_request':
        hideTyping();
        addPermissionCard(msg.id, msg.name, msg.input);
        if (!isReplay && document.hidden) {
          notify('Ruxsat kerak', `[${msg.name}] ${toolSummary(msg.name, msg.input)}`.slice(0, 140));
        }
        break;
      case 'question_request':
        hideTyping();
        addQuestionCard(msg.id, msg.questions || []);
        if (!isReplay && document.hidden) {
          const first = (msg.questions && msg.questions[0]) || {};
          notify('Savol bor', first.question || 'Javob kerak');
        }
        break;
      case 'permission_mode':
        setActiveMode(msg.mode);
        break;
      case 'busy':
        setBusy(!!msg.value);
        break;
      case 'result': {
        // Bitta navbat tugadi. Navbatda kutayotgan xabar bo'lsa — endi
        // uning navbati keldi, ya'ni ish DAVOM etadi va "band" holatini
        // saqlab qolamiz. Aks holda ish tugadi.
        const stillWorking = releaseOldestQueued();
        setBusy(stillWorking);
        if (msg.isError) addSystemNote('⚠️ ' + (msg.message || 'Xatolik yuz berdi'));
        if (!isReplay && document.hidden && !stillWorking) {
          notify('Claude tugatdi', msg.isError ? (msg.message || 'Xatolik yuz berdi') : 'Vazifa yakunlandi');
        }
        break;
      }
      case 'usage_update':
        setUsage({ inputTokens: msg.inputTokens, outputTokens: msg.outputTokens, totalCostUsd: msg.totalCostUsd });
        break;
      case 'rate_limit_data':
        rateLimitState = msg.data;
        rateLimitLoaded = true;
        if (!panelLimit.classList.contains('hidden')) renderRateLimits();
        break;
      case 'error':
        setBusy(false);
        addSystemNote('⚠️ ' + msg.message);
        break;
      // Sessiya boshqa qurilmada tozalandi/o'chirildi. Avval bu xabar umuman
      // yo'q edi va bu tab o'lik sessiyaga bog'lanib qolardi: yuborilgan
      // xabarlar jimgina yo'qolar, "band" holati esa abadiy qotib qolardi.
      // Ulanishni yopamiz — mavjud avtomatik qayta ulanish (`close` handleri)
      // darhol yangi, to'g'ri holatni olib keladi.
      case 'session_invalidated':
        addSystemNote('Suhbat boshqa qurilmada tozalandi — qayta ulanmoqda…');
        setBusy(false);
        try { ws.close(); } catch { /* allaqachon yopilgan bo'lishi mumkin */ }
        break;
      case 'auth_error':
        window.location.href = '/login.html';
        break;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // ⚠️ `if (busy) return` OLIB TASHLANDI. Claude ishlayotgan paytda ham
    // xabar yuborish mumkin — u navbatga tushadi va joriy navbat tugagach
    // uzatiladi (terminaldagi Claude Code kabi). Bu qo'shimcha ko'rsatma
    // berish uchun kerak: "yo'q, u faylga tegma", "avval testni ishga tushir".
    const text = input.value.trim();
    if (!text && pendingAttachments.length === 0) return;
    if (pendingAttachments.some((a) => a.uploading)) {
      addSystemNote('⚠️ Fayl hali yuklanmoqda, kuting...');
      return;
    }
    const images = pendingAttachments.filter((a) => a.kind === 'image');
    const fileNames = pendingAttachments.filter((a) => a.kind === 'file').map((a) => a.uploadedName);
    let outgoingText = text;
    if (fileNames.length) {
      outgoingText += (text ? '\n\n' : '') + `[Ilova qilingan fayllar: ${fileNames.join(', ')}]`;
    }

    const msgId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const content = addBubble('user', text || '(ilova)', pendingAttachments);
    // Band bo'lsa xabar darhol uzatilmaydi — buni ochiq ko'rsatamiz, aks
    // holda foydalanuvchi "yubordimmi yo'qmi?" deb qoladi.
    if (busy) markQueued(content, msgId);
    scrollToBottom(true); // o'z xabaringizni yuborganda har doim pastga
    send({ type: 'chat', id: msgId, text: outgoingText, images: images.map((a) => ({ mediaType: a.mediaType, data: a.data })) });
    input.value = '';
    input.style.height = 'auto';
    pendingAttachments = [];
    renderAttachments();
    setBusy(true);
  });

  // ---------------- navbatdagi xabarlar ----------------
  //
  // Claude ishlayotgan paytda yuborilgan xabar darhol ishlanmaydi — joriy
  // navbat tugagach navbati keladi. Buni ochiq ko'rsatmasak foydalanuvchi
  // "yubordimmi yo'qmi?" deb qoladi.
  //
  // ⚠️ Navbat holatini SERVERDAN so'rash urinib ko'rilgan va tashlangan:
  // SDK xabarni oqimdan deyarli darhol o'z buferiga oladi (Claude uni
  // qachon ishlashidan qat'i nazar), ya'ni server "uzatildi" deb noto'g'ri
  // aytardi — sinovda `ikkinchi` xabar navbatda turgani holda "uzatildi"
  // deb belgilangan edi. Shuning uchun holat KLIENTDA, `result` (navbat
  // tugashi) chegarasi bo'yicha kuzatiladi.
  const queuedIds = [];

  function markQueued(contentEl, msgId) {
    const line = contentEl.closest('.line');
    if (!line) return;
    line.dataset.msgId = msgId;
    line.classList.add('queued');
    queuedIds.push(msgId);
    const tag = document.createElement('div');
    tag.className = 'queued-tag';
    tag.textContent = 'navbatda — Claude joriy ishni tugatgach o\'qiydi';
    contentEl.appendChild(tag);
  }

  // Bitta navbat tugadi: eng eski kutayotgan xabar endi ishlanmoqda.
  // `true` qaytarsa — hali navbatda xabar bor, ya'ni ish davom etadi.
  function releaseOldestQueued() {
    const msgId = queuedIds.shift();
    if (msgId) {
      const line = messagesEl.querySelector(`.line.queued[data-msg-id="${CSS.escape(msgId)}"]`);
      if (line) {
        line.classList.remove('queued');
        const tag = line.querySelector('.queued-tag');
        if (tag) tag.remove();
      }
    }
    return queuedIds.length > 0 || !!msgId;
  }

  // Enter yuboradimi yoki yangi qator qo'shadimi. Telefonda ko'p qatorli
  // matn yozish uchun har safar Shift+Enter bosish noqulay (virtual
  // klaviaturada Shift umuman ko'rinmasligi mumkin), shuning uchun bu
  // sozlama qo'shildi. Kompyuterda standart — Enter yuboradi.
  let enterSends = true;
  try {
    const saved = localStorage.getItem('rootwebEnterSends');
    if (saved !== null) enterSends = saved === '1';
    else enterSends = !window.matchMedia || !window.matchMedia('(pointer: coarse)').matches;
  } catch { /* standart qiymat qoladi */ }

  function setEnterSends(v) {
    enterSends = v;
    try { localStorage.setItem('rootwebEnterSends', v ? '1' : '0'); } catch { /* noop */ }
    if (enterModeBtn) {
      enterModeBtn.textContent = v ? 'Enter ⏎' : 'Enter ↵';
      enterModeBtn.classList.toggle('on', v);
      const label = v ? 'Enter yuboradi (bosib almashtiring)' : 'Enter yangi qator (bosib almashtiring)';
      enterModeBtn.title = label;
      enterModeBtn.setAttribute('aria-label', label);
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (enterSends) {
        e.preventDefault();
        form.requestSubmit();
      }
      // enterSends=false bo'lsa Enter odatdagidek yangi qator qo'shadi
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      // Ctrl/Cmd+Enter har doim yuboradi — rejimdan qat'i nazar
      e.preventDefault();
      form.requestSubmit();
    } else if (e.key === 'Tab' && e.shiftKey) {
      // Claude Code CLI konvensiyasi: Shift+Tab ruxsat rejimini almashtiradi.
      // Faqat yozish maydoni fokusda bo'lganda ishlaydi, shuning uchun
      // boshqa joydagi odatdagi Shift+Tab fokus-navigatsiyasiga tegmaydi.
      e.preventDefault();
      cyclePermissionMode();
    }
  });

  // Maksimal balandlik 120px edi — telefonda ~4 qator, ya'ni uzunroq prompt
  // yozayotganda yozganingizni ko'rmasdingiz. Endi ekran balandligining
  // 40% igacha o'sadi.
  function autoGrowInput() {
    input.style.height = 'auto';
    const max = Math.max(120, Math.round(window.innerHeight * 0.4));
    input.style.height = Math.min(input.scrollHeight, max) + 'px';
  }

  input.addEventListener('input', autoGrowInput);
  window.addEventListener('resize', autoGrowInput);

  enterModeBtn.addEventListener('click', () => setEnterSends(!enterSends));
  setEnterSends(enterSends);

  stopBtn.addEventListener('click', () => {
    send({ type: 'stop' });
  });

  clearChatBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Chatni tozalash',
      message: "Suhbat tarixi butunlay o'chadi va qaytarib bo'lmaydi. Claude ham bu suhbatni eslamaydi.",
      confirmText: 'Tozalash',
      danger: true,
    });
    if (!ok) return;
    send({ type: 'clear_chat' });
  });

  logoutBtn.addEventListener('click', async () => {
    // Tasdiq so'raymiz, chunki chiqish endi BARCHA qurilmalardagi
    // sessiyalarni bekor qiladi (serverdagi `sessionVersion` oshadi) —
    // telefondan bosilsa kompyuterdagi ochiq tab ham chiqib ketadi.
    const ok = await confirmDialog({
      title: 'Chiqish',
      message: "Barcha qurilmalardagi sessiyalar tugaydi — boshqa telefon yoki kompyuterda ochiq bo'lsa, ular ham qaytadan parol so'raydi.",
      confirmText: 'Chiqish',
      danger: true,
    });
    if (!ok) return;
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // ---------------- mavzu (tizim / claude / qora / yorug') ----------------
  // "tizim" varianti qo'shildi: telefon kechqurun avtomatik qorong'i rejimga
  // o'tsa, ilova ham o'tadi. Avval faqat 3 ta qo'lda tanlanadigan mavzu bor
  // edi va `prefers-color-scheme` umuman ishlatilmasdi.
  const THEME_ORDER = ['system', 'claude', 'black', 'light'];
  const THEME_LABEL = { system: 'Tizim', claude: 'Claude', black: "Qora", light: "Yorug'" };
  const THEME_COLOR = { claude: '#262624', black: '#050505', light: '#faf9f5' };
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  // "tizim" tanlanganda haqiqiy mavzuni OS sozlamasidan olamiz.
  function resolveTheme(theme) {
    if (theme !== 'system') return theme;
    return darkMq && darkMq.matches ? 'claude' : 'light';
  }

  function applyTheme(theme) {
    const effective = resolveTheme(theme);
    if (effective === 'claude') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', effective);
    if (themeMeta) themeMeta.setAttribute('content', THEME_COLOR[effective] || THEME_COLOR.claude);
    themeBtn.title = `Mavzu: ${THEME_LABEL[theme]} (bosib almashtiring)`;
    // Sozlamalar panelida joriy qiymat matn bilan ko'rsatiladi (avval bu
    // topbar'dagi ikonka edi va qaysi mavzu tanlanganini bilib bo'lmasdi).
    if (themeValue) themeValue.textContent = THEME_LABEL[theme] || theme;
    try { localStorage.setItem('rootwebTheme', theme); } catch { /* xotira o'chirilgan bo'lishi mumkin */ }
  }

  function currentThemeSetting() {
    try { return localStorage.getItem('rootwebTheme') || 'claude'; } catch { return 'claude'; }
  }

  themeBtn.addEventListener('click', () => {
    const current = currentThemeSetting();
    const idx = THEME_ORDER.indexOf(current);
    applyTheme(THEME_ORDER[(idx + 1) % THEME_ORDER.length]);
  });

  // OS mavzusi o'zgarsa, "tizim" rejimida darhol ergashamiz.
  if (darkMq && darkMq.addEventListener) {
    darkMq.addEventListener('change', () => {
      if (currentThemeSetting() === 'system') applyTheme('system');
    });
  }

  applyTheme(currentThemeSetting());

  // ---------------- foydalanish statistikasi (usage) ----------------
  let usageState = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };

  function setUsage(u) {
    if (!u) return;
    usageState = {
      inputTokens: u.inputTokens || 0,
      outputTokens: u.outputTokens || 0,
      totalCostUsd: u.totalCostUsd || 0,
    };
    if (!panelLimit.classList.contains('hidden')) renderUsagePanel();
  }

  function renderUsagePanel() {
    usageStats.innerHTML = `
      <div class="usage-stats-title">Foydalanish (joriy sessiya)</div>
      <div class="usage-row"><span>Kirish</span><span>${usageState.inputTokens.toLocaleString('uz-UZ')}</span></div>
      <div class="usage-row"><span>Chiqish</span><span>${usageState.outputTokens.toLocaleString('uz-UZ')}</span></div>
      <div class="usage-row"><span>Xarajat</span><span>$${usageState.totalCostUsd.toFixed(4)}</span></div>
    `;
  }

  // Claude ilovasidagi kabi 5-soatlik/haftalik limit foizi — SDK'ning
  // eksperimental "/usage" metodidan (server orqali) olinadi, panel
  // ochilganda so'raladi (doimiy poll qilinmaydi).
  let rateLimitState = null;
  let rateLimitLoaded = false;

  function formatResetTime(iso) {
    if (!iso) return '';
    const target = new Date(iso).getTime();
    if (Number.isNaN(target)) return '';
    const diffMs = target - Date.now();
    if (diffMs <= 0) return 'tez orada tiklanadi';
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `${mins} daqiqadan keyin tiklanadi`;
    const hours = Math.floor(mins / 60);
    const restMins = mins % 60;
    if (hours < 24) return `${hours}s ${restMins}d dan keyin tiklanadi`;
    const days = Math.floor(hours / 24);
    return `${days} kundan keyin tiklanadi`;
  }

  function rateLimitBar(name, info) {
    if (!info || typeof info.utilization !== 'number') {
      return `<div class="rl-row"><div class="rl-label-row"><span class="rl-name">${name}</span><span class="rl-pct">—</span></div></div>`;
    }
    const pct = Math.max(0, Math.min(100, Math.round(info.utilization)));
    const tier = pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : '';
    return `
      <div class="rl-row">
        <div class="rl-label-row"><span class="rl-name">${name}</span><span class="rl-pct">${pct}%</span></div>
        <div class="rl-track"><div class="rl-fill ${tier}" style="width:${pct}%"></div></div>
        <div class="rl-reset">${formatResetTime(info.resets_at)}</div>
      </div>`;
  }

  function renderRateLimits() {
    if (!rateLimitLoaded) {
      rateLimitStats.innerHTML = '<div class="empty-hint">Yuklanmoqda…</div>';
      return;
    }
    if (!rateLimitState || !rateLimitState.rate_limits_available) {
      rateLimitStats.innerHTML = '<div class="empty-hint">Bu hisob turi uchun limit ma\'lumoti mavjud emas.</div>';
      return;
    }
    const rl = rateLimitState.rate_limits || {};
    const plan = rateLimitState.subscription_type ? rateLimitState.subscription_type.toUpperCase() : '';
    rateLimitStats.innerHTML = `
      ${plan ? `<div class="rl-plan">Reja: ${plan}</div>` : ''}
      ${rateLimitBar('5 soatlik', rl.five_hour)}
      ${rateLimitBar('Haftalik', rl.seven_day)}
    `;
  }

  // ---------------- bildirishnomalar ----------------
  // Brauzer berilgan Notification ruxsatini JS orqali qaytarib bo'lmaydi -
  // shuning uchun "o'chirish" ilova darajasidagi alohida on/off holat.
  let notifyMuted = localStorage.getItem('notifyMuted') === '1';

  function updateNotifyBtn() {
    // Brauzer bildirishnomani qo'llab-quvvatlamasa butun BO'LIMNI
    // yashiramiz (avval faqat ikonka yashirilardi va sozlamalarda bo'sh
    // sarlavha qolib ketardi).
    if (!('Notification' in window)) {
      if (notifyGroup) notifyGroup.classList.add('hidden');
      return;
    }
    const active = Notification.permission === 'granted' && !notifyMuted;
    const blocked = Notification.permission === 'denied';
    notifyBtn.classList.toggle('on', active);
    notifyBtn.classList.toggle('off', !active);
    const label = blocked
      ? 'Brauzerda bloklangan'
      : (active ? 'Yoqilgan' : "O'chirilgan");
    if (notifyValue) {
      notifyValue.textContent = label;
      notifyValue.classList.toggle('on', active);
    }
    notifyBtn.title = `Bildirishnomalar: ${label}`;
    notifyBtn.setAttribute('aria-label', `Bildirishnomalar: ${label}`);
  }

  notifyBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') {
      addSystemNote("Bildirishnoma bloklangan — brauzer sozlamalaridan yoqing.");
    } else if (Notification.permission === 'default') {
      await Notification.requestPermission();
      notifyMuted = false;
    } else {
      notifyMuted = !notifyMuted;
      localStorage.setItem('notifyMuted', notifyMuted ? '1' : '0');
    }
    updateNotifyBtn();
  });

  function notify(title, body, onClick) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || notifyMuted) return;
    try {
      const n = new Notification(title, { body, icon: '/icon.svg' });
      n.onclick = () => {
        window.focus();
        if (onClick) onClick();
        n.close();
      };
    } catch { /* some browsers throw if unsupported in this context */ }
  }

  updateNotifyBtn();


  // ---------------- sozlamalar paneli ----------------
  // Mavzu, bildirishnoma, hisob ulash va chiqish shu yerga ko'chirildi —
  // topbar'da 7 ta ikonka bor edi va telefonda ular bir-biriga tiqilib
  // ketardi. Endi topbar'da 4 ta: qidiruv, chatni tozalash, fayllar,
  // sozlamalar.

  function openSettings() {
    if (settingsSheet.classList.contains('open')) return;
    settingsSheet.classList.add('open');
    settingsOverlay.classList.remove('hidden');
    requestAnimationFrame(() => settingsOverlay.classList.add('show'));
    settingsBtn.setAttribute('aria-expanded', 'true');
    openOverlay('settings', doCloseSettings);
  }

  function doCloseSettings() {
    settingsSheet.classList.remove('open');
    settingsOverlay.classList.remove('show');
    setTimeout(() => settingsOverlay.classList.add('hidden'), 180);
    settingsBtn.setAttribute('aria-expanded', 'false');
  }

  function closeSettings() {
    requestCloseOverlay('settings');
  }

  settingsBtn.addEventListener('click', openSettings);
  settingsCloseBtn.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', closeSettings);

  // ---------------- drawer: loyihalar & fayllar ----------------

  function openDrawer() {
    if (drawer.classList.contains('open')) return;
    drawer.classList.add('open');
    drawerOverlay.classList.remove('hidden');
    requestAnimationFrame(() => drawerOverlay.classList.add('show'));
    openOverlay('drawer', doCloseDrawer);
    // "botlar" tabi ochiq qolgan bo'lsa so'rovlarni qayta boshlaymiz —
    // `doCloseDrawer` ularni to'xtatadi (yopiq drawer uchun har 12 soniyada
    // so'rov yuborish keraksiz edi).
    const activeTab = drawer.querySelector('.drawer-tab.active');
    if (activeTab && activeTab.dataset.tab === 'bots') {
      loadBotList();
      startBotPolling();
    }
  }

  // Haqiqiy yopish — faqat `popstate` orqali chaqiriladi.
  function doCloseDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('show');
    setTimeout(() => drawerOverlay.classList.add('hidden'), 180);
    stopBotPolling();
  }

  function closeDrawer() {
    requestCloseOverlay('drawer');
  }

  filesBtn.addEventListener('click', () => {
    openDrawer();
    fetchProjects();
  });
  drawerCloseBtn.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  // ---------------- composer attachments (rasm / fayl biriktirish) ----------------

  const attachBtn = document.getElementById('attachBtn');
  attachBtn.addEventListener('click', () => composerFileInput.click());

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("fayl o'qilmadi"));
      reader.readAsDataURL(file);
    });
  }

  function renderAttachments() {
    attachmentRow.classList.toggle('hidden', pendingAttachments.length === 0);
    attachmentRow.innerHTML = '';
    for (const att of pendingAttachments) {
      const chip = document.createElement('div');
      chip.className = `attachment-chip ${att.kind}${att.uploading ? ' uploading' : ''}`;
      if (att.kind === 'image') {
        // Rasm DOM API bilan yasaladi, satr sifatida emas: avval fayl nomi
        // `alt="..."` atributiga escape'siz (qo'shtirnoqsiz) qo'yilardi va
        // `x" onerror="..."` nomli fayl kod ishga tushirardi.
        const img = document.createElement('img');
        img.src = att.previewUrl;
        img.alt = att.name;
        chip.appendChild(img);
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'attachment-remove';
        rm.setAttribute('aria-label', "O'chirish");
        rm.innerHTML = '&times;';
        chip.appendChild(rm);
      } else {
        chip.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg><span class="attachment-file-name"></span><button type="button" class="attachment-remove" aria-label="O'chirish">&times;</button>`;
        chip.querySelector('.attachment-file-name').textContent = att.uploading ? `${att.name}…` : att.name;
      }
      chip.querySelector('.attachment-remove').addEventListener('click', () => {
        pendingAttachments = pendingAttachments.filter((a) => a.id !== att.id);
        renderAttachments();
      });
      attachmentRow.appendChild(chip);
    }
  }

  async function addImageAttachment(file) {
    if (file.size > 5 * 1024 * 1024) {
      addSystemNote(`⚠️ "${file.name}" juda katta (rasm 5MB dan oshmasin)`);
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    pendingAttachments.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: 'image',
      name: file.name,
      mediaType: file.type || 'image/png',
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      previewUrl: dataUrl,
    });
    renderAttachments();
  }

  async function addFileAttachment(file) {
    if (!activeProjectId) {
      addSystemNote('⚠️ Avval loyiha yuklanishini kuting');
      return;
    }
    const att = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: 'file',
      name: file.name,
      uploading: true,
    };
    pendingAttachments.push(att);
    renderAttachments();
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/files/upload?projectId=${encodeURIComponent(activeProjectId)}&dir=.`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Yuklashda xatolik');
      att.uploading = false;
      att.uploadedName = data.name;
    } catch (err) {
      pendingAttachments = pendingAttachments.filter((a) => a.id !== att.id);
      addSystemNote(`⚠️ "${file.name}" yuklanmadi: ${err.message}`);
    }
    renderAttachments();
  }

  composerFileInput.addEventListener('change', async () => {
    const files = Array.from(composerFileInput.files || []);
    composerFileInput.value = '';
    for (const file of files) {
      if (file.type.startsWith('image/')) await addImageAttachment(file);
      else await addFileAttachment(file);
    }
  });

  // Ctrl+V bilan rasm/fayl joylash — faqat clipboard'da haqiqiy fayl bo'lsa
  // ushlab qolinadi, oddiy matn joylash odatdagidek ishlayveradi.
  input.addEventListener('paste', (e) => {
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const fileItems = items.filter((it) => it.kind === 'file');
    if (!fileItems.length) return;
    e.preventDefault();
    for (const it of fileItems) {
      const file = it.getAsFile();
      if (!file) continue;
      if (file.type.startsWith('image/')) addImageAttachment(file);
      else addFileAttachment(file);
    }
  });

  const MODE_ORDER = ['default', 'plan', 'acceptEdits'];
  const MODE_LABEL = { default: 'Manual', plan: 'Plan', acceptEdits: 'Avto' };
  function setActiveMode(mode) {
    modeBtn.dataset.mode = mode;
    modeBtn.textContent = MODE_LABEL[mode] || mode;
  }
  function cyclePermissionMode() {
    const idx = MODE_ORDER.indexOf(modeBtn.dataset.mode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    send({ type: 'set_permission_mode', mode: next });
  }
  modeBtn.addEventListener('click', cyclePermissionMode);

  drawerTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      drawerTabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      panelProjects.classList.toggle('hidden', tab !== 'projects');
      panelFiles.classList.toggle('hidden', tab !== 'files');
      panelBots.classList.toggle('hidden', tab !== 'bots');
      panelLimit.classList.toggle('hidden', tab !== 'limit');
      if (tab === 'files') { currentDir = '.'; loadFiles(); }
      if (tab === 'bots') { loadBotList(); startBotPolling(); } else { stopBotPolling(); }
      if (tab === 'limit') {
        renderUsagePanel();
        renderRateLimits();
        send({ type: 'get_rate_limits' });
      }
    });
  });

  // Ro'yxatning ko'rinishga ta'sir qiluvchi "barmoq izi". Har 5 soniyada
  // kelayotgan bir xil javob uchun DOM'ni qayta qurmaslik uchun ishlatiladi —
  // avval drawer ochiq turganda ham ro'yxat har 5 soniyada butunlay
  // qayta yaratilardi (bosish paytida element almashib ketishi mumkin edi).
  let lastProjectsSignature = '';

  async function fetchProjects() {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      projectsList = data.projects || [];
      const signature = JSON.stringify(projectsList.map((p) => [p.id, p.label, p.path, p.busy, p.pending]))
        + `|${activeProjectId}`;
      if (signature !== lastProjectsSignature) {
        lastProjectsSignature = signature;
        renderProjectList();
      }
      updateStatusBadges();
    } catch { /* offline - leave list as-is */ }
  }

  function updateStatusBadges() {
    let anyPending = false;
    let anyBusy = false;
    for (const p of projectsList) {
      const wasPending = prevPending.get(p.id) || 0;
      if (p.pending > wasPending && p.id !== activeProjectId) {
        notify(`${p.label}: ruxsat kerak`, p.path, () => {
          if (p.id !== activeProjectId) selectProject(p);
        });
      }
      prevPending.set(p.id, p.pending || 0);
      if (p.pending > 0) anyPending = true;
      else if (p.busy) anyBusy = true;
    }
    filesBadge.classList.toggle('hidden', !anyPending && !anyBusy);
    filesBadge.classList.toggle('pending', anyPending);
  }

  function renderProjectList() {
    projectListEl.innerHTML = '';
    if (!projectsList.length) {
      projectListEl.innerHTML = '<div class="empty-hint">Hali loyiha qo\'shilmagan.</div>';
      return;
    }
    for (const p of projectsList) {
      const row = document.createElement('div');
      row.className = 'project-row' + (p.id === activeProjectId ? ' active' : '');
      const info = document.createElement('div');
      info.className = 'project-info';
      const badge = p.pending > 0
        ? '<span class="row-badge pending">ruxsat!</span>'
        : (p.busy ? '<span class="row-badge busy">band</span>' : '');
      info.innerHTML = `<div class="project-label"><span class="project-label-text"></span>${badge}</div><div class="project-path"></div>`;
      info.querySelector('.project-label-text').textContent = p.label;
      info.querySelector('.project-path').textContent = p.path;
      info.addEventListener('click', () => selectProject(p));
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn project-del';
      delBtn.title = "O'chirish";
      delBtn.setAttribute('aria-label', "O'chirish");
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/><path d="M10 11v6M14 11v6"/></svg>';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog({
          title: `"${p.label}" loyihasini o'chirish`,
          message: "Fayllar va PM2'dagi tegishli bot/xizmat O'ZGARMAYDI — faqat shu ro'yxatdan va chat tarixi o'chadi.",
          confirmText: "Ro'yxatdan o'chirish",
          danger: true,
        });
        if (!ok) return;
        await fetch(`/api/projects/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
        fetchProjects();
      });
      row.appendChild(info);
      row.appendChild(delBtn);
      projectListEl.appendChild(row);
    }
  }

  function selectProject(p) {
    const sameProject = p.id === activeProjectId;
    if (sameProject && !browseRoot) { closeDrawer(); return; }
    browseRoot = null;
    activeProjectId = p.id;
    if (sameProject) {
      // Loyihaning o'zi allaqachon faol, faqat boshqa (browseRoot) yo'ldan
      // qaytilyapti — switch_project shart emas, shunchaki fayllar
      // ko'rinishini qayta yuklash yetarli.
      currentDir = '.';
      loadFiles();
    } else {
      isSwitching = true;
      send({ type: 'switch_project', id: p.id });
    }
    renderProjectList();
    closeDrawer();
  }

  function syncActiveProjectFromCwd(cwd) {
    const match = projectsList.find((p) => p.path === cwd);
    if (match) {
      activeProjectId = match.id;
      renderProjectList();
    }
  }

  newProjectMetaToggle.addEventListener('click', () => {
    newProjectMetaFields.classList.toggle('hidden');
  });

  addProjectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pathVal = newProjectPathInput.value.trim();
    if (!pathVal) return;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: pathVal,
          description: newProjectDescriptionInput.value.trim(),
          pm2Name: newProjectPm2NameInput.value.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { addSystemNote('⚠️ ' + (data.error || 'Xatolik')); return; }
      newProjectPathInput.value = '';
      newProjectDescriptionInput.value = '';
      newProjectPm2NameInput.value = '';
      newProjectMetaFields.classList.add('hidden');
      await fetchProjects();
      selectProject(data.project);
    } catch {
      addSystemNote('⚠️ Serverga ulanib bo\'lmadi');
    }
  });

  newProjectToggle.addEventListener('click', () => {
    const willShow = createProjectForm.classList.contains('hidden');
    createProjectForm.classList.toggle('hidden');
    if (willShow && !newProjectParentInput.value && lastCwd) {
      const idx = Math.max(lastCwd.lastIndexOf('\\'), lastCwd.lastIndexOf('/'));
      if (idx > 0) newProjectParentInput.value = lastCwd.slice(0, idx);
    }
  });

  createProjectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parent = newProjectParentInput.value.trim();
    const name = newProjectNameInput.value.trim();
    if (!parent || !name) return;
    try {
      const res = await fetch('/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent,
          name,
          description: newProjectDescriptionInput.value.trim(),
          pm2Name: newProjectPm2NameInput.value.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { addSystemNote('⚠️ ' + (data.error || 'Xatolik')); return; }
      newProjectNameInput.value = '';
      newProjectDescriptionInput.value = '';
      newProjectPm2NameInput.value = '';
      newProjectMetaFields.classList.add('hidden');
      createProjectForm.classList.add('hidden');
      await fetchProjects();
      selectProject(data.project);
    } catch {
      addSystemNote('⚠️ Serverga ulanib bo\'lmadi');
    }
  });

  gotoRootBtn.addEventListener('click', () => {
    browseRoot = '/root';
    currentDir = '.';
    loadFiles();
  });

  newFolderToggle.addEventListener('click', () => {
    createFolderForm.classList.toggle('hidden');
    if (!createFolderForm.classList.contains('hidden')) newFolderNameInput.focus();
  });

  createFolderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newFolderNameInput.value.trim();
    if (!name || (!activeProjectId && !browseRoot)) return;
    try {
      const res = await fetch(`/api/files/mkdir?${browseQuery()}&dir=${encodeURIComponent(currentDir)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { addSystemNote('⚠️ ' + (data.error || 'Xatolik')); return; }
      newFolderNameInput.value = '';
      createFolderForm.classList.add('hidden');
      loadFiles();
    } catch {
      addSystemNote('⚠️ Serverga ulanib bo\'lmadi');
    }
  });

  uploadFileBtn.addEventListener('click', () => {
    if (!activeProjectId && !browseRoot) { addSystemNote('⚠️ Avval loyiha tanlang'); return; }
    uploadFileInput.click();
  });

  uploadFileInput.addEventListener('change', async () => {
    const file = uploadFileInput.files[0];
    uploadFileInput.value = '';
    if (!file || (!activeProjectId && !browseRoot)) return;
    uploadStatus.textContent = `Yuklanmoqda: ${file.name}...`;
    uploadStatus.classList.remove('hidden');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/files/upload?${browseQuery()}&dir=${encodeURIComponent(currentDir)}`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) { addSystemNote('⚠️ ' + (data.error || 'Yuklashda xatolik')); }
      uploadStatus.classList.add('hidden');
      loadFiles();
    } catch {
      uploadStatus.classList.add('hidden');
      addSystemNote('⚠️ Serverga ulanib bo\'lmadi');
    }
  });

  // `projectId=` (oddiy loyiha rejimi) yoki `root=` (papka-yorliq rejimi) —
  // barcha fayl-amal so'rovlari shu orqali quriladi.
  function browseQuery() {
    return browseRoot
      ? `root=${encodeURIComponent(browseRoot)}`
      : `projectId=${encodeURIComponent(activeProjectId)}`;
  }

  async function loadFiles() {
    if (!activeProjectId && !browseRoot) {
      fileTreeEl.innerHTML = '<div class="empty-hint">Avval loyiha tanlang.</div>';
      fileBreadcrumbEl.innerHTML = '';
      return;
    }
    try {
      const res = await fetch(`/api/files?${browseQuery()}&dir=${encodeURIComponent(currentDir)}`);
      const data = await res.json();
      if (!res.ok) {
        fileTreeEl.innerHTML = `<div class="empty-hint">${escapeHtml(data.error || 'Xatolik')}</div>`;
        return;
      }
      renderBreadcrumb();
      fileTreeEl.innerHTML = '';
      if (currentDir !== '.') {
        const upRow = document.createElement('div');
        upRow.className = 'file-row file-up';
        upRow.innerHTML = '<span class="file-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></span><span class="file-name">..</span>';
        upRow.addEventListener('click', () => {
          const parts = currentDir.split('/');
          parts.pop();
          currentDir = parts.length ? parts.join('/') : '.';
          loadFiles();
        });
        fileTreeEl.appendChild(upRow);
      }
      if (!data.entries.length) {
        const hint = document.createElement('div');
        hint.className = 'empty-hint';
        hint.textContent = "Bo'sh papka.";
        fileTreeEl.appendChild(hint);
        return;
      }
      for (const entry of data.entries) {
        const row = document.createElement('div');
        row.className = `file-row ${entry.type}`;
        const iconSvg = entry.type === 'dir'
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
        row.innerHTML = `<span class="file-icon">${iconSvg}</span><span class="file-name"></span><span class="file-size"></span>`;
        row.querySelector('.file-name').textContent = entry.name;
        if (entry.type === 'file') row.querySelector('.file-size').textContent = formatSize(entry.size);
        const relPath = currentDir === '.' ? entry.name : `${currentDir}/${entry.name}`;
        if (entry.type === 'file') {
          const dl = document.createElement('a');
          dl.className = 'icon-btn file-dl';
          dl.title = 'Yuklab olish';
          dl.setAttribute('aria-label', 'Yuklab olish');
          dl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
          dl.setAttribute('download', '');
          dl.href = `/api/file/download?${browseQuery()}&file=${encodeURIComponent(relPath)}`;
          dl.addEventListener('click', (e) => e.stopPropagation());
          row.appendChild(dl);
        }
        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'icon-btn file-rename';
        renameBtn.title = "Nomini o'zgartirish";
        renameBtn.setAttribute('aria-label', "Nomini o'zgartirish");
        renameBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
        renameBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const newName = await promptDialog({
            title: 'Nomini o\'zgartirish',
            message: entry.name,
            value: entry.name,
            confirmText: 'O\'zgartirish',
          });
          if (!newName || newName === entry.name) return;
          try {
            const res2 = await fetch(`/api/file/rename?${browseQuery()}&file=${encodeURIComponent(relPath)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ newName }),
            });
            const data2 = await res2.json();
            if (!res2.ok) { addSystemNote('⚠️ ' + (data2.error || "Nomini o'zgartirib bo'lmadi")); return; }
            loadFiles();
          } catch { addSystemNote("⚠️ Serverga ulanib bo'lmadi"); }
        });
        row.appendChild(renameBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'icon-btn file-del';
        delBtn.title = "O'chirish";
        delBtn.setAttribute('aria-label', "O'chirish");
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await confirmDialog({
            title: entry.type === 'dir' ? `"${entry.name}" papkasini o'chirish` : `"${entry.name}" faylini o'chirish`,
            message: entry.type === 'dir'
              ? "Papka VA ICHIDAGI HAMMA NARSA butunlay o'chadi. Qaytarib bo'lmaydi."
              : "Fayl butunlay o'chadi. Qaytarib bo'lmaydi.",
            confirmText: "O'chirish",
            danger: true,
          });
          if (!ok) return;
          try {
            const res2 = await fetch(`/api/file?${browseQuery()}&file=${encodeURIComponent(relPath)}`, { method: 'DELETE' });
            const data2 = await res2.json();
            if (!res2.ok) { addSystemNote('⚠️ ' + (data2.error || "O'chirilmadi")); return; }
            loadFiles();
          } catch { addSystemNote("⚠️ Serverga ulanib bo'lmadi"); }
        });
        row.appendChild(delBtn);

        row.addEventListener('click', () => {
          if (entry.type === 'dir') { currentDir = relPath; loadFiles(); }
          else openFile(relPath);
        });
        fileTreeEl.appendChild(row);
      }
    } catch {
      fileTreeEl.innerHTML = '<div class="empty-hint">Serverga ulanib bo\'lmadi</div>';
    }
  }

  function renderBreadcrumb() {
    fileBreadcrumbEl.innerHTML = '';
    const rootSeg = document.createElement('span');
    rootSeg.className = 'crumb';
    rootSeg.textContent = '/';
    rootSeg.addEventListener('click', () => { currentDir = '.'; loadFiles(); });
    fileBreadcrumbEl.appendChild(rootSeg);
    if (currentDir === '.') return;
    const parts = currentDir.split('/');
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      const pathAtClick = acc;
      fileBreadcrumbEl.appendChild(document.createTextNode(' / '));
      const seg = document.createElement('span');
      seg.className = 'crumb';
      seg.textContent = part;
      seg.addEventListener('click', () => { currentDir = pathAtClick; loadFiles(); });
      fileBreadcrumbEl.appendChild(seg);
    }
  }

  function highlightFileContent(relPath) {
    if (!window.hljs) return;
    fileViewerContent.className = 'file-viewer-content';
    try {
      const ext = (relPath.split('.').pop() || '').toLowerCase();
      const langMap = {
        js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
        py: 'python', json: 'json', sh: 'bash', bash: 'bash', yml: 'yaml', yaml: 'yaml', md: 'markdown',
        html: 'xml', xml: 'xml', css: 'css', sql: 'sql', php: 'php', conf: 'nginx', nginx: 'nginx', env: 'bash',
      };
      const lang = langMap[ext];
      if (lang && window.hljs.getLanguage(lang)) {
        const result = window.hljs.highlight(fileViewerContent.textContent, { language: lang });
        fileViewerContent.innerHTML = result.value;
      } else {
        window.hljs.highlightElement(fileViewerContent);
      }
    } catch { /* highlight ixtiyoriy — muvaffaqiyatsiz bo'lsa oddiy matn qoladi */ }
  }

  async function openFile(relPath) {
    stopLogStream();
    if (liveLogBtn) liveLogBtn.classList.add('hidden');
    currentFilePath = relPath;
    currentFileEditable = false;
    setFileEditMode(false);
    fileViewerName.textContent = relPath;
    fileDownloadBtn.href = `/api/file/download?${browseQuery()}&file=${encodeURIComponent(relPath)}`;
    fileViewerContent.textContent = 'Yuklanmoqda...';
    openFileViewer();
    try {
      const res = await fetch(`/api/file?${browseQuery()}&file=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      if (!res.ok) fileViewerContent.textContent = data.error || 'Xatolik';
      else if (data.binary) fileViewerContent.textContent = "(Binary fayl — ko'rsatib bo'lmaydi)";
      else if (data.tooLarge) fileViewerContent.textContent = `(Fayl juda katta: ${Math.round(data.size / 1024)} KB)`;
      else {
        fileViewerContent.textContent = data.content;
        currentFileEditable = true;
        fileEditBtn.classList.remove('hidden');
        highlightFileContent(relPath);
      }
    } catch {
      fileViewerContent.textContent = "Serverga ulanib bo'lmadi";
    }
  }

  function setFileEditMode(on) {
    fileViewerContent.classList.toggle('hidden', on);
    fileViewerEditor.classList.toggle('hidden', !on);
    fileEditBtn.classList.toggle('hidden', on || !currentFileEditable);
    fileSaveBtn.classList.toggle('hidden', !on);
    if (on) {
      fileViewerEditor.value = fileViewerContent.textContent;
      fileViewerEditor.focus();
    }
  }

  fileEditBtn.addEventListener('click', () => setFileEditMode(true));

  fileSaveBtn.addEventListener('click', async () => {
    if ((!activeProjectId && !browseRoot) || !currentFilePath) return;
    fileSaveBtn.disabled = true;
    try {
      const res = await fetch(`/api/file?${browseQuery()}&file=${encodeURIComponent(currentFilePath)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileViewerEditor.value }),
      });
      const data = await res.json();
      if (!res.ok) { addSystemNote('⚠️ ' + (data.error || "Saqlanmadi")); return; }
      fileViewerContent.textContent = fileViewerEditor.value;
      setFileEditMode(false);
      highlightFileContent(currentFilePath);
    } catch {
      addSystemNote("⚠️ Serverga ulanib bo'lmadi");
    } finally {
      fileSaveBtn.disabled = false;
    }
  });

  // Ochish/yopish ikkalasi ham `overlayStack` orqali ketadi, shunda "orqaga"
  // tugmasi va Escape fayl ko'ruvchini yopadi (ilovadan chiqib ketmaydi).
  function openFileViewer() {
    if (fileViewer.classList.contains('open')) return;
    fileViewer.classList.add('open');
    fileViewerOverlay.classList.remove('hidden');
    requestAnimationFrame(() => fileViewerOverlay.classList.add('show'));
    openOverlay('fileViewer', doCloseFileViewer);
  }

  function doCloseFileViewer() {
    // Ochiq qolgan SSE oqimi serverdagi `pm2 logs` jarayonini tirik ushlab
    // turadi — oyna yopilishi bilan uni to'xtatamiz.
    stopLogStream();
    fileViewer.classList.remove('open');
    fileViewerOverlay.classList.remove('show');
    setTimeout(() => fileViewerOverlay.classList.add('hidden'), 180);
    setFileEditMode(false);
  }

  function closeFileViewer() {
    requestCloseOverlay('fileViewer');
  }
  fileViewerCloseBtn.addEventListener('click', closeFileViewer);
  fileViewerOverlay.addEventListener('click', closeFileViewer);

  // ---------------- botlar (PM2) ----------------

  const PM2_STATUS_LABEL = { online: 'ishlayapti', stopped: "to'xtatilgan", errored: 'xato', stopping: "to'xtamoqda", launching: 'ishga tushmoqda' };

  // Birlik qisqartmalari: avval `s` bitta funksiya ichida HAM soniya, HAM
  // soat ma'nosida ishlatilardi — "45s" 45 soniya, "3s" esa 3 soat edi.
  // Endi soniya `son`, daqiqa `daq`, soat `soat`, kun `kun`.
  function formatUptime(ts) {
    if (!ts) return '';
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec} son`;
    if (sec < 3600) return `${Math.floor(sec / 60)} daq`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} soat`;
    return `${Math.floor(sec / 86400)} kun`;
  }

  function formatMem(bytes) {
    if (!bytes) return '0M';
    return (bytes / 1024 / 1024).toFixed(0) + 'M';
  }

  async function loadBotList() {
    try {
      const res = await fetch('/api/pm2/list');
      const data = await res.json();
      if (!res.ok) { botListEl.innerHTML = `<div class="empty-hint">⚠️ ${escapeHtml(data.error || 'Xatolik')}</div>`; return; }
      renderBotList(data.processes || []);
      updatePm2Badge(data.processes || []);
    } catch {
      botListEl.innerHTML = '<div class="empty-hint">Serverga ulanib bo\'lmadi</div>';
    }
  }

  function startBotPolling() {
    stopBotPolling();
    botPollTimer = setInterval(loadBotList, 12000);
  }

  function stopBotPolling() {
    if (botPollTimer) { clearInterval(botPollTimer); botPollTimer = null; }
  }

  // Restart soni shu chegaradan oshsa ogohlantiramiz. Avval bu shunchaki
  // raqam edi va ko'zga tashlanmasdi — natijada `zayafka-bot`ning 139 ta
  // restarti (boshqalarda 2-13) oylab sezilmay ketishi mumkin edi.
  const RESTART_WARN = 25;
  const RESTART_ALERT = 60;

  // Uptime juda qisqa + restart ko'p bo'lsa — bu crash-loop alomati:
  // jarayon ko'tarilyapti, yiqilyapti va PM2 uni qayta ko'taryapti.
  function restartSeverity(p) {
    const restarts = p.restarts || 0;
    const upSec = p.uptime ? (Date.now() - p.uptime) / 1000 : Infinity;
    if (restarts >= RESTART_ALERT || (restarts >= RESTART_WARN && upSec < 300)) return 'alert';
    if (restarts >= RESTART_WARN) return 'warn';
    return '';
  }

  function renderBotList(processes) {
    botListEl.innerHTML = '';
    if (!processes.length) {
      botListEl.innerHTML = '<div class="empty-hint">PM2 jarayoni topilmadi.</div>';
      return;
    }
    // Muammolilar tepaga: xato/to'xtagan, keyin ko'p restart bo'lganlar.
    const ordered = processes.slice().sort((a, b) => {
      const rank = (p) => (p.status !== 'online' ? 0 : (restartSeverity(p) ? 1 : 2));
      return rank(a) - rank(b);
    });
    for (const p of ordered) {
      const row = document.createElement('div');
      const sev = restartSeverity(p);
      row.className = 'bot-row' + (sev ? ` restart-${sev}` : '');
      const statusClass = p.status === 'online' ? 'ok' : (p.status === 'errored' ? 'error' : 'warn');
      row.innerHTML = `
        <div class="bot-main">
          <span class="bot-dot ${statusClass}"></span>
          <span class="bot-name"></span>
          <span class="bot-ns"></span>
        </div>
        <div class="bot-meta">
          <span>${escapeHtml(PM2_STATUS_LABEL[p.status] || p.status || '?')}</span>
          <span>CPU ${p.cpu ?? 0}%</span>
          <span>${formatMem(p.memory)}</span>
          <span class="bot-restarts${sev ? ' ' + sev : ''}" ${sev ? `title="Ko'p qayta ishga tushgan — crash-loop bo'lishi mumkin"` : ''}>↻ ${p.restarts ?? 0}</span>
          <span>${formatUptime(p.uptime)}</span>
        </div>
        ${sev === 'alert' ? '<div class="bot-warning">⚠️ Tez-tez qayta ishga tushyapti — loglarni tekshiring</div>' : ''}
        <div class="bot-actions">
          <button type="button" class="bot-logs-btn" title="Loglar">loglar</button>
          <button type="button" class="bot-restart-btn" title="Restart">restart</button>
          <button type="button" class="bot-stop-btn" title="To'xtatish">to'xtatish</button>
        </div>`;
      row.querySelector('.bot-name').textContent = p.name;
      row.querySelector('.bot-ns').textContent = p.namespace && p.namespace !== 'default' ? `(${p.namespace})` : '';
      row.querySelector('.bot-restart-btn').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `"${p.name}" ni qayta ishga tushirish`,
          message: "Jarayon bir necha soniyaga to'xtaydi, keyin o'zi ko'tariladi.",
          confirmText: 'Restart',
        });
        if (!ok) return;
        await pm2Action(p.name, 'restart');
      });
      row.querySelector('.bot-stop-btn').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `"${p.name}" ni to'xtatish`,
          message: "Jarayon TO'XTATILADI va qo'lda qayta ishga tushirmaguningizcha ishlamaydi.",
          confirmText: "To'xtatish",
          danger: true,
        });
        if (!ok) return;
        await pm2Action(p.name, 'stop');
      });
      row.querySelector('.bot-logs-btn').addEventListener('click', () => showBotLogs(p.name));
      botListEl.appendChild(row);
    }
  }

  async function pm2Action(name, action) {
    try {
      const res = await fetch(`/api/pm2/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { addSystemNote('⚠️ ' + (data.error || 'Xatolik')); return; }
      loadBotList();
    } catch {
      addSystemNote("⚠️ Serverga ulanib bo'lmadi");
    }
  }

  // ---------------- jonli loglar ----------------
  // Avval loglar bir marta olinardi va statik turardi: bot xatosini
  // kuzatayotganda "loglar" tugmasini qayta-qayta bosish kerak edi.
  // Endi "jonli" rejimida yangi qatorlar o'zi kelib turadi (SSE).
  let logStream = null;

  function stopLogStream() {
    if (logStream) {
      logStream.close();
      logStream = null;
    }
    if (liveLogBtn) liveLogBtn.classList.remove('on');
  }

  let liveLogBtn = null;

  function startLogStream(name) {
    stopLogStream();
    // Oqim ochilganda mavjud matn saqlanadi, yangi qatorlar ustiga qo'shiladi.
    logStream = new EventSource(`/api/pm2/${encodeURIComponent(name)}/logs/stream`);
    liveLogBtn.classList.add('on');

    logStream.onmessage = (e) => {
      let chunk;
      try { chunk = JSON.parse(e.data); } catch { return; }
      // Foydalanuvchi yuqoriga chiqib o'qiyotgan bo'lsa pastga tortmaymiz.
      const atBottom = fileViewerContent.scrollHeight - fileViewerContent.scrollTop
        - fileViewerContent.clientHeight < 60;
      fileViewerContent.textContent += chunk;
      // Cheksiz o'smasin — oxirgi ~200KB yetarli.
      if (fileViewerContent.textContent.length > 200000) {
        fileViewerContent.textContent = fileViewerContent.textContent.slice(-150000);
      }
      if (atBottom) fileViewerContent.scrollTop = fileViewerContent.scrollHeight;
    };
    logStream.addEventListener('error', () => {
      // Server xatosi yoki ulanish uzilishi — EventSource o'zi qayta ulanadi,
      // lekin foydalanuvchiga holatni ko'rsatib qo'yamiz.
      if (liveLogBtn) liveLogBtn.classList.remove('on');
    });
    logStream.addEventListener('end', () => stopLogStream());
  }

  async function showBotLogs(name) {
    fileViewerName.textContent = `${name} — loglar`;
    fileDownloadBtn.removeAttribute('href');
    fileEditBtn.classList.add('hidden');
    fileViewerContent.className = 'file-viewer-content';
    fileViewerContent.textContent = 'Yuklanmoqda...';
    currentFileEditable = false;
    setFileEditMode(false);

    // "jonli" tugmasi fayl ko'ruvchi sarlavhasiga qo'shiladi (faqat loglar
    // uchun; oddiy fayl ochilganda olib tashlanadi).
    if (!liveLogBtn) {
      liveLogBtn = document.createElement('button');
      liveLogBtn.type = 'button';
      liveLogBtn.className = 'live-log-btn';
      liveLogBtn.textContent = 'jonli';
      liveLogBtn.title = 'Yangi qatorlarni real vaqtda kuzatish';
      fileViewerName.insertAdjacentElement('afterend', liveLogBtn);
    }
    liveLogBtn.classList.remove('hidden');
    liveLogBtn.onclick = () => {
      if (logStream) stopLogStream();
      else startLogStream(name);
    };

    openFileViewer();
    try {
      const res = await fetch(`/api/pm2/${encodeURIComponent(name)}/logs?lines=100`);
      const data = await res.json();
      fileViewerContent.textContent = res.ok ? (data.logs || '(bo\'sh)') : ('⚠️ ' + (data.error || 'Xatolik'));
      fileViewerContent.scrollTop = fileViewerContent.scrollHeight;
    } catch {
      fileViewerContent.textContent = "Serverga ulanib bo'lmadi";
    }
  }

  // Faol loyihaga bog'liq PM2 nomi bo'lsa, topbar'da kichik status-nuqta
  // ko'rsatiladi (masalan @avtopost3_bot bilan ishlayotganda uning holati
  // bir qarashda ko'rinadi, "botlar" panelini alohida ochmasdan).
  function updatePm2Badge(processes) {
    if (!activeProjectPm2Name) { pm2StatusBadge.classList.add('hidden'); return; }
    const match = processes.find((p) => p.name === activeProjectPm2Name);
    if (!match) { pm2StatusBadge.classList.add('hidden'); return; }
    pm2StatusBadge.classList.remove('hidden');
    pm2StatusBadge.textContent = `${activeProjectPm2Name}: ${PM2_STATUS_LABEL[match.status] || match.status}`;
    pm2StatusBadge.classList.toggle('bad', match.status !== 'online');
  }

  // ================= I: loyihalar orasida tez almashish =================
  // Avval loyiha almashtirish uchun: drawer och -> "loyihalar" tabi -> tanla.
  // Endi topbar'dagi yo'lni bosish yetarli.

  function closeProjectSwitcher() {
    projectSwitcher.classList.add('hidden');
    cwdLabel.setAttribute('aria-expanded', 'false');
  }

  function renderProjectSwitcher() {
    projectSwitcher.innerHTML = '';
    if (!projectsList.length) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = "Loyiha yo'q.";
      projectSwitcher.appendChild(hint);
      return;
    }
    for (const p of projectsList) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'switcher-row' + (p.id === activeProjectId ? ' active' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(p.id === activeProjectId));
      const badge = p.pending > 0 ? 'ruxsat!' : (p.busy ? 'band' : '');
      row.innerHTML = '<span class="switcher-label"></span><span class="switcher-path"></span>'
        + (badge ? `<span class="row-badge ${p.pending > 0 ? 'pending' : 'busy'}">${badge}</span>` : '');
      row.querySelector('.switcher-label').textContent = p.label;
      row.querySelector('.switcher-path').textContent = p.path;
      row.addEventListener('click', () => {
        requestCloseOverlay('switcher');
        if (p.id !== activeProjectId) {
          browseRoot = null;
          activeProjectId = p.id;
          isSwitching = true;
          send({ type: 'switch_project', id: p.id });
        }
      });
      projectSwitcher.appendChild(row);
    }
  }

  cwdLabel.addEventListener('click', () => {
    if (!projectSwitcher.classList.contains('hidden')) {
      requestCloseOverlay('switcher');
      return;
    }
    renderProjectSwitcher();
    projectSwitcher.classList.remove('hidden');
    cwdLabel.setAttribute('aria-expanded', 'true');
    openOverlay('switcher', closeProjectSwitcher);
    fetchProjects().then(() => {
      if (!projectSwitcher.classList.contains('hidden')) renderProjectSwitcher();
    });
  });

  // ================= L: chatda qidirish =================
  // Uzun sessiyada biror narsani topishning yagona yo'li brauzerning o'z
  // Ctrl+F i edi — u esa telefonda PWA rejimida umuman yo'q.

  let searchMatches = [];
  let searchIndex = -1;

  function clearSearchHighlights() {
    for (const el of messagesEl.querySelectorAll('.search-hit')) {
      el.classList.remove('search-hit', 'search-hit-active');
    }
    searchMatches = [];
    searchIndex = -1;
    searchCount.textContent = '';
  }

  function runSearch(term) {
    clearSearchHighlights();
    const q = term.trim().toLowerCase();
    if (q.length < 2) return;
    // Butun bloklarni belgilaymiz (matn tugunlarini bo'lakka bo'lmasdan) —
    // shunda mavjud DOM va nusxa tugmalari buzilmaydi.
    const blocks = messagesEl.querySelectorAll('.line, .tool-card, .system-note, .permission-card, .permission-resolved');
    for (const b of blocks) {
      if ((b.textContent || '').toLowerCase().includes(q)) {
        b.classList.add('search-hit');
        searchMatches.push(b);
      }
    }
    if (searchMatches.length) {
      searchIndex = searchMatches.length - 1; // eng oxirgisidan boshlaymiz
      focusSearchMatch();
    } else {
      searchCount.textContent = '0';
    }
  }

  function focusSearchMatch() {
    searchMatches.forEach((m) => m.classList.remove('search-hit-active'));
    const el = searchMatches[searchIndex];
    if (!el) return;
    el.classList.add('search-hit-active');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    searchCount.textContent = `${searchIndex + 1}/${searchMatches.length}`;
  }

  function stepSearch(delta) {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + delta + searchMatches.length) % searchMatches.length;
    focusSearchMatch();
  }

  function closeSearch() {
    searchBar.classList.add('hidden');
    clearSearchHighlights();
    searchInput.value = '';
  }

  searchBtn.addEventListener('click', () => {
    if (!searchBar.classList.contains('hidden')) {
      requestCloseOverlay('search');
      return;
    }
    searchBar.classList.remove('hidden');
    searchInput.focus();
    openOverlay('search', closeSearch);
  });
  searchClose.addEventListener('click', () => requestCloseOverlay('search'));
  searchPrev.addEventListener('click', () => stepSearch(-1));
  searchNext.addEventListener('click', () => stepSearch(1));

  let searchDebounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => runSearch(searchInput.value), 180);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      stepSearch(e.shiftKey ? -1 : 1);
    }
  });

  // ================= F: tez buyruqlar =================
  // 26 ta bot bilan ishlaganda takrorlanuvchi promptlar ko'p. Telefonda
  // ularni har safar qo'lda yozish eng ko'p vaqt oladigan narsa edi.

  const DEFAULT_QUICK_CMDS = [
    { label: 'Botlar holati', text: 'Barcha PM2 jarayonlari holatini tekshir va muammolilarini ayt' },
    { label: 'Xato loglar', text: 'Oxirgi xatolik loglarini ko\'rsat va sababini tushuntir' },
    { label: 'Git holat', text: 'Bu loyihada git status va oxirgi 5 ta commitni ko\'rsat' },
    { label: 'Disk joyi', text: 'Serverda disk va xotira holatini tekshir' },
  ];

  function loadQuickCmds() {
    try {
      const raw = localStorage.getItem('rootwebQuickCmds');
      if (!raw) return DEFAULT_QUICK_CMDS.slice();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : DEFAULT_QUICK_CMDS.slice();
    } catch {
      return DEFAULT_QUICK_CMDS.slice();
    }
  }

  function saveQuickCmds(list) {
    try { localStorage.setItem('rootwebQuickCmds', JSON.stringify(list)); } catch { /* noop */ }
  }

  let quickCmds = loadQuickCmds();

  function renderQuickCmds() {
    quickCmdsEl.innerHTML = '';
    for (const cmd of quickCmds) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'quick-chip';
      chip.textContent = cmd.label;
      chip.title = cmd.text;
      chip.addEventListener('click', () => {
        input.value = cmd.text;
        autoGrowInput();
        input.focus();
      });
      // Uzoq bosish — o'chirish (telefonda kontekst menyusi o'rniga)
      let pressTimer = null;
      const startPress = () => {
        pressTimer = setTimeout(async () => {
          const ok = await confirmDialog({
            title: `"${cmd.label}" ni o'chirish`,
            message: cmd.text,
            confirmText: "O'chirish",
            danger: true,
          });
          if (!ok) return;
          quickCmds = quickCmds.filter((c) => c !== cmd);
          saveQuickCmds(quickCmds);
          renderQuickCmds();
        }, 600);
      };
      const cancelPress = () => clearTimeout(pressTimer);
      chip.addEventListener('touchstart', startPress, { passive: true });
      chip.addEventListener('touchend', cancelPress);
      chip.addEventListener('touchmove', cancelPress);
      chip.addEventListener('mousedown', startPress);
      chip.addEventListener('mouseup', cancelPress);
      chip.addEventListener('mouseleave', cancelPress);
      quickCmdsEl.appendChild(chip);
    }

    const addChip = document.createElement('button');
    addChip.type = 'button';
    addChip.className = 'quick-chip quick-chip-add';
    addChip.textContent = '+';
    addChip.title = "Joriy matnni tez buyruq sifatida saqlash";
    addChip.setAttribute('aria-label', 'Tez buyruq qo\'shish');
    addChip.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) {
        addSystemNote('⚠️ Avval yozuv maydoniga matn kiriting, keyin + ni bosing');
        return;
      }
      const label = await promptDialog({
        title: 'Tez buyruq qo\'shish',
        message: text,
        value: text.slice(0, 24),
        placeholder: 'Qisqa nom',
        confirmText: 'Saqlash',
      });
      if (!label) return;
      quickCmds.push({ label, text });
      saveQuickCmds(quickCmds);
      renderQuickCmds();
    });
    quickCmdsEl.appendChild(addChip);
  }

  function setQuickCmdsVisible(v) {
    quickCmdsEl.classList.toggle('hidden', !v);
    quickCmdsBtn.classList.toggle('on', v);
    try { localStorage.setItem('rootwebQuickCmdsOpen', v ? '1' : '0'); } catch { /* noop */ }
    if (v) renderQuickCmds();
  }

  quickCmdsBtn.addEventListener('click', () => {
    setQuickCmdsVisible(quickCmdsEl.classList.contains('hidden'));
  });

  try {
    setQuickCmdsVisible(localStorage.getItem('rootwebQuickCmdsOpen') === '1');
  } catch {
    setQuickCmdsVisible(false);
  }

  // ================= O: swipe bilan drawer ochish/yopish =================
  // Telefonda o'ng chetdan chapga surish — drawer ochiladi; drawer ustida
  // o'ngga surish — yopiladi.
  const SWIPE_EDGE_PX = 28;
  const SWIPE_MIN_PX = 60;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchTracking = false;

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    const fromRightEdge = touchStartX > window.innerWidth - SWIPE_EDGE_PX;
    const inDrawer = drawer.classList.contains('open') && drawer.contains(e.target);
    touchTracking = fromRightEdge || inDrawer;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!touchTracking) return;
    touchTracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = Math.abs(t.clientY - touchStartY);
    // Vertikal harakat gorizontaldan katta bo'lsa — bu skroll, swipe emas.
    if (dy > Math.abs(dx)) return;
    if (dx < -SWIPE_MIN_PX && !drawer.classList.contains('open')) {
      openDrawer();
      fetchProjects();
    } else if (dx > SWIPE_MIN_PX && drawer.classList.contains('open')) {
      closeDrawer();
    }
  }, { passive: true });

  // ================= K: service worker (PWA) =================
  // Ilova qobigi keshlanadi — internetsiz ham ochiladi va qayta yuklash
  // sezilarli tez boladi. API va HTML hech qachon keshdan berilmaydi
  // (sw.js ichidagi izohga qara).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        // SW ixtiyoriy — royxatdan otmasa ilova odatdagidek ishlayveradi.
        console.warn('Service worker royxatdan otmadi:', err && err.message);
      });
    });
  }

  fetchProjects();
  setInterval(fetchProjects, 5000);
  connect();
})();
