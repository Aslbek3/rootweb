const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'projects.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(items) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));
}

function list() {
  return load().sort((a, b) => b.lastUsed - a.lastUsed);
}

function getById(id) {
  return load().find((p) => p.id === id) || null;
}

// Adds the project only if it isn't already known. Used at startup so the
// configured PROJECT_DIR always shows up, without resetting its lastUsed
// (and therefore its position) on every restart.
function seed(absPath, label) {
  const resolved = path.resolve(absPath);
  const items = load();
  if (items.find((p) => p.path === resolved)) return;
  items.push({ id: crypto.randomUUID(), path: resolved, label: label || path.basename(resolved), description: '', pm2Name: '', lastUsed: Date.now() });
  save(items);
}

// `description` — Claude'ga har safar yangi sessiya boshlanganda avtomatik
// uzatiladigan qisqa kontekst (masalan "poster-02, @avtopost3_bot, ..."),
// `pm2Name` — shu loyihaga bog'liq PM2 process nomi (bo'lsa, "botlar"
// panelida loyiha bilan bog'lab status ko'rsatish uchun). Ikkisi ham
// ixtiyoriy — bo'sh qoldirilsa avvalgi xatti-harakat o'zgarmaydi.
function upsert(rawPath, label, description, pm2Name) {
  const resolved = path.resolve(rawPath);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error("Bu yo'l papka emas");

  const items = load();
  let entry = items.find((p) => p.path === resolved);
  if (entry) {
    entry.lastUsed = Date.now();
    if (label) entry.label = label;
    if (typeof description === 'string') entry.description = description;
    if (typeof pm2Name === 'string') entry.pm2Name = pm2Name;
  } else {
    entry = {
      id: crypto.randomUUID(),
      path: resolved,
      label: label || path.basename(resolved),
      description: typeof description === 'string' ? description : '',
      pm2Name: typeof pm2Name === 'string' ? pm2Name : '',
      lastUsed: Date.now(),
    };
    items.push(entry);
  }
  save(items);
  return entry;
}

const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

// Creates `name` as a fresh subfolder of `parentPath` (idempotent if it
// already exists as a directory) and registers it as a project.
function createAndAdd(parentPath, name, label, description, pm2Name) {
  if (!name || INVALID_NAME_CHARS.test(name) || name === '.' || name === '..') {
    throw new Error("Papka nomi noto'g'ri (\\ / : * ? \" < > | yoki .. bo'lmasin)");
  }
  const parentResolved = path.resolve(parentPath);
  if (!fs.existsSync(parentResolved) || !fs.statSync(parentResolved).isDirectory()) {
    throw new Error("Ota papka topilmadi");
  }
  const target = path.join(parentResolved, name);
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) throw new Error('Shu nomda fayl allaqachon mavjud');
  } else {
    fs.mkdirSync(target, { recursive: true });
  }
  return upsert(target, label || name, description, pm2Name);
}

function touch(id) {
  const items = load();
  const entry = items.find((p) => p.id === id);
  if (entry) {
    entry.lastUsed = Date.now();
    save(items);
  }
  return entry;
}

function remove(id) {
  const items = load().filter((p) => p.id !== id);
  save(items);
}

module.exports = { list, getById, seed, upsert, createAndAdd, touch, remove };
