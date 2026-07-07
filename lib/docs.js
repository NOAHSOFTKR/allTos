const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// 클라우드 동기화 드라이브(OneDrive 등)의 플레이스홀더 파일처럼 실제 읽기가
// 오래 걸리는 경우, 요청 하나 때문에 서버 전체가 무한정 멈추지 않도록 상한을 둔다.
const READ_TIMEOUT_MS = 10_000;

// tos/pp는 meta.json 선언 없이도 파일만 있으면 자동 노출됨
const DEFAULT_DOCS = { tos: '이용약관', pp: '개인정보처리방침' };

// botId/type은 그대로 path.join에 들어가므로, "../"나 절대경로가 섞이면
// data/ 밖의 파일을 읽거나 쓸 수 있다 (경로 순회). 영문/숫자/-/_ 만 허용해 차단한다.
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

function assertSafeSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    throw new Error(`잘못된 ${label}입니다: 영문/숫자/-/_ 만 허용됩니다 (받은 값: ${JSON.stringify(value)})`);
  }
}

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
  assertSafeSegment(botId, 'botId');
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
  assertSafeSegment(botId, 'botId');
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
    if (seen.has(key) || !SAFE_SEGMENT.test(key)) continue;
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
  assertSafeSegment(botId, 'botId');
  return pathExists(path.join(DATA_DIR, botId));
}

async function readDoc(botId, type) {
  assertSafeSegment(botId, 'botId');
  assertSafeSegment(type, '문서 타입(type)');
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

// 봇 메타(이름/설명/최종수정일)를 생성하거나 병합 수정한다. 봇 폴더가 없으면 새로 만든다.
// docs 필드는 여기서 직접 받지 않는다 — upsertDoc/deleteDoc을 통해서만 안전하게(키 검증 후) 갱신된다.
async function upsertBotMeta(botId, updates) {
  assertSafeSegment(botId, 'botId');
  const dir = path.join(DATA_DIR, botId);
  await fsp.mkdir(dir, { recursive: true });

  const existing = await getMeta(botId);
  const merged = { ...existing, ...updates };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }

  await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

// tos/pp 또는 커스텀 문서를 생성/덮어쓴다. 새 커스텀 문서는 label이 있어야
// meta.json의 docs에 선언되어 노출된다 (기존 커스텀 문서는 label 생략 시 라벨 유지).
async function upsertDoc(botId, type, content, label) {
  assertSafeSegment(botId, 'botId');
  assertSafeSegment(type, '문서 타입(type)');
  if (typeof content !== 'string') {
    throw new Error('content는 문자열(마크다운 원문)이어야 합니다.');
  }

  const dir = path.join(DATA_DIR, botId);
  await fsp.mkdir(dir, { recursive: true });

  const isDefault = Object.prototype.hasOwnProperty.call(DEFAULT_DOCS, type);
  let resolvedLabel = isDefault ? DEFAULT_DOCS[type] : label;

  if (!isDefault) {
    const meta = await getMeta(botId);
    const docs = { ...(meta.docs || {}) };
    if (!docs[type] && !label) {
      throw new Error(
        `커스텀 문서 "${type}"를 새로 만들려면 label을 함께 지정해야 합니다 (meta.json의 docs에 선언되어야 노출됩니다).`
      );
    }
    if (label) docs[type] = label;
    resolvedLabel = docs[type];
    await upsertBotMeta(botId, { docs });
  }

  await fsp.writeFile(path.join(dir, `${type}.md`), content, 'utf8');
  return { botId, type, label: resolvedLabel };
}

// 문서를 삭제한다. 커스텀 문서면 meta.json의 docs 선언도 함께 제거한다.
async function deleteDoc(botId, type) {
  assertSafeSegment(botId, 'botId');
  assertSafeSegment(type, '문서 타입(type)');

  const filePath = path.join(DATA_DIR, botId, `${type}.md`);
  const existed = await pathExists(filePath);
  if (existed) await fsp.unlink(filePath);

  const isDefault = Object.prototype.hasOwnProperty.call(DEFAULT_DOCS, type);
  if (!isDefault) {
    const meta = await getMeta(botId);
    if (meta.docs && type in meta.docs) {
      const docs = { ...meta.docs };
      delete docs[type];
      await upsertBotMeta(botId, { docs });
    }
  }
  return existed;
}

// 봇 전체(폴더 통째로)를 삭제한다. 되돌릴 수 없다.
async function deleteBot(botId) {
  assertSafeSegment(botId, 'botId');
  const dir = path.join(DATA_DIR, botId);
  if (!(await pathExists(dir))) return false;
  await fsp.rm(dir, { recursive: true, force: true });
  return true;
}

module.exports = {
  DATA_DIR,
  DEFAULT_DOCS,
  getMeta,
  getDocs,
  getBots,
  botExists,
  readDoc,
  upsertBotMeta,
  upsertDoc,
  deleteDoc,
  deleteBot,
};
