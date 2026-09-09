const crypto = require('crypto');
const path = require('path');
const { query } = require('@anthropic-ai/claude-agent-sdk');
const auditLog = require('./auditLog');
const { isAutoApprovable } = require('./bashPolicy');
const { writeJsonAtomic, readJson } = require('./atomicFile');

// Tool calls that are read-only / low-risk are auto-approved so a phone
// session isn't interrupted by a permission prompt on every file read.
// Everything else (Write, Edit, Bash, WebFetch, ...) always asks first.
const SAFE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'TodoWrite']);

// Auto-approved on top of SAFE_TOOLS only while permissionMode === 'acceptEdits'
// ("avto" rejim) — file-edit tools, plus Bash commands that pass the
// allowlist+denylist policy in `bashPolicy.js`. Anything else still asks.
const EDIT_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

// How many past events to keep for replay when a client (re)connects.
const MAX_HISTORY = 500;

// Tool natijasi uchun ikkita alohida chegara (`emitSplit`ga qara):
// jonli ulangan klient to'liqroq chiqishni oladi, diskdagi tarixga esa
// ancha qisqasi tushadi — aks holda bitta `pm2 logs`/`cat` natijasi
// `sessions_meta.json`ni megabaytlarga shishirib yuborardi.
const LIVE_OUTPUT_MAX = 16 * 1024;
const HISTORY_OUTPUT_MAX = 2 * 1024;

// SDK'ning `tool_result` bloki mazmuni yo oddiy satr, yo content-blok
// massivi bo'lishi mumkin — ikkalasini ham matnga keltiramiz.
function extractToolOutput(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b && b.type === 'text') return b.text || '';
        if (b && b.type === 'image') return '[rasm]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function clampOutput(text, max) {
  if (!text) return { output: '', truncated: false };
  if (text.length <= max) return { output: text, truncated: false };
  // Oxiri ko'pincha muhimroq (xato xabari, oxirgi loglar), lekin boshi ham
  // kerak — shuning uchun ikkala uchini olamiz.
  const head = text.slice(0, Math.floor(max * 0.6));
  const tail = text.slice(-Math.floor(max * 0.4));
  return {
    output: `${head}\n\n… [${text.length - max} belgi tashlab ketildi] …\n\n${tail}`,
    truncated: true,
    fullLength: text.length,
  };
}

// One persistent Claude Agent SDK conversation per project, kept alive in
// memory for as long as the server process runs. A `pm2 restart` (deploy,
// crash, manual restart) still ends the in-memory `sessions` Map below — but
// each session's { sdkSessionId, history } is mirrored to disk (see
// sessionsMeta* below), so the NEXT getOrCreateSession() for that project:
// (1) pre-seeds `history` from the saved copy, so a reconnecting client sees
//     the old chat immediately, and
// (2) passes `resume: sdkSessionId` to query(), so Claude's own memory of
//     the conversation continues correctly for the next reply.
// These two are deliberately separate mechanisms, NOT one relying on the
// other: empirically verified (see /tmp/resume_test during development) that
// the Agent SDK's streaming-input `resume` does NOT replay the old transcript
// back through the message stream (unlike `claude --resume` in the
// interactive CLI) — it only restores the model's own context, silently. If
// we only had `resume` and no saved `history`, the UI would come back empty
// until the next new message. So `history` is OUR copy, not a derivative of
// the SDK's — it's exactly the same array the live session already builds up
// in RAM, just also written to disk.
const sessions = new Map(); // projectId -> session

// Per-project { sdkSessionId, cwd, permissionMode, history } snapshot,
// persisted to disk so a restart can both resume Claude's own context
// (sdkSessionId) and redraw the visible chat instantly (history) without
// waiting for a new message.
const SESSIONS_META_FILE = path.join(__dirname, 'data', 'sessions_meta.json');

let sessionsMeta = readJson(SESSIONS_META_FILE, {});

