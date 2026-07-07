const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// 클라우드 동기화 드라이브(OneDrive 등)의 플레이스홀더 파일처럼 실제 읽기가
// 오래 걸리는 경우, 요청 하나 때문에 서버 전체가 무한정 멈추지 않도록 상한을 둔다.
const READ_TIMEOUT_MS = 10_000;

// tos/pp는 meta.json 선언 없이도 파일만 있으면 자동 노출됨
const DEFAULT_DOCS = { tos: '이용약관', pp: '개인정보처리방침' };

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function getMeta(botId) {
  const metaPath = path.join(DATA_DIR, botId, 'meta.json');
  if (!(await pathExists(metaPath))) return { name: botId };
  const raw = await withTimeout(
    fsp.readFile(metaPath, 'utf8'),
    READ_TIMEOUT_MS,
    `meta.json 읽기 타임아웃: ${botId}`
  );
  return JSON.parse(raw);
}

// tos/pp 외 문서는 meta.json의 "docs" 객체에 { key: 라벨 } 로 선언해야만 노출됨
async function getDocs(botId) {
  const meta = await getMeta(botId);
  const customDocs = meta.docs || {};
  const docs = [];
  const seen = new Set();

  for (const [key, label] of Object.entries(DEFAULT_DOCS)) {
    if (await pathExists(path.join(DATA_DIR, botId, `${key}.md`))) {
      docs.push({ key, label });
      seen.add(key);
    }
  }
  for (const [key, label] of Object.entries(customDocs)) {
    if (seen.has(key)) continue;
    if (await pathExists(path.join(DATA_DIR, botId, `${key}.md`))) {
      docs.push({ key, label });
      seen.add(key);
    }
  }
  return docs;
}

async function getBots() {
  if (!(await pathExists(DATA_DIR))) return [];
  const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
  const dirs = entries.filter(d => d.isDirectory());
  return Promise.all(
    dirs.map(async d => {
      const meta = await getMeta(d.name);
      return {
        id: d.name,
        name: meta.name || d.name,
        description: meta.description || '',
        lastUpdated: meta.lastUpdated || '',
        docs: await getDocs(d.name),
      };
    })
  );
}

function botExists(botId) {
  return pathExists(path.join(DATA_DIR, botId));
}

async function readDoc(botId, type) {
  const docs = await getDocs(botId);
  const doc = docs.find(d => d.key === type);
  if (!doc) return null;
  const filePath = path.join(DATA_DIR, botId, `${type}.md`);
  const content = await withTimeout(
    fsp.readFile(filePath, 'utf8'),
    READ_TIMEOUT_MS,
    `"${botId}/${type}.md" 읽기 타임아웃 (${READ_TIMEOUT_MS / 1000}초) — 클라우드 동기화 드라이브의 플레이스홀더 파일일 가능성이 있습니다`
  );
  return { ...doc, content };
}

module.exports = { DATA_DIR, DEFAULT_DOCS, getMeta, getDocs, getBots, botExists, readDoc };
