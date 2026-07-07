const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS_FILE = path.join(__dirname, '..', 'data', '.mcp-keys.json');

function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) return [];
  return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
}

function saveKeys(keys) {
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// 대시보드에 노출되는 목록 — 해시는 제외
function listKeys() {
  return loadKeys().map(({ hash, ...rest }) => rest);
}

// 발급 시점에만 평문 키를 반환하고, 저장소에는 해시만 남긴다 (재발급/재조회 불가)
function createKey(label) {
  const rawKey = 'atk_' + crypto.randomBytes(24).toString('hex');
  const keys = loadKeys();
  const entry = {
    id: crypto.randomUUID(),
    label: (label || '').trim() || '(이름 없음)',
    hash: hashKey(rawKey),
    last4: rawKey.slice(-4),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  keys.push(entry);
  saveKeys(keys);
  return { ...entry, rawKey };
}

function revokeKey(id) {
  const keys = loadKeys();
  const next = keys.filter(k => k.id !== id);
  if (next.length === keys.length) return false;
  saveKeys(next);
  return true;
}

function verifyKey(rawKey) {
  if (!rawKey) return null;
  const hash = hashKey(rawKey);
  const keys = loadKeys();
  const found = keys.find(k => k.hash === hash);
  if (!found) return null;
  found.lastUsedAt = new Date().toISOString();
  saveKeys(keys);
  const { hash: _drop, ...safe } = found;
  return safe;
}

module.exports = { listKeys, createKey, revokeKey, verifyKey };
