const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { query } = require('@anthropic-ai/claude-agent-sdk');

// Tool calls that are read-only / low-risk are auto-approved so a phone
// session isn't interrupted by a permission prompt on every file read.
// Everything else (Write, Edit, Bash, WebFetch, ...) always asks first.
const SAFE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'TodoWrite']);

// Auto-approved on top of SAFE_TOOLS only while permissionMode === 'acceptEdits'
// ("avto" rejim) — file-edit tools, plus non-destructive Bash commands (see
// isDangerousBash below). Anything else still asks.
const EDIT_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

// Bash command patterns that must always ask for confirmation, even in
// "avto" mode — destructive deletes, privilege escalation, pipe-to-shell,
// force-push, raw-device writes, etc. Everything that does NOT match one of
// these is treated as "safe enough" to auto-run in acceptEdits mode (mirrors
// an allowlisted-but-still-guarded Bash tool, not a fully open one).
const DANGEROUS_BASH_PATTERNS = [
  /\bsudo\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&?\s*\}\s*;\s*:/, // fork bomb
  /chmod\s+(-R\s+)?0?777\b/,
  /chown\s+-R\b/,
  /(curl|wget)\b[^|;&\n]*\|\s*(sh|bash|zsh)\b/, // pipe-to-shell
  /git\s+push\b[^|;&\n]*(--force\b|-f\b)/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bkillall\b|kill\s+-9\s+1\b/,
  /\b(iptables|ufw|firewall-cmd)\b/,
  />>?\s*\/etc\//,
  /\bcrontab\s+-r\b/,
  /--no-preserve-root/,

  // --- faqat rootweb: bu jarayon ROOT sifatida ishlaydi, hech qanday
  // qamoq yo'q — boshqa ishlab turgan botlarni yiqitishi, umumiy ma'lumotni
  // yo'q qilishi yoki masofaviy kirish xavfsizligiga ta'sir qilishi mumkin
  // bo'lgan narsalar claudeweb'da "xavfsiz" ko'rinsa ham bu yerda so'raladi.
  /\bpm2\s+(delete|stop|kill)\b/,
  /\bdocker\s+(rm|rmi|kill|stop)\b/,
  /\bdocker(-compose)?\s+(down|system\s+prune)\b/,
  /\b(systemctl|service)\s+\S*\s*(stop|disable|mask)\b/,
  /\bnginx\s+-s\s+(stop|quit)\b/,
  /\bcertbot\s+(delete|revoke)\b/,
  /\b(useradd|userdel|usermod|passwd)\b/,
  /authorized_keys\b/,
  /\/etc\/ssh\//,
  /\bDROP\s+(DATABASE|TABLE|SCHEMA)\b/i,
  /\bflush(all|db)\b/i,
  /\bapt(-get)?\s+(remove|purge|autoremove)\b/,
  /\b(fdisk|parted|wipefs)\b/,
];

function isDangerousBash(command) {
  if (typeof command !== 'string' || !command.trim()) return true; // shakli noaniq -> ehtiyot bo'lib so'raladi
  if (DANGEROUS_BASH_PATTERNS.some((re) => re.test(command))) return true;
  // rm force+recursive: checked separately (not one regex) so "rm -r -f",
  // "rm --recursive --force" and "rm -rf" are all caught regardless of how
  // the flags are grouped.
  if (/\brm\b/.test(command)) {
    const hasRecursive = /-[a-zA-Z]*[rR][a-zA-Z]*\b/.test(command) || /--recursive\b/.test(command);
    const hasForce = /-[a-zA-Z]*f[a-zA-Z]*\b/.test(command) || /--force\b/.test(command);
    if (hasRecursive && hasForce) return true;
  }
  return false;
}

// How many past events to keep for replay when a client (re)connects.
const MAX_HISTORY = 500;

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
// waiting for a new message. Full rewrite on every save — history is capped
// at MAX_HISTORY and carries no image bytes (see pushUserMessage), so even
// with several open projects this file stays small.
const SESSIONS_META_FILE = path.join(__dirname, 'data', 'sessions_meta.json');

function loadSessionsMeta() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_META_FILE, 'utf8'));
  } catch {
    return {};
  }
}

let sessionsMeta = loadSessionsMeta();

function saveSessionsMeta() {
  try {
    const tmp = `${SESSIONS_META_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(sessionsMeta));
    fs.renameSync(tmp, SESSIONS_META_FILE); // atomic swap — a kill mid-write can't corrupt the real file
  } catch (err) {
    console.error('sessions_meta.json saqlashda xato:', err && err.message);
  }
}

function persistSessionMeta(projectId, data) {
  sessionsMeta[projectId] = data;
  saveSessionsMeta();
}

function clearSessionMeta(projectId) {
  if (!(projectId in sessionsMeta)) return;
  delete sessionsMeta[projectId];
  saveSessionsMeta();
}

function createSession(projectId, cwd) {
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
  let permissionMode = 'acceptEdits';
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
      permissionMode: 'default',
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
          if (toolName === 'Bash' && !isDangerousBash(input && input.command)) {
            return { behavior: 'allow', updatedInput: input };
          }
        }
        const id = opts.toolUseID || crypto.randomUUID();
        emit({ type: 'permission_request', id, name: toolName, input });
        return new Promise((resolve) => pendingPermissions.set(id, resolve));
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
              emit({ type: 'tool_result', id: block.tool_use_id, isError: !!block.is_error });
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
      const resolver = pendingPermissions.get(id);
      if (!resolver) return;
      pendingPermissions.delete(id);
      resolver(approve
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

function getOrCreateSession(projectId, cwd) {
  return sessions.get(projectId) || createSession(projectId, cwd);
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
    session.close();
    sessions.delete(projectId);
  }
  clearSessionMeta(projectId);
}

// Read-only status lookup that never creates a session - used to badge
// projects that haven't been touched yet without spinning up an SDK
// conversation just to check on them.
function getStatus(projectId) {
  const session = sessions.get(projectId);
  return session ? session.status() : { busy: false, pending: 0 };
}

module.exports = { getOrCreateSession, getStatus, resetSession };
