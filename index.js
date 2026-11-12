const express = require('express');
const { Marked } = require('marked');
const { getMeta, getDocs, getBots, botExists, readDoc } = require('./lib/docs');

const app = express();
const PORT = 50000;

// canonical/og:url 에 쓰는 공개 주소. 기존 문서들이 서로를 https://noahsoft.kr/tos/... 로 링크하고 있어 기본값으로 둔다.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://noahsoft.kr').replace(/\/+$/, '');

// 사람이 기억하기 쉬운 문서 주소 → 실제 문서 키. (예: /tos/narin/privacy → /tos/narin/pp)
const DOC_ALIASES = { privacy: 'pp', terms: 'tos' };

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 제목 텍스트 → 앵커 id. 한글을 그대로 살려 "제1조-목적" 같은 주소가 되게 한다.
function slugify(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z0-9#]+;/gi, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// 마크다운을 HTML로 바꾸면서 제목마다 id를 붙이고, 목차용으로 h2 목록을 모은다.
// 표는 좁은 화면에서 가로 스크롤이 되도록 감싼다.
function renderMarkdown(content) {
  const headings = [];
  const used = new Map();
  const md = new Marked({
    renderer: {
      heading(text, level, raw) {
        const base = slugify(raw) || 'section';
        const count = used.get(base) || 0;
        used.set(base, count + 1);
        const id = count ? `${base}-${count + 1}` : base;
        if (level === 2) headings.push({ id, text: text.replace(/<[^>]*>/g, '') });
        return `<h${level} id="${id}">${text}</h${level}>\n`;
      },
      table(header, body) {
        return `<div class="table-wrap" role="region" aria-label="표" tabindex="0"><table>\n<thead>\n${header}</thead>\n<tbody>\n${body}</tbody>\n</table></div>\n`;
      },
    },
  });
  return { html: md.parse(content), headings };
}

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

function page(title, body, opts = {}) {
  const canonical = opts.path ? `${PUBLIC_BASE_URL}${opts.path}` : '';
  const seo = [
    opts.description ? `<meta name="description" content="${escapeHtml(opts.description)}">` : '',
    opts.noindex ? '<meta name="robots" content="noindex">' : '',
    canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : '',
    canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : '',
    opts.description ? `<meta property="og:type" content="article">
  <meta property="og:site_name" content="Noahsoft">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(opts.description)}">` : '',
  ].filter(Boolean).join('\n  ');
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${seo}
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
    .skip-link { position: absolute; left: -9999px; top: 0; background: #252836; color: #fff; padding: 10px 16px; border-radius: 0 0 8px 0; z-index: 10; }
    .skip-link:focus { left: 0; }
    a:focus-visible, .table-wrap:focus-visible { outline: 2px solid #7c8cff; outline-offset: 2px; border-radius: 4px; }
    .content h2, .content h3 { scroll-margin-top: 16px; }
    .content a { text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
    .content hr { border: 0; border-top: 1px solid #2d2d3d; margin: 24px 0; }
    .content blockquote { border-left: 3px solid #4a5568; background: #1b1b26; padding: 12px 16px; margin-bottom: 12px; border-radius: 0 8px 8px 0; }
    .content blockquote p:last-child { margin-bottom: 0; }
    .content code { background: #1e293b; color: #cbd5e1; padding: 1px 6px; border-radius: 4px; font-size: 0.85em; }
    .table-wrap { overflow-x: auto; margin-bottom: 16px; border: 1px solid #2d2d3d; border-radius: 8px; }
    .content table { width: 100%; border-collapse: collapse; font-size: 0.86rem; min-width: 520px; }
    .content th, .content td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid #2d2d3d; color: #94a3b8; line-height: 1.6; }
    .content th { color: #e2e8f0; background: #1b1b26; font-weight: 600; }
    .content tr:last-child td { border-bottom: 0; }
    .toc { background: #16161e; border: 1px solid #2d2d3d; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; }
    .toc h2 { font-size: 0.95rem; color: #e2e8f0; margin-bottom: 10px; }
    .toc ol { list-style: none; columns: 2; column-gap: 24px; font-size: 0.86rem; line-height: 1.9; }
    .toc a { color: #94a3b8; }
    .toc a:hover { color: #fff; }
    .notice { background: #2a2314; border: 1px solid #854d0e; color: #fde68a; border-radius: 12px; padding: 14px 18px; margin-bottom: 16px; font-size: 0.88rem; line-height: 1.6; }
    .to-top { display: inline-block; margin-top: 16px; font-size: 0.82rem; color: #94a3b8; }
    @media (max-width: 640px) {
      header { padding: 14px 16px; }
      .container { padding: 24px 16px; }
      .content { padding: 22px 18px; }
      .content h1 { font-size: 1.35rem; }
      .toc { padding: 16px 18px; }
      .toc ol { columns: 1; }
      .doc-actions { flex-wrap: wrap; }
    }
    @media print {
      body { background: #fff; color: #000; }
      header, footer, .doc-actions, .toc, .skip-link, .to-top { display: none; }
      .content { border: 0; padding: 0; background: #fff; }
      .content h1, .content h2, .content h3, .content p, .content li, .content th, .content td, .content strong { color: #000; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#main">본문으로 건너뛰기</a>
  <header>
    <a href="/">← 홈</a>
    <h1>Noahsoft</h1>
  </header>
  <main id="main" class="container">${body}</main>
  <footer>Noahsoft Bot Policy Hub</footer>
</body>
</html>`;
}

// 홈 — 단체(그룹) 메인
app.get('/', asyncRoute(async (req, res) => {
  // 검토 중인 초안(meta.json의 "status": "draft")은 목록에 올리지 않는다. 주소를 아는 사람만 열 수 있다.
  const bots = (await getBots()).filter(bot => bot.status !== 'draft');
  const cards = bots.map(bot => `
    <div class="card">
      <div class="card-title">${bot.name}</div>
      <div class="card-desc">${bot.description || ''}</div>
    </div>`).join('');

  const body = `
    <div class="hero">
      <h2>Noahsoft</h2>
      <p>다양한 목적의 Discord 봇을 만들고 운영하는 팀입니다.</p>
    </div>
    ${cards || '<div class="card"><p style="color:#64748b">등록된 봇이 없습니다.</p></div>'}
    <div class="card" style="text-align:center">
      <div class="card-desc" style="margin-bottom:16px">각 봇의 이용약관과 개인정보처리방침은 한 곳에서 확인할 수 있습니다.</div>
      <a class="btn btn-active" href="/tos">약관·정책 모아보기 →</a>
    </div>`;

  res.send(page('Noahsoft', body));
}));

// /tos 하위 라우터 — 봇 목록, 개별 문서, RAW
const tosRouter = express.Router();

// 목록 — GET /tos
tosRouter.get('/', asyncRoute(async (req, res) => {
  // 검토 중인 초안(meta.json의 "status": "draft")은 목록에 올리지 않는다. 주소를 아는 사람만 열 수 있다.
  const bots = (await getBots()).filter(bot => bot.status !== 'draft');
  const cards = bots.map(bot => {
    const badges = bot.docs.map(doc =>
      `<a class="badge badge-doc" href="/tos/${bot.id}/${doc.key}">${docIcon(doc.key)} ${doc.label}</a><a class="badge raw-badge" href="/tos/${bot.id}/${doc.key}/raw">RAW</a>`
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

// 별칭 — GET /tos/:botname/privacy → /tos/:botname/pp (RAW 포함). 해당 문서가 있을 때만 옮긴다.
tosRouter.get('/:botname/:alias/:raw(raw)?', asyncRoute(async (req, res, next) => {
  const { botname, alias, raw } = req.params;
  const target = Object.prototype.hasOwnProperty.call(DOC_ALIASES, alias) ? DOC_ALIASES[alias] : null;
  if (!target || !(await botExists(botname))) return next();
  const docs = await getDocs(botname);
  // 같은 이름의 문서를 직접 선언한 봇이 있으면 그 문서가 우선한다
  if (docs.some(d => d.key === alias) || !docs.some(d => d.key === target)) return next();
  res.redirect(302, `/tos/${botname}/${target}${raw ? '/raw' : ''}`);
}));

// 문서 렌더링 — GET /tos/:botname/:type (tos/pp는 자동 노출, 그 외는 meta.json의 docs에 선언되어야 함)
tosRouter.get('/:botname/:type', asyncRoute(async (req, res, next) => {
  const { botname, type } = req.params;
  if (!(await botExists(botname))) return next();

  const docs = await getDocs(botname);
  const doc = docs.find(d => d.key === type);
  if (!doc) {
    return res.status(404).send(page('404', `<div class="card"><h2 style="color:#fff;margin-bottom:8px">404 — 문서를 찾을 수 없습니다</h2><p style="color:#64748b">봇 <strong>${escapeHtml(botname)}</strong>의 <strong>${escapeHtml(type)}</strong> 문서가 존재하지 않거나 meta.json에 선언되지 않았습니다.</p></div>`));
  }

  const meta = await getMeta(botname);
  const { content } = await readDoc(botname, type);
  const { html, headings } = renderMarkdown(content);
  const otherDocs = docs.filter(d => d.key !== type);
  const isDraft = meta.status === 'draft';

  // 목차는 meta.json에 "toc": true 를 선언한 봇에서만 보여준다 (기존 문서 화면은 그대로)
  const toc = meta.toc && headings.length > 2
    ? `<nav class="toc" aria-labelledby="toc-title"><h2 id="toc-title">목차</h2><ol>${headings.map(h => `<li><a href="#${h.id}">${h.text}</a></li>`).join('')}</ol></nav>`
    : '';
  const draftNotice = isDraft
    ? '<div class="notice" role="note"><strong>검토 중인 초안입니다.</strong> 이 문서는 아직 시행되지 않았으며, 운영자 확인과 법률 검토를 거쳐 내용이 바뀔 수 있습니다.</div>'
    : '';

  const body = `
    <div id="top" class="doc-header">
      <h2>${meta.name} · ${doc.label}</h2>
      <div class="doc-actions">
        ${otherDocs.map(d => `<a class="btn" href="/tos/${botname}/${d.key}">${d.label}</a>`).join('')}
        <a class="btn" href="/tos/${botname}/${type}/raw">RAW</a>
      </div>
    </div>
    ${draftNotice}
    ${toc}
    <article class="content">${html}</article>
    ${toc ? '<a class="to-top" href="#top">↑ 맨 위로</a>' : ''}`;

  res.send(page(`${meta.name} ${doc.label}`, body, {
    description: `${meta.name} ${doc.label}${meta.description ? ` — ${meta.description}` : ''}`,
    path: `/tos/${botname}/${type}`,
    noindex: isDraft,
  }));
}));

// RAW 마크다운 — GET /tos/:botname/:type/raw
tosRouter.get('/:botname/:type/raw', asyncRoute(async (req, res, next) => {
  const { botname, type } = req.params;
  if (!(await botExists(botname))) return next();

  const doc = await readDoc(botname, type);
  if (!doc) {
    return res.status(404).type('text').send(`404: ${botname}/${type}.md not found or not declared in meta.json`);
  }

  // 초안은 RAW도 검색에 잡히지 않게 한다
  if ((await getMeta(botname)).status === 'draft') res.set('X-Robots-Tag', 'noindex');
  res.type('text/plain; charset=utf-8').send(doc.content);
}));

app.use('/tos', tosRouter);

// 404
app.use((req, res) => {
  res.status(404).send(page('404', '<div class="card"><h2 style="color:#fff;margin-bottom:8px">404 — 페이지를 찾을 수 없습니다</h2><p style="color:#64748b">요청하신 페이지가 존재하지 않습니다.</p></div>'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('요청 처리 오류:', err);
  res.status(504).send(page('504', `<div class="card"><h2 style="color:#fff;margin-bottom:8px">504 — 응답 지연</h2><p style="color:#64748b">${escapeHtml(err.message || '문서를 읽는 중 시간이 초과되었습니다.')}</p></div>`));
});

app.listen(PORT, () => {
  console.log(`✅  서버 실행 중 → http://localhost:${PORT}`);
});