// ⚠️ Yozuv DEBOUNCE qilinadi. Avval `record()` har bir voqeada butun
// `sessionsMeta`ni (BARCHA loyihalarning to'liq tarixi bilan) serializatsiya
// qilib, sinxron diskka yozardi. Claude bitta javobda 20-50 ta voqea yuboradi
// (matn bloklari, tool_use, tool_result), ya'ni 30 loyiha × 500 voqea har bir
// bloкда qaytadan yozilardi — bu event loop'ni bloklab, BOSHQA barcha WS
// sessiyalarini ham sekinlashtirardi.
//
// Endi yozuv 1 soniyaga yig'iladi. Ma'lumot yo'qolmasligi uchun `flush()`
// protsess tugashida (SIGINT/SIGTERM/exit) majburan chaqiriladi.
const PERSIST_DEBOUNCE_MS = 1000;
let persistTimer = null;

function flushSessionsMeta() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  writeJsonAtomic(SESSIONS_META_FILE, sessionsMeta);
}

function scheduleSave() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeJsonAtomic(SESSIONS_META_FILE, sessionsMeta);
  }, PERSIST_DEBOUNCE_MS);
  // Kutilayotgan yozuv protsessni tirik ushlab turmasin.
  if (persistTimer.unref) persistTimer.unref();
}

function persistSessionMeta(projectId, data) {
  sessionsMeta[projectId] = data;
  scheduleSave();
}

function clearSessionMeta(projectId) {
  if (!(projectId in sessionsMeta)) return;
  delete sessionsMeta[projectId];
  // O'chirish darhol yozilsin — "chatni tozalash"dan keyin darrov restart
  // bo'lsa, endigina tozalangan suhbat qayta tirilib qolmasligi kerak.
  flushSessionsMeta();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { flushSessionsMeta(); process.exit(0); });
}
process.once('exit', flushSessionsMeta);

