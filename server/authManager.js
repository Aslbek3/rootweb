// Claude hisobini ("claude auth login") saytning o'zidan ulash imkonini beradi —
// SSH/terminal shart emas. `script` buyrug'i orqali haqiqiy pty (terminal)
// simulyatsiya qilinadi, chunki `claude auth login` kod kiritishni faqat
// haqiqiy terminalda qabul qiladi (oddiy pipe orqali ishlamaydi).

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Avval bu yo'l `claude-agent-sdk-linux-x64` deb qattiq yozilgan edi — arm64
// VPS'da yoki SDK binarni boshqa joyga qo'yganda ishlamay qolardi. Endi
// `@anthropic-ai` ichidan mos platforma paketi topiladi, topilmasa PATH'dagi
// `claude` ishlatiladi.
function resolveClaudeBin() {
  const scope = path.join(__dirname, '..', 'node_modules', '@anthropic-ai');
  try {
    for (const dir of fs.readdirSync(scope)) {
      if (!dir.startsWith('claude-agent-sdk-')) continue;
      const candidate = path.join(scope, dir, 'claude');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* node_modules yo'q bo'lsa pastdagi zaxiraga tushamiz */ }
  return 'claude';
}

// Chiqish cheksiz o'smasin (osilib qolgan jarayon xotirani yeb qo'ymasin).
const MAX_OUTPUT_CHARS = 64 * 1024;
// Login jarayoni shuncha vaqtda tugamasa majburan to'xtatiladi. Avval timeout
// yo'q edi va `if (state && !state.done) return getState()` sharti tufayli
// osilgan jarayon butun funksiyani server restartigacha bloklab qo'yardi.
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

let state = null;

function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function appendOutput(chunk) {
  state.output += chunk;
  if (state.output.length > MAX_OUTPUT_CHARS) {
    state.output = state.output.slice(-MAX_OUTPUT_CHARS);
  }
}

function finish(success) {
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  state.done = true;
  state.success = success;
}

function start() {
  if (state && !state.done) return getState();

  state = { proc: null, output: '', done: false, success: false, timer: null };

  const proc = spawn('script', ['-qec', `${resolveClaudeBin()} auth login --claudeai`, '/dev/null'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
  });
  state.proc = proc;

  proc.stdout.on('data', (d) => appendOutput(d.toString('utf8')));
  proc.stderr.on('data', (d) => appendOutput(d.toString('utf8')));
  proc.on('exit', (code) => finish(code === 0));
  proc.on('error', (err) => {
    appendOutput(`\n[xatolik: ${err.message}]`);
    finish(false);
  });

  state.timer = setTimeout(() => {
    if (state.done) return;
    appendOutput('\n[vaqt tugadi — jarayon to\'xtatildi]');
    try { proc.kill('SIGKILL'); } catch { /* allaqachon o'lgan bo'lishi mumkin */ }
    finish(false);
  }, LOGIN_TIMEOUT_MS);
  if (state.timer.unref) state.timer.unref();

  return getState();
}

function submitCode(code) {
  if (!state || !state.proc || state.done) {
    throw new Error("Login jarayoni ishlamayapti — avval 'Boshlash' tugmasini bosing");
  }
  // Faqat bitta qator yuboriladi: kod ichidagi yangi qator belgilari
  // olib tashlanadi, aks holda pty'ga qo'shimcha "Enter"lar tushib,
  // CLI'ning keyingi savollariga tasodifiy javob berilib qolishi mumkin.
  state.proc.stdin.write(`${String(code).replace(/[\r\n]+/g, '')}\r`);
}

function getState() {
  if (!state) return { running: false, output: '', done: false, success: false };
  return {
    running: !state.done,
    output: stripAnsi(state.output),
    done: state.done,
    success: state.success,
  };
}

module.exports = { start, submitCode, getState };
