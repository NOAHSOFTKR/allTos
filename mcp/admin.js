const express = require('express');
const cookieParser = require('cookie-parser');
const {
  COOKIE_NAME,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  isRateLimited,
  recordFailedAttempt,
  clearAttempts,
} = require('../lib/adminAuth');
const { listKeys, createKey, revokeKey } = require('../lib/apiKeys');

const router = express.Router();
router.use(cookieParser());
router.use(express.urlencoded({ extended: false }));

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout(title, body) {
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
    header { background: #16161e; border-bottom: 1px solid #2d2d3d; padding: 16px 32px; display: flex; align-items: center; gap: 12px; justify-content: space-between; }
    header h1 { font-size: 1.1rem; font-weight: 600; color: #fff; }
    header form { margin: 0; }
    .container { max-width: 720px; margin: 0 auto; padding: 40px 24px; }
    .card { background: #16161e; border: 1px solid #2d2d3d; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
    h2 { font-size: 1.2rem; color: #fff; margin-bottom: 16px; }
    .error { background: #2a1418; border: 1px solid #7f1d1d; color: #fca5a5; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 0.88rem; }
    .new-key { background: #142a1a; border: 1px solid #16653d; color: #86efac; padding: 16px; border-radius: 8px; margin-bottom: 20px; font-size: 0.85rem; }
    .new-key code { display: block; margin-top: 8px; background: #0f0f13; padding: 10px 12px; border-radius: 6px; color: #e2e8f0; word-break: break-all; font-size: 0.85rem; }
    input[type=password], input[type=text] { width: 100%; padding: 10px 12px; border-radius: 7px; border: 1px solid #2d2d3d; background: #0f0f13; color: #e2e8f0; font-size: 0.9rem; margin-bottom: 12px; }
    button { padding: 9px 18px; border-radius: 7px; border: none; background: #4f46e5; color: #fff; font-size: 0.88rem; font-weight: 500; cursor: pointer; }
    button:hover { background: #4338ca; }
    button.danger { background: #7f1d1d; }
    button.danger:hover { background: #991b1b; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #2d2d3d; color: #94a3b8; }
    th { color: #64748b; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }
    .empty { color: #475569; font-size: 0.88rem; padding: 12px 0; }
    .row-form { display: inline; }
  </style>
</head>
<body>
  <header>
    <h1>Noahsoft · alltos MCP 관리자</h1>
    ${body.showLogout ? `<form method="POST" action="/admin/logout"><button type="submit">로그아웃</button></form>` : ''}
  </header>
  <div class="container">${body.html}</div>
</body>
</html>`;
}

function requireAdmin(req, res, next) {
  if (verifySessionToken(req.cookies[COOKIE_NAME])) return next();
  res.redirect('/admin/login');
}

router.get('/login', (req, res) => {
  const error = req.query.error ? `<div class="error">${escapeHtml(req.query.error)}</div>` : '';
  res.send(layout('관리자 로그인', {
    showLogout: false,
    html: `
      <div class="card">
        <h2>관리자 로그인</h2>
        ${error}
        <form method="POST" action="/admin/login">
          <input type="password" name="password" placeholder="관리자 비밀번호" autofocus required>
          <button type="submit">로그인</button>
        </form>
      </div>`,
  }));
});

router.post('/login', (req, res) => {
  const ip = req.ip;
  if (isRateLimited(ip)) {
    return res.redirect('/admin/login?error=' + encodeURIComponent('로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도하세요.'));
  }
  if (!verifyPassword(req.body.password)) {
    recordFailedAttempt(ip);
    return res.redirect('/admin/login?error=' + encodeURIComponent('비밀번호가 올바르지 않습니다.'));
  }
  clearAttempts(ip);
  res.cookie(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/admin/login');
});

function renderDashboard(keys, newKey) {
  const rows = keys.map(k => `
    <tr>
      <td>${escapeHtml(k.label)}</td>
      <td>····${escapeHtml(k.last4)}</td>
      <td>${new Date(k.createdAt).toLocaleString('ko-KR')}</td>
      <td>${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('ko-KR') : '-'}</td>
      <td>
        <form class="row-form" method="POST" action="/admin/keys/${k.id}/revoke" onsubmit="return confirm('이 키를 폐기하시겠습니까?');">
          <button type="submit" class="danger">폐기</button>
        </form>
      </td>
    </tr>`).join('');

  const newKeyBlock = newKey ? `
    <div class="new-key">
      새 API 키가 발급되었습니다. <strong>이 키는 지금만 표시되며 다시 확인할 수 없습니다.</strong>
      <code>${escapeHtml(newKey)}</code>
    </div>` : '';

  return `
    ${newKeyBlock}
    <div class="card">
      <h2>새 API 키 발급</h2>
      <form method="POST" action="/admin/keys">
        <input type="text" name="label" placeholder="키 이름 (예: Claude Code, 내 서버)">
        <button type="submit">발급</button>
      </form>
    </div>
    <div class="card">
      <h2>발급된 API 키</h2>
      ${keys.length ? `
        <table>
          <thead><tr><th>이름</th><th>키 끝자리</th><th>발급일</th><th>최근 사용</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>` : `<div class="empty">발급된 키가 없습니다.</div>`}
    </div>`;
}

router.get('/', requireAdmin, (req, res) => {
  res.send(layout('API 키 관리', { showLogout: true, html: renderDashboard(listKeys()) }));
});

router.post('/keys', requireAdmin, (req, res) => {
  const created = createKey(req.body.label);
  res.send(layout('API 키 관리', { showLogout: true, html: renderDashboard(listKeys(), created.rawKey) }));
});

router.post('/keys/:id/revoke', requireAdmin, (req, res) => {
  revokeKey(req.params.id);
  res.redirect('/admin');
});

module.exports = router;
