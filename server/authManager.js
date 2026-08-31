// Claude hisobini ("claude auth login") saytning o'zidan ulash imkonini beradi —
// SSH/terminal shart emas. `script` buyrug'i orqali haqiqiy pty (terminal)
// simulyatsiya qilinadi, chunki `claude auth login` kod kiritishni faqat
// haqiqiy terminalda qabul qiladi (oddiy pipe orqali ishlamaydi).
const { spawn } = require('child_process');
const path = require('path');

const CLAUDE_BIN = path.join(
  __dirname, '..', 'node_modules', '@anthropic-ai',
  'claude-agent-sdk-linux-x64', 'claude',
);

let state = null;

function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function start() {
  if (state && !state.done) return getState();

  state = { proc: null, output: '', done: false, success: false };

  const proc = spawn('script', ['-qec', `${CLAUDE_BIN} auth login --claudeai`, '/dev/null'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
  });
  state.proc = proc;

  proc.stdout.on('data', (d) => { state.output += d.toString('utf8'); });
  proc.stderr.on('data', (d) => { state.output += d.toString('utf8'); });
  proc.on('exit', (code) => {
    state.done = true;
    state.success = code === 0;
  });
  proc.on('error', (err) => {
    state.output += `\n[xatolik: ${err.message}]`;
    state.done = true;
    state.success = false;
  });

  return getState();
}

function submitCode(code) {
  if (!state || !state.proc || state.done) {
    throw new Error("Login jarayoni ishlamayapti — avval 'Boshlash' tugmasini bosing");
  }
  state.proc.stdin.write(`${code}\r`);
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
