const express = require('express');
const { marked } = require('marked');
const { getMeta, getDocs, getBots, botExists, readDoc } = require('./lib/docs');

const app = express();
const PORT = 50000;

function docIcon(key) {
  if (key === 'tos') return '📄';
  if (key === 'pp') return '🔒';
  return '📎';
}

// Express 4는 async 핸들러의 reject를 자동으로 못 잡아서, next(err)로 넘겨주는 래퍼
function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f13; color: #e2e8f0; min-height: 100vh; }
    a { color: #7c8cff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    header { background: #16161e; border-bottom: 1px solid #2d2d3d; padding: 16px 32px; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 1.1rem; font-weight: 600; color: #fff; }
    header a { color: #94a3b8; font-size: 0.85rem; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
    .hero { margin-bottom: 40px; }
    .hero h2 { font-size: 1.8rem; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .hero p { color: #94a3b8; font-size: 0.95rem; }
    .card { background: #16161e; border: 1px solid #2d2d3d; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
    .card-title { font-size: 1.05rem; font-weight: 600; color: #fff; margin-bottom: 4px; }
    .card-desc { color: #64748b; font-size: 0.85rem; margin-bottom: 16px; }
    .card-meta { font-size: 0.75rem; color: #475569; margin-bottom: 14px; }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; font-weight: 500; border: 1px solid transparent; }
    .badge-doc { background: #1e293b; border-color: #334155; color: #94a3b8; }
    .badge:hover { background: #252836; color: #fff; }
    .raw-badge { background: #111827; border-color: #1f2937; color: #6b7280; font-size: 0.72rem; padding: 4px 10px; }
    .content { background: #16161e; border: 1px solid #2d2d3d; border-radius: 12px; padding: 40px; }
    .content h1 { font-size: 1.6rem; color: #fff; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #2d2d3d; }
    .content h2 { font-size: 1.1rem; color: #e2e8f0; margin: 28px 0 10px; }
    .content h3 { font-size: 0.95rem; color: #cbd5e1; margin: 20px 0 8px; }
    .content p { color: #94a3b8; line-height: 1.75; margin-bottom: 12px; font-size: 0.93rem; }
    .content ul, .content ol { color: #94a3b8; padding-left: 20px; margin-bottom: 12px; line-height: 1.75; font-size: 0.93rem; }
    .content li { margin-bottom: 4px; }
    .content strong { color: #e2e8f0; }
    .doc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; flex-wrap: wrap; gap: 12px; }
    .doc-header h2 { font-size: 1.3rem; color: #fff; font-weight: 700; }
    .doc-actions { display: flex; gap: 8px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 7px; font-size: 0.8rem; font-weight: 500; cursor: pointer; border: 1px solid #2d2d3d; background: #1e293b; color: #94a3b8; }
    .btn:hover { background: #252836; color: #fff; text-decoration: none; }
    .btn-active { background: #252836; color: #fff; border-color: #4a5568; }
    footer { text-align: center; padding: 40px 24px; color: #334155; font-size: 0.78rem; }
  </style>
</head>
<body>
  <header>
    <a href="/">← 홈</a>
    <h1>Noahsoft · 봇 정책 허브</h1>
  </header>
  <div class="container">${body}</div>
  <footer>Noahsoft Bot Policy Hub</footer>
</body>
</html>`;
}

// 홈 — 봇 목록
app.get('/', asyncRoute(async (req, res) => {
  const bots = await getBots();
  const cards = bots.map(bot => {
    const badges = bot.docs.map(doc =>
      `<a class="badge badge-doc" href="/${bot.id}/${doc.key}">${docIcon(doc.key)} ${doc.label}</a><a class="badge raw-badge" href="/${bot.id}/${doc.key}/raw">RAW</a>`
    ).join('');
    return `
    <div class="card">
      <div class="card-title">${bot.name}</div>
      <div class="card-desc">${bot.description || ''}</div>
      ${bot.lastUpdated ? `<div class="card-meta">최종 업데이트: ${bot.lastUpdated}</div>` : ''}
      <div class="badges">${badges || '<span style="color:#475569;font-size:0.85rem">등록된 문서가 없습니다</span>'}</div>
    </div>`;
  }).join('');

  const body = `
    <div class="hero">
      <h2>봇 정책 허브</h2>
      <p>Noahsoft 봇들의 이용약관(TOS)과 개인정보처리방침(PP)을 확인하세요.</p>
    </div>
    ${cards || '<div class="card"><p style="color:#64748b">등록된 봇이 없습니다.</p></div>'}`;

  res.send(page('Noahsoft 봇 정책 허브', body));
}));

// 문서 렌더링 — /:botname/:type (tos/pp는 자동 노출, 그 외는 meta.json의 docs에 선언되어야 함)
app.get('/:botname/:type', asyncRoute(async (req, res, next) => {
  const { botname, type } = req.params;
  if (!(await botExists(botname))) return next();

  const docs = await getDocs(botname);
  const doc = docs.find(d => d.key === type);
  if (!doc) {
    return res.status(404).send(page('404', `<div class="card"><h2 style="color:#fff;margin-bottom:8px">404 — 문서를 찾을 수 없습니다</h2><p style="color:#64748b">봇 <strong>${botname}</strong>의 <strong>${type}</strong> 문서가 존재하지 않거나 meta.json에 선언되지 않았습니다.</p></div>`));
  }

  const meta = await getMeta(botname);
  const { content } = await readDoc(botname, type);
  const html = marked(content);
  const otherDocs = docs.filter(d => d.key !== type);

  const body = `
    <div class="doc-header">
      <h2>${meta.name} · ${doc.label}</h2>
      <div class="doc-actions">
        ${otherDocs.map(d => `<a class="btn" href="/${botname}/${d.key}">${d.label}</a>`).join('')}
        <a class="btn" href="/${botname}/${type}/raw">RAW</a>
      </div>
    </div>
    <div class="content">${html}</div>`;

  res.send(page(`${meta.name} ${doc.label}`, body));
}));

// RAW 마크다운 — /:botname/:type/raw
app.get('/:botname/:type/raw', asyncRoute(async (req, res, next) => {
  const { botname, type } = req.params;
  if (!(await botExists(botname))) return next();

  const doc = await readDoc(botname, type);
  if (!doc) {
    return res.status(404).type('text').send(`404: ${botname}/${type}.md not found or not declared in meta.json`);
  }

  res.type('text/plain; charset=utf-8').send(doc.content);
}));

// 404
app.use((req, res) => {
  res.status(404).send(page('404', '<div class="card"><h2 style="color:#fff;margin-bottom:8px">404 — 페이지를 찾을 수 없습니다</h2><p style="color:#64748b">요청하신 페이지가 존재하지 않습니다.</p></div>'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('요청 처리 오류:', err);
  res.status(504).send(page('504', `<div class="card"><h2 style="color:#fff;margin-bottom:8px">504 — 응답 지연</h2><p style="color:#64748b">${err.message || '문서를 읽는 중 시간이 초과되었습니다.'}</p></div>`));
});

app.listen(PORT, () => {
  console.log(`✅  서버 실행 중 → http://localhost:${PORT}`);
});
