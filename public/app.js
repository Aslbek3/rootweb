(() => {
  const messagesEl = document.getElementById('messages');
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
  const panelFolders = document.getElementById('panelFolders');
  const addFolderForm = document.getElementById('addFolderForm');
  const newFolderLabelInput = document.getElementById('newFolderLabel');
  const newFolderPathInput = document.getElementById('newFolderPath');
  const folderBookmarkListEl = document.getElementById('folderBookmarkList');
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
  // Non-null while browsing a "papkalar" (folder bookmark) absolute path
  // instead of the active loyiha/project — see loadFolderBookmarks() below.
  // Kept independent of activeProjectId so jumping to a bookmark never sends
  // switch_project (Claude's active conversation/session stays untouched).
  let browseRoot = null;
  let lastCwd = '';
  let isSwitching = false;
  let prevPending = new Map();
  let folderBookmarks = [];
  let currentFilePath = null;
  let currentFileEditable = false;

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Minimal markdown: fenced code blocks, inline code, bold, italic, paragraphs.
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
        let seg = parts[i]
          .replace(/`([^`]+)`/g, '<code>$1</code>')
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\n{2,}/g, '</p><p>')
          .replace(/\n/g, '<br>');
        html += `<p>${seg}</p>`;
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
    card.innerHTML = `<span class="tool-tag">[${escapeHtml(tag)}]</span><span class="tool-summary"></span><span class="tool-status"></span>`;
    card.querySelector('.tool-summary').textContent = summary;
    messagesEl.appendChild(card);
    scrollToBottom();
    return card;
  }

  function markToolResult(id, isError) {
    const card = messagesEl.querySelector(`.tool-card[data-tool-id="${CSS.escape(id)}"]`);
    if (card) {
      card.classList.add(isError ? 'error' : 'ok');
      const statusEl = card.querySelector('.tool-status');
      if (statusEl) statusEl.textContent = isError ? '✗' : '✓';
    }
  }

  // Ruxsat so'rovini texnik bo'lmagan odam ham tushunadigan qisqa jumlaga
  // aylantiradi. Xom `input` pastda "texnik tafsilot" sifatida baribir
  // ko'rinadi (pcmd-full) — bu shunchaki birinchi qatorni tushunarli qiladi.
  function describeToolCall(name, input) {
    input = input || {};
    switch (name) {
      case 'Bash':
      case 'PowerShell':
        return `Terminal buyrug'i ishga tushiriladi: ${input.command || input.description || '(noma\'lum)'}`;
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

  function addPermissionCard(reqId, name, input) {
    const card = document.createElement('div');
    card.className = 'permission-card';
    const summary = toolSummary(name, input) || '';
    const friendly = describeToolCall(name, input);
    const PREVIEW_LEN = 70;
    const isLong = summary.length > PREVIEW_LEN;
    const short = isLong ? summary.slice(0, PREVIEW_LEN) + '…' : summary;
    card.innerHTML = `
      <div class="ptitle">ruxsat kerak <span class="ptag">[${escapeHtml(name)}]</span></div>
      ${friendly ? `<div class="pfriendly"></div>` : ''}
      <div class="pcmd-preview"><code>${escapeHtml(short)}</code></div>
      ${isLong ? `<button type="button" class="pcmd-toggle">texnik tafsilot</button>
      <pre class="pcmd-full hidden"><code>${escapeHtml(summary).slice(0, 2000)}</code></pre>` : ''}
      <div class="permission-diff-slot"></div>
      <div class="permission-actions">
        <button class="allow">Ruxsat berish</button>
        <button class="deny">Rad etish</button>
      </div>`;
    if (friendly) card.querySelector('.pfriendly').textContent = friendly;
    if (name === 'Edit' && input && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
      card.querySelector('.permission-diff-slot').appendChild(renderLineDiff(input.old_string, input.new_string));
    }
    if (isLong) {
      const toggle = card.querySelector('.pcmd-toggle');
      const preview = card.querySelector('.pcmd-preview');
      const full = card.querySelector('.pcmd-full');
      toggle.addEventListener('click', () => {
        const willShow = full.classList.contains('hidden');
        full.classList.toggle('hidden');
        preview.classList.toggle('hidden', willShow);
        toggle.textContent = willShow ? 'yashirish' : 'texnik tafsilot';
      });
    }
    const allowBtn = card.querySelector('.allow');
    const denyBtn = card.querySelector('.deny');
    const respond = (approve) => {
      send({ type: 'permission', id: reqId, approve });
      const resolved = document.createElement('div');
      resolved.className = 'permission-resolved ' + (approve ? 'ok' : 'deny');
      resolved.innerHTML = `<span class="permission-resolved-icon">${approve ? '✓' : '✗'}</span><span class="tool-tag">[${escapeHtml(name)}]</span><span class="permission-resolved-text"></span>`;
      resolved.querySelector('.permission-resolved-text').textContent = short;
      card.replaceWith(resolved);
    };
    allowBtn.addEventListener('click', () => respond(true));
    denyBtn.addEventListener('click', () => respond(false));
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
    sendBtn.style.display = v ? 'none' : 'flex';
    stopBtn.style.display = v ? 'flex' : 'none';
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
        hideTyping();
        for (const evt of msg.history || []) handleMessage(evt, true);
        setBusy(!!msg.busy);
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
        markToolResult(msg.id, msg.isError);
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
      case 'result':
        setBusy(false);
        if (msg.isError) addSystemNote('⚠️ ' + (msg.message || 'Xatolik yuz berdi'));
        if (!isReplay && document.hidden) {
          notify('Claude tugatdi', msg.isError ? (msg.message || 'Xatolik yuz berdi') : 'Vazifa yakunlandi');
        }
        break;
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
      case 'auth_error':
        window.location.href = '/login.html';
        break;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
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
    addBubble('user', text || '(ilova)', pendingAttachments);
    send({ type: 'chat', text: outgoingText, images: images.map((a) => ({ mediaType: a.mediaType, data: a.data })) });
    input.value = '';
    input.style.height = 'auto';
    pendingAttachments = [];
    renderAttachments();
    setBusy(true);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  stopBtn.addEventListener('click', () => {
    send({ type: 'stop' });
  });

  clearChatBtn.addEventListener('click', () => {
    const ok = confirm("Suhbat tarixi butunlay o'chadi, qaytarib bo'lmaydi. Davom etasizmi?");
    if (!ok) return;
    send({ type: 'clear_chat' });
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // ---------------- mavzu (claude / qora / yorug') ----------------
  const THEME_ORDER = ['claude', 'black', 'light'];
  const THEME_LABEL = { claude: 'Claude', black: "Qora", light: "Yorug'" };
  const THEME_COLOR = { claude: '#262624', black: '#050505', light: '#faf9f5' };
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  function applyTheme(theme) {
    if (theme === 'claude') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    if (themeMeta) themeMeta.setAttribute('content', THEME_COLOR[theme] || THEME_COLOR.claude);
    themeBtn.title = `Mavzu: ${THEME_LABEL[theme]} (bosib almashtiring)`;
    try { localStorage.setItem('rootwebTheme', theme); } catch { /* xotira o'chirilgan bo'lishi mumkin */ }
  }

  themeBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'claude';
    const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
    applyTheme(next);
  });

  applyTheme(document.documentElement.getAttribute('data-theme') || 'claude');

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
    if (!('Notification' in window)) { notifyBtn.style.display = 'none'; return; }
    const active = Notification.permission === 'granted' && !notifyMuted;
    notifyBtn.classList.toggle('on', active);
    notifyBtn.classList.toggle('off', !active);
    const label = active ? 'Bildirishnomalar (yoqilgan)' : "Bildirishnomalar (o'chirilgan)";
    notifyBtn.title = label;
    notifyBtn.setAttribute('aria-label', label);
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

  // ---------------- drawer: loyihalar & fayllar ----------------

  function openDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.remove('hidden');
    requestAnimationFrame(() => drawerOverlay.classList.add('show'));
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('show');
    setTimeout(() => drawerOverlay.classList.add('hidden'), 180);
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
        chip.innerHTML = `<img src="${att.previewUrl}" alt="${escapeHtml(att.name)}"><button type="button" class="attachment-remove" aria-label="O'chirish">&times;</button>`;
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
      panelFolders.classList.toggle('hidden', tab !== 'folders');
      if (tab === 'files') { currentDir = '.'; loadFiles(); }
      if (tab === 'bots') { loadBotList(); startBotPolling(); } else { stopBotPolling(); }
      if (tab === 'limit') {
        renderUsagePanel();
        renderRateLimits();
        send({ type: 'get_rate_limits' });
      }
      if (tab === 'folders') { loadFolderBookmarks(); renderFolderBookmarkList(); }
    });
  });

  async function fetchProjects() {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      projectsList = data.projects || [];
      renderProjectList();
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
        const ok = confirm(`"${p.label}" loyihasini ro'yxatdan o'chirmoqchimisiz?\n\nFayllar va PM2'dagi tegishli bot/xizmat O'ZGARMAYDI — faqat shu ro'yxatdan va chat tarixi o'chadi.`);
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
      // Loyihaning o'zi allaqachon faol, faqat "papkalar" yorliqidan qaytilyapti —
      // switch_project shart emas, shunchaki fayllar ko'rinishini qayta yuklash yetarli.
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
          const newName = prompt('Yangi nom:', entry.name);
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
          const warn = entry.type === 'dir'
            ? `"${entry.name}" papkasini VA ICHIDAGI HAMMA NARSANI butunlay o'chirmoqchimisiz?`
            : `"${entry.name}" faylini o'chirmoqchimisiz?`;
          if (!confirm(warn)) return;
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
    currentFilePath = relPath;
    currentFileEditable = false;
    setFileEditMode(false);
    fileViewerName.textContent = relPath;
    fileDownloadBtn.href = `/api/file/download?${browseQuery()}&file=${encodeURIComponent(relPath)}`;
    fileViewerContent.textContent = 'Yuklanmoqda...';
    fileViewer.classList.add('open');
    fileViewerOverlay.classList.remove('hidden');
    requestAnimationFrame(() => fileViewerOverlay.classList.add('show'));
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

  function closeFileViewer() {
    fileViewer.classList.remove('open');
    fileViewerOverlay.classList.remove('show');
    setTimeout(() => fileViewerOverlay.classList.add('hidden'), 180);
    setFileEditMode(false);
  }
  fileViewerCloseBtn.addEventListener('click', closeFileViewer);
  fileViewerOverlay.addEventListener('click', closeFileViewer);

  // ---------------- papkalar (folder-yorliqlar) ----------------
  // Absolyut VPS yo'llarini localStorage'da yorliq sifatida saqlaydi.
  // Bosilganda fayllar panelini o'sha papkaga sakratadi (browseRoot orqali) —
  // switch_project YUBORILMAYDI, ya'ni Claude'ning faol loyiha/suhbati
  // o'zgarmaydi, faqat fayl ko'rinishi almashadi.

  const FOLDER_BOOKMARKS_KEY = 'rootwebFolderBookmarks';

  // ---------------- botlar (PM2) ----------------

  const PM2_STATUS_LABEL = { online: 'ishlayapti', stopped: "to'xtatilgan", errored: 'xato', stopping: "to'xtamoqda", launching: 'ishga tushmoqda' };

  function formatUptime(ts) {
    if (!ts) return '';
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}d`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}s`;
    return `${Math.floor(sec / 86400)}kun`;
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

  function renderBotList(processes) {
    botListEl.innerHTML = '';
    if (!processes.length) {
      botListEl.innerHTML = '<div class="empty-hint">PM2 jarayoni topilmadi.</div>';
      return;
    }
    for (const p of processes) {
      const row = document.createElement('div');
      row.className = 'bot-row';
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
          <span>↻ ${p.restarts ?? 0}</span>
          <span>${formatUptime(p.uptime)}</span>
        </div>
        <div class="bot-actions">
          <button type="button" class="bot-logs-btn" title="Loglar">loglar</button>
          <button type="button" class="bot-restart-btn" title="Restart">restart</button>
          <button type="button" class="bot-stop-btn" title="To'xtatish">to'xtatish</button>
        </div>`;
      row.querySelector('.bot-name').textContent = p.name;
      row.querySelector('.bot-ns').textContent = p.namespace && p.namespace !== 'default' ? `(${p.namespace})` : '';
      row.querySelector('.bot-restart-btn').addEventListener('click', async () => {
        if (!confirm(`"${p.name}" qayta ishga tushiriladi (bir necha soniyaga to'xtaydi). Davom etasizmi?`)) return;
        await pm2Action(p.name, 'restart');
      });
      row.querySelector('.bot-stop-btn').addEventListener('click', async () => {
        if (!confirm(`"${p.name}" TO'XTATILADI va qo'lda qayta ishga tushirmaguningizcha ishlamaydi. Davom etasizmi?`)) return;
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

  async function showBotLogs(name) {
    fileViewerName.textContent = `${name} — loglar`;
    fileDownloadBtn.removeAttribute('href');
    fileEditBtn.classList.add('hidden');
    fileViewerContent.className = 'file-viewer-content';
    fileViewerContent.textContent = 'Yuklanmoqda...';
    currentFileEditable = false;
    setFileEditMode(false);
    fileViewer.classList.add('open');
    fileViewerOverlay.classList.remove('hidden');
    requestAnimationFrame(() => fileViewerOverlay.classList.add('show'));
    try {
      const res = await fetch(`/api/pm2/${encodeURIComponent(name)}/logs?lines=100`);
      const data = await res.json();
      fileViewerContent.textContent = res.ok ? (data.logs || '(bo\'sh)') : ('⚠️ ' + (data.error || 'Xatolik'));
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

  function genId() {
    if (window.crypto && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch { /* insecure context (plain http) - fall through */ }
    }
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function loadFolderBookmarks() {
    try { folderBookmarks = JSON.parse(localStorage.getItem(FOLDER_BOOKMARKS_KEY) || '[]'); }
    catch { folderBookmarks = []; }
  }

  function saveFolderBookmarks() {
    localStorage.setItem(FOLDER_BOOKMARKS_KEY, JSON.stringify(folderBookmarks));
  }

  function renderFolderBookmarkList() {
    folderBookmarkListEl.innerHTML = '';
    if (!folderBookmarks.length) {
      folderBookmarkListEl.innerHTML = '<div class="empty-hint">Hali papka yorlig\'i qo\'shilmagan.</div>';
      return;
    }
    for (const bookmark of folderBookmarks) {
      const row = document.createElement('div');
      row.className = 'project-row';
      const info = document.createElement('div');
      info.className = 'project-info';
      info.innerHTML = '<div class="project-label"><span class="project-label-text"></span></div><div class="project-path"></div>';
      info.querySelector('.project-label-text').textContent = bookmark.label || bookmark.path;
      info.querySelector('.project-path').textContent = bookmark.path;
      info.addEventListener('click', () => {
        browseRoot = bookmark.path;
        currentDir = '.';
        drawerTabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === 'files'));
        panelProjects.classList.add('hidden');
        panelFiles.classList.remove('hidden');
        panelBots.classList.add('hidden');
        panelLimit.classList.add('hidden');
        panelFolders.classList.add('hidden');
        stopBotPolling();
        loadFiles();
        closeDrawer();
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn project-del';
      delBtn.title = "O'chirish";
      delBtn.setAttribute('aria-label', "O'chirish");
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/><path d="M10 11v6M14 11v6"/></svg>';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        folderBookmarks = folderBookmarks.filter((x) => x.id !== bookmark.id);
        saveFolderBookmarks();
        renderFolderBookmarkList();
      });
      row.appendChild(info);
      row.appendChild(delBtn);
      folderBookmarkListEl.appendChild(row);
    }
  }

  addFolderForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const label = newFolderLabelInput.value.trim();
    const folderPath = newFolderPathInput.value.trim();
    if (!folderPath.startsWith('/')) { addSystemNote("⚠️ Yo'l absolyut bo'lishi kerak (/ bilan boshlansin)"); return; }
    folderBookmarks.push({ id: genId(), label, path: folderPath });
    saveFolderBookmarks();
    newFolderLabelInput.value = '';
    newFolderPathInput.value = '';
    renderFolderBookmarkList();
  });

  fetchProjects();
  setInterval(fetchProjects, 5000);
  connect();
})();
