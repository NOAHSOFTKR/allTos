const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { getBots, getDocs, getMeta, botExists, readDoc } = require('../lib/docs');

// 요청마다 새 McpServer 인스턴스를 만들어 stateless HTTP 트랜스포트에 연결한다.
function createServer() {
  const server = new McpServer({ name: 'alltos', version: '1.0.0' });

  server.registerTool(
    'list_bots',
    {
      title: '봇 목록 조회',
      description: 'Noahsoft에서 운영하는 모든 Discord 봇과 각 봇에 등록된 문서(TOS, PP 등) 목록을 조회합니다.',
      inputSchema: {},
    },
    async () => {
      const bots = await getBots();
      return { content: [{ type: 'text', text: JSON.stringify(bots, null, 2) }] };
    }
  );

  server.registerTool(
    'list_docs',
    {
      title: '봇 문서 목록 조회',
      description: '특정 봇에 등록된 문서(key, 라벨) 목록을 조회합니다.',
      inputSchema: { botId: z.string().describe('봇 식별자 (예: sh-bot, lumina, ttsbot, jiyun)') },
    },
    async ({ botId }) => {
      if (!(await botExists(botId))) {
        return { content: [{ type: 'text', text: `봇 "${botId}"을(를) 찾을 수 없습니다.` }], isError: true };
      }
      const meta = await getMeta(botId);
      const docs = await getDocs(botId);
      return { content: [{ type: 'text', text: JSON.stringify({ id: botId, name: meta.name, docs }, null, 2) }] };
    }
  );

  server.registerTool(
    'get_doc',
    {
      title: '문서 원문 조회',
      description: '특정 봇의 특정 문서(TOS, PP 또는 meta.json에 선언된 커스텀 문서)의 원문 마크다운을 조회합니다.',
      inputSchema: {
        botId: z.string().describe('봇 식별자 (예: sh-bot, lumina, ttsbot, jiyun)'),
        type: z.string().describe('문서 종류 키 (예: tos, pp, 또는 meta.json에 선언된 커스텀 키)'),
      },
    },
    async ({ botId, type }) => {
      if (!(await botExists(botId))) {
        return { content: [{ type: 'text', text: `봇 "${botId}"을(를) 찾을 수 없습니다.` }], isError: true };
      }
      const doc = await readDoc(botId, type);
      if (!doc) {
        return {
          content: [{ type: 'text', text: `"${botId}"의 "${type}" 문서를 찾을 수 없거나 meta.json에 선언되지 않았습니다.` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: doc.content }] };
    }
  );

  return server;
}

module.exports = { createServer };
