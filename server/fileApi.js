const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 512 * 1024;
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'venv', '.venv']);

// Resolves `rel` against `root` and throws if the result would escape root
// (blocks ../ traversal outside the selected project).
function resolveWithin(root, rel) {
  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, rel || '.');
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error("Ruxsat etilmagan yo'l");
  }
  return target;
}

function listDir(root, rel) {
  const dirPath = resolveWithin(root, rel);
  const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
  return dirents
    .filter((d) => !(d.isDirectory() && IGNORE_DIRS.has(d.name)))
    .filter((d) => !d.name.startsWith('.'))
    .map((d) => {
      const type = d.isDirectory() ? 'dir' : 'file';
      let size = 0;
      if (type === 'file') {
        try { size = fs.statSync(path.join(dirPath, d.name)).size; } catch { /* ignore */ }
      }
      return { name: d.name, type, size };
    })
    .sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
}

function readFileSafe(root, rel) {
  const filePath = resolveWithin(root, rel);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Bu yo\'l fayl emas');
  if (stat.size > MAX_FILE_BYTES) return { tooLarge: true, size: stat.size };
  const buf = fs.readFileSync(filePath);
  if (buf.includes(0)) return { binary: true, size: stat.size };
  return { content: buf.toString('utf8'), size: stat.size };
}

function mkdir(root, rel, name) {
  if (typeof name !== 'string' || !name.trim() || /[\\/]/.test(name) || name === '.' || name === '..') {
    throw new Error("Noto'g'ri papka nomi");
  }
  const dirPath = resolveWithin(root, rel);
  const target = path.join(dirPath, name.trim());
  if (fs.existsSync(target)) {
    throw new Error('Bu nomda fayl yoki papka allaqachon mavjud');
  }
  fs.mkdirSync(target);
  return { name: name.trim() };
}

function writeFileSafe(root, rel, content) {
  const filePath = resolveWithin(root, rel);
  if (fs.existsSync(filePath) && !fs.statSync(filePath).isFile()) {
    throw new Error('Bu yo\'l fayl emas');
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
    throw new Error("Fayl juda katta (512KB dan oshmasin)");
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return { size: Buffer.byteLength(content, 'utf8') };
}

function deleteEntry(root, rel) {
  const target = resolveWithin(root, rel);
  if (target === path.resolve(root)) {
    throw new Error("Ildiz papkani o'chirib bo'lmaydi");
  }
  fs.rmSync(target, { recursive: true, force: false });
}

function renameEntry(root, rel, newName) {
  if (typeof newName !== 'string' || !newName.trim() || /[\\/]/.test(newName) || newName === '.' || newName === '..') {
    throw new Error("Noto'g'ri nom");
  }
  const source = resolveWithin(root, rel);
  const dest = path.join(path.dirname(source), newName.trim());
  if (fs.existsSync(dest)) {
    throw new Error('Bu nomda fayl yoki papka allaqachon mavjud');
  }
  fs.renameSync(source, dest);
  return { name: newName.trim() };
}

module.exports = { listDir, readFileSafe, writeFileSafe, mkdir, deleteEntry, renameEntry, resolveWithin };