function createSession(projectId, cwd, description) {
  const savedMeta = sessionsMeta[projectId];
  const clients = new Set();
  // Pre-seed from disk (see SESSIONS_META_FILE note above) so a reconnecting
  // client's first snapshot() already has the pre-restart chat, before any
  // new SDK message has arrived.
  const history = (savedMeta && Array.isArray(savedMeta.history)) ? savedMeta.history.slice() : [];
  const pendingPermissions = new Map(); // id -> resolver fn
  const pendingQuestions = new Map(); // id -> resolver fn (AskUserQuestion answers)
  const messageQueue = [];
  let resolveNext = null;
  let busy = false;
  let cwdResolved = cwd;
  let sdkSessionId = (savedMeta && savedMeta.sdkSessionId) || null;
  // rootweb instansiyasi standart ravishda "avto" (acceptEdits) rejimda
  // boshlanadi — claudeweb'dan farqli, chunki bu tool root sifatida ishlaydi
  // va Aslbek har safar qo'lda [avto] tugmasini bosishni xohlamaydi.
  //
  // ⚠️ MUHIM: avval bu qator shartsiz `'acceptEdits'` edi, holbuki
  // `persistSessionMeta()` `permissionMode`ni diskka YOZIB turardi — ya'ni
  // saqlangan qiymat hech qachon O'QILMASDI. Oqibati fail-open edi: xavfli
  // ish oldidan ataylab `[manual]` rejimiga o'tsangiz, keyingi `pm2 restart`
  // (yoki crash, yoki deploy) sessiyani jimgina yana "avto" rejimda
  // tiklardi va buni hech kim sezmasdi. Endi saqlangan rejim tiklanadi;
  // qiymat notanish bo'lsa eng XAVFSIZ rejimga ('default' — hammasi
  // so'raladi) tushamiz, eng qulayiga emas.
  const ALLOWED_MODES = new Set(['default', 'plan', 'acceptEdits']);
  let permissionMode = 'acceptEdits';
  if (savedMeta && typeof savedMeta.permissionMode === 'string') {
    permissionMode = ALLOWED_MODES.has(savedMeta.permissionMode) ? savedMeta.permissionMode : 'default';
  }
  // Sessiya davomida yig'ilib boruvchi foydalanish statistikasi ("usage"
  // tugmasi uchun) — input/output token har bir SDK 'result' navbatida
  // qo'shiladi, total_cost_usd esa SDK'ning o'zi kumulyativ hisoblab
  // beradi (shunchaki oxirgi qiymat saqlanadi).
  let cumulativeInputTokens = 0;
  let cumulativeOutputTokens = 0;
  let totalCostUsd = 0;

  function wake() {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  }

  function broadcast(event) {
    const json = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  }

  function record(event) {
    history.push(event);
    if (history.length > MAX_HISTORY) history.shift();
    persistSessionMeta(projectId, { sdkSessionId, cwd: cwdResolved, permissionMode, history });
  }

  function emit(event) {
    record(event);
    broadcast(event);
  }

  // Jonli ulangan klientlarga BOSHQA (kattaroq) nusxa, diskdagi tarixga esa
  // qisqartirilgan nusxa yuboradi. Faqat `tool_result` uchun kerak: xom
  // chiqish megabaytlarga yetishi mumkin va uni to'liq holda `history`ga
  // (demak `sessions_meta.json`ga) yozib qo'yish faylni shishirib yuborardi.
  function emitSplit(liveEvent, historyEvent) {
    record(historyEvent);
    broadcast(liveEvent);
  }

  // Lives for the lifetime of the session (never ended by a client
  // disconnecting) so a task Claude is running keeps going in the
  // background even while nobody is looking at it.
  async function* inputStream() {
    while (true) {
      if (messageQueue.length > 0) {
        yield messageQueue.shift();
      } else {
        await new Promise((resolve) => { resolveNext = resolve; });
      }
    }
  }

  const q = query({
    prompt: inputStream(),
    options: {
      cwd,
      // SDK ataylab 'default'da qoldiriladi (faqat 'plan' istisno): shunda
      // HAR BIR tool bizning `canUseTool`imizdan o'tadi va siyosat bitta
      // joyda — `bashPolicy.js`da — hal qilinadi. Agar bu yerga 'acceptEdits'
      // uzatilsa, SDK ba'zi toollarni biz ko'rmasdan o'zi tasdiqlab yuborardi,
      // ya'ni ikkita haqiqat manbai paydo bo'lardi.
      permissionMode: permissionMode === 'plan' ? 'plan' : 'default',
      // Loyiha tavsifi ("loyihalar" panelidagi description maydoni) bo'lsa,
      // Claude Code'ning standart tizim promptiga qo'shimcha sifatida
      // qo'shiladi — shuning uchun sessiya boshlanishi bilanoq Claude bu
      // qaysi loyiha/bot ekanini, uning ma'lum xususiyatlarini biladi va
      // foydalanuvchi har safar qayta tushuntirishi shart bo'lmaydi.
      // `preset: 'claude_code'` standart xatti-harakatni (fayl-tizim
      // xabardorligi, tool ishlatish uslubi va h.k.) saqlab qoladi — faqat
      // ustiga qo'shiladi, almashtirmaydi.
      ...(description && description.trim()
        ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: `Loyiha haqida kontekst:\n${description.trim()}` } }
        : {}),
      // Reattach to the same Claude session across a server restart (see
      // sessionsMeta above). Absent on a project's very first-ever session,
      // and self-healing (cleared below) if the saved id ever fails to
      // resume — so a bad/expired pointer can't wedge the project forever.
      ...(savedMeta && savedMeta.sdkSessionId ? { resume: savedMeta.sdkSessionId } : {}),
      canUseTool: async (toolName, input, opts) => {
        // AskUserQuestion isn't a real side-effecting tool — its whole job is
        // collecting a structured answer from the human, so `canUseTool` IS
        // its execution: the SDK treats the `updatedInput` we return here
        // (merged with `answers`/`response`) as the tool's own result,
        // there's no separate run step. Confirmed empirically against this
        // SDK build (manifest commit e140b3281c1e8d834468889bd0a5c3fd2f15507c):
        // `onUserDialog`/`supportedDialogKinds` never fires for it.
        if (toolName === 'AskUserQuestion') {
          const id = opts.toolUseID || crypto.randomUUID();
          emit({ type: 'question_request', id, questions: input.questions || [] });
          const { answers, response } = await new Promise((resolve) => pendingQuestions.set(id, resolve));
          return { behavior: 'allow', updatedInput: { ...input, answers, ...(response ? { response } : {}) } };
        }
        if (SAFE_TOOLS.has(toolName) || toolName === 'ExitPlanMode') {
          return { behavior: 'allow', updatedInput: input };
        }
        if (permissionMode === 'acceptEdits') {
          if (EDIT_TOOLS.has(toolName)) {
            return { behavior: 'allow', updatedInput: input };
          }
          // `isAutoApprovable` = allowlist VA denylist ikkalasidan ham o'tish
          // (`bashPolicy.js`ga qara). Mos kelmasa rad etilmaydi — pastdagi
          // ruxsat kartochkasi chiqariladi.
          if (toolName === 'Bash' && isAutoApprovable(input && input.command)) {
            return { behavior: 'allow', updatedInput: input };
          }
        }
        const id = opts.toolUseID || crypto.randomUUID();
        emit({ type: 'permission_request', id, name: toolName, input });
        return new Promise((resolve) => pendingPermissions.set(id, { resolve, name: toolName, input }));
      },
    },
  });

  function handleSdkMessage(message) {
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          cwdResolved = message.cwd;
          sdkSessionId = message.session_id;
          // Persisted here (in addition to every record()) so sdkSessionId
          // is captured immediately — if the process dies before the first
          // reply, a resume is still possible on the next boot.
          persistSessionMeta(projectId, { sdkSessionId, cwd: cwdResolved, permissionMode, history });
        }
        break;
      case 'assistant': {
        const content = (message.message && message.message.content) || [];
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            emit({ type: 'assistant', text: block.text });
          } else if (block.type === 'tool_use') {
            emit({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
          }
        }
        break;
      }
      case 'user': {
        const content = message.message && message.message.content;
        // Note: plain human-authored text in this message is NOT re-recorded
        // here — pushUserMessage() already recorded it locally the moment it
        // was sent. Only tool_result blocks (synthesized by the SDK after a
        // tool runs) are new information we need to capture from this side
        // of the stream.
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              // Avval bu yerda faqat `{id, isError}` yuborilardi — ya'ni tool
              // chiqishi (masalan `pm2 logs`ning natijasi) klientga UMUMAN
              // yetib bormasdi va foydalanuvchi faqat ✓ belgisini ko'rardi.
              // Xom natijani ko'rish uchun Claude uni matn sifatida qayta
              // yozib berishini kutish kerak edi: sekin, token sarflaydi va
              // qisqartirilgan bo'lardi.
              const output = extractToolOutput(block.content);
              emitSplit(
                { type: 'tool_result', id: block.tool_use_id, isError: !!block.is_error, ...clampOutput(output, LIVE_OUTPUT_MAX) },
                { type: 'tool_result', id: block.tool_use_id, isError: !!block.is_error, ...clampOutput(output, HISTORY_OUTPUT_MAX) },
              );
            }
          }
        }
        break;
      }
      case 'result':
        busy = false;
        emit({
          type: 'result',
          isError: !!message.is_error,
          message: message.is_error ? (message.errors || []).join('; ') : undefined,
        });
        if (message.usage || typeof message.total_cost_usd === 'number') {
          if (message.usage) {
            cumulativeInputTokens += message.usage.input_tokens || 0;
            cumulativeOutputTokens += message.usage.output_tokens || 0;
          }
          if (typeof message.total_cost_usd === 'number') totalCostUsd = message.total_cost_usd;
          emit({
            type: 'usage_update',
            inputTokens: cumulativeInputTokens,
            outputTokens: cumulativeOutputTokens,
            totalCostUsd,
          });
        }
        break;
      default:
        break;
    }
  }

  (async () => {
    try {
      for await (const message of q) {
        handleSdkMessage(message);
      }
    } catch (err) {
      busy = false;
      emit({ type: 'error', message: String((err && err.message) || err) });
      // Self-heal: drop the broken session so the next attach (reconnect or
      // project switch) transparently starts a fresh one instead of
      // pushing messages into a conversation that has already died. Also
      // drop the persisted sdkSessionId — if `resume` itself is what failed
      // (deleted/corrupted transcript), keeping it would just repeat the
      // same failure forever; the next getOrCreateSession() should start
      // clean instead of retrying a doomed resume.
      // Guard: only touch the map if IT STILL POINTS TO THIS SESSION.
      // resetSession() below can already have swapped in a brand-new
      // session (with a brand-new `q`) for the same projectId before this
      // catch ever runs (q.close() settling is async) — without this check
      // we'd delete the map entry the new session just installed, orphaning
      // it too instead of the one that actually errored.
      if (sessions.get(projectId) === session) {
        sessions.delete(projectId);
        clearSessionMeta(projectId);
      }
    }
  })();

  const session = {
    projectId,
    attach(ws) { clients.add(ws); },
    detach(ws) { clients.delete(ws); },
    pushUserMessage(text, images) {
      busy = true;
      // Only base64 image bytes go into the live SDK message — history just
      // remembers how many there were, so replay on reconnect stays cheap
      // and MAX_HISTORY doesn't fill up with megabytes of pixel data.
      const imgList = Array.isArray(images)
        ? images.filter((img) => img && typeof img.data === 'string' && typeof img.mediaType === 'string').slice(0, 6)
        : [];
      record({ type: 'user_message', text, imageCount: imgList.length });
      let content;
      if (imgList.length) {
        content = imgList.map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        }));
        if (text) content.push({ type: 'text', text });
      } else {
        content = text;
      }
      messageQueue.push({
        type: 'user',
        message: { role: 'user', content },
        parent_tool_use_id: null,
      });
      wake();
    },
    resolvePermission(id, approve) {
      const pending = pendingPermissions.get(id);
      if (!pending) return;
      pendingPermissions.delete(id);
      auditLog.log('permission_decision', { projectId, tool: pending.name, approve });
      pending.resolve(approve
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: 'Foydalanuvchi telefon orqali ruxsat bermadi.' });
    },
    answerQuestion(id, answers, response) {
      const resolver = pendingQuestions.get(id);
      if (!resolver) return;
      pendingQuestions.delete(id);
      resolver({ answers: answers || {}, response });
    },
    interrupt() { q.interrupt().catch(() => {}); },
    // Full teardown (unlike interrupt(), which only stops the current turn
    // and leaves the session — and its CLI subprocess — alive): q.close()
    // forcefully ends the query and kills the underlying `claude` subprocess.
    // Used by resetSession() ("chatni tozalash") so the old process doesn't
    // linger forever as an orphan after the map entry is dropped.
    close() { try { q.close(); } catch { /* noop */ } },
    // Bu sessiya almashtirilayotganini unga ulangan BOSHQA klientlarga
    // bildiradi.
    //
    // Avval bu yo'q edi va quyidagi jimgina buzilish bor edi: telefonda
    // "chatni tozalash" bosilsa (yoki loyiha o'chirilsa), kompyuterdagi ochiq
    // tab hali ham `q.close()` qilingan ESKI sessiya obyektiga ishora qilib
    // turardi. U yerdan yuborilgan xabar o'lik `messageQueue`ga tushib
    // **yo'qolardi**, `busy` esa `true` bo'lib qotib qolardi — foydalanuvchi
    // hech qanday xato ko'rmasdi, shunchaki Claude "javob bermayotgandek"
    // tuyulardi.
    invalidate() {
      broadcast({ type: 'session_invalidated' });
      clients.clear();
    },
    // SDK'ning eksperimental "/usage" ma'lumoti — Claude ilovasidagi 5-soatlik
    // va haftalik limit foizini beradi. Nomi ham ogohlantirganidek beqaror
    // (o'zgarishi/olib tashlanishi mumkin) — shuning uchun try/catch bilan
    // himoyalangan, null qaytsa client "mavjud emas" holatini ko'rsatadi.
    async getRateLimits() {
      try {
        return await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
      } catch {
        return null;
      }
    },
    setPermissionMode(mode) {
      return q.setPermissionMode(mode).then(() => {
        permissionMode = mode;
        // emit() -> record() already persists sessionsMeta with the new
        // permissionMode included, no separate write needed here.
        emit({ type: 'permission_mode', mode });
      });
    },
    status() {
      return { busy, pending: pendingPermissions.size + pendingQuestions.size };
    },
    snapshot() {
      return {
        cwd: cwdResolved,
        sessionId: sdkSessionId,
        busy,
        permissionMode,
        usage: { inputTokens: cumulativeInputTokens, outputTokens: cumulativeOutputTokens, totalCostUsd },
        // Drop permission/question requests that were already answered so a
        // reconnecting client doesn't see a stale, dead prompt.
        history: history.filter((e) =>
          (e.type !== 'permission_request' || pendingPermissions.has(e.id)) &&
          (e.type !== 'question_request' || pendingQuestions.has(e.id))),
      };
    },
  };

  sessions.set(projectId, session);
  return session;
}

