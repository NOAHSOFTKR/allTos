require('dotenv').config();
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createServer } = require('./createServer');
const { verifyKey } = require('../lib/apiKeys');
const adminRouter = require('./admin');

const app = express();
const PORT = process.env.MCP_PORT || 50001;

// 로컬 리버스 프록시(127.0.0.1)를 통해서만 들어오므로, 그 홉의 X-Forwarded-For만 신뢰한다.
// (없으면 req.ip가 항상 프록시의 127.0.0.1로 잡혀 관리자 로그인 rate-limit이 IP별로 분리되지 않음)
app.set('trust proxy', 'loopback');

app.use('/mcp', express.json());

function requireApiKey(req, res, next) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const record = match ? verifyKey(match[1]) : null;
  if (!record) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized: invalid or missing API key' },
      id: null,
    });
  }
  req.apiKeyRecord = record;
  next();
}

// Stateless 모드 — 요청마다 새 서버/트랜스포트를 만들어 세션 상태를 유지하지 않는다.
app.post('/mcp', requireApiKey, async (req, res) => {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP 요청 처리 오류:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', requireApiKey, (req, res) => {
  res.status(405).json({ error: 'stateless 모드에서는 GET을 지원하지 않습니다.' });
});
app.delete('/mcp', requireApiKey, (req, res) => {
  res.status(405).json({ error: 'stateless 모드에서는 DELETE를 지원하지 않습니다.' });
});

app.use('/admin', adminRouter);
app.get('/', (req, res) => res.redirect('/admin'));

app.listen(PORT, () => {
  console.log(`✅  alltos MCP HTTP 서버 실행 중 → http://localhost:${PORT}`);
  console.log(`   관리자 대시보드: http://localhost:${PORT}/admin`);
  console.log(`   MCP 엔드포인트: http://localhost:${PORT}/mcp  (Authorization: Bearer <API_KEY> 필요)`);
});
