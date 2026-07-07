const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// tos/pp는 meta.json 선언 없이도 파일만 있으면 자동 노출됨
const DEFAULT_DOCS = { tos: '이용약관', pp: '개인정보처리방침' };

function getMeta(botId) {
  const metaPath = path.join(DATA_DIR, botId, 'meta.json');
  return fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : { name: botId };
}

// tos/pp 외 문서는 meta.json의 "docs" 객체에 { key: 라벨 } 로 선언해야만 노출됨
function getDocs(botId) {
  const meta = getMeta(botId);
  const customDocs = meta.docs || {};
  const docs = [];
  const seen = new Set();

  for (const [key, label] of Object.entries(DEFAULT_DOCS)) {
    if (fs.existsSync(path.join(DATA_DIR, botId, `${key}.md`))) {
      docs.push({ key, label });
      seen.add(key);
    }
  }
  for (const [key, label] of Object.entries(customDocs)) {
    if (seen.has(key) || !fs.existsSync(path.join(DATA_DIR, botId, `${key}.md`))) continue;
    docs.push({ key, label });
    seen.add(key);
  }
  return docs;
}

function getBots() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const meta = getMeta(d.name);
      return {
        id: d.name,
        name: meta.name || d.name,
        description: meta.description || '',
        lastUpdated: meta.lastUpdated || '',
        docs: getDocs(d.name),
      };
    });
}

function botExists(botId) {
  return fs.existsSync(path.join(DATA_DIR, botId));
}

function readDoc(botId, type) {
  const doc = getDocs(botId).find(d => d.key === type);
  if (!doc) return null;
  const filePath = path.join(DATA_DIR, botId, `${type}.md`);
  return { ...doc, content: fs.readFileSync(filePath, 'utf8') };
}

module.exports = { DATA_DIR, DEFAULT_DOCS, getMeta, getDocs, getBots, botExists, readDoc };