function getOrCreateSession(projectId, cwd, description) {
  return sessions.get(projectId) || createSession(projectId, cwd, description);
}

// Drops the in-memory conversation AND its persisted sdkSessionId, so the
// next getOrCreateSession() call starts a brand new Claude Agent SDK query
// (empty history, no prior context, no resume) — used by the "chatni
// tozalash" button. Must clear the disk pointer too, otherwise a restart
// after "clear chat" would resurrect the very conversation just cleared.
//
// Uses close(), NOT interrupt(): interrupt() only stops the current turn and
// leaves the session (and its `claude` CLI subprocess) alive — since we're
// about to drop the map entry anyway, that process would become unreachable
// but still running forever (an orphan holding ~300-400MB RAM until the
// whole rootweb server restarts). close() actually kills the subprocess.
function resetSession(projectId) {
  const session = sessions.get(projectId);
  if (session) {
    // Avval xabar berib, keyin yopamiz — aks holda hali ulangan klientlar
    // o'lik sessiyaga xabar yuborishda davom etadi (yuqoridagi `invalidate`
    // izohiga qara).
    session.invalidate();
    session.close();
    sessions.delete(projectId);
  }
  clearSessionMeta(projectId);
  // Umumiy voqea nomi — "chatni tozalash" va "loyihani o'chirish" ikkalasi
  // ham buni chaqiradi, ular index.js darajasida o'zlarining aniqroq
  // ('chat_cleared' / 'project_deleted') audit yozuvini alohida qo'shadi.
  auditLog.log('session_reset', { projectId });
}

// Read-only status lookup that never creates a session - used to badge
// projects that haven't been touched yet without spinning up an SDK
// conversation just to check on them.
function getStatus(projectId) {
  const session = sessions.get(projectId);
  return session ? session.status() : { busy: false, pending: 0 };
}

// `extractToolOutput`/`clampOutput` test uchun ham eksport qilinadi
// (`test/toolOutput.test.js`) — ular tool natijasi ko'rsatilishining asosi.
module.exports = { getOrCreateSession, getStatus, resetSession, extractToolOutput, clampOutput };
