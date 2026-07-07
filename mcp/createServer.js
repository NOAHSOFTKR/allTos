const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const {
  getBots,
  getDocs,
  getMeta,
  botExists,
  readDoc,
  editBotMeta,
  addDoc,
  editDoc,
  deleteDoc,
  deleteBot,
} = require('../lib/docs');

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

  server.registerTool(
    'edit_bot',
    {
      title: '봇 수정',
      description: '이미 존재하는 봇의 이름/설명/최종수정일을 수정합니다. 존재하지 않는 봇이면 에러가 납니다 (새 봇은 add_doc으로 첫 문서를 추가하면 자동 생성됩니다).',
      inputSchema: {
        botId: z.string().describe('봇 식별자 (영문, 숫자, -, _ 만 허용)'),
        name: z.string().optional().describe('봇 이름'),
        description: z.string().optional().describe('봇 설명'),
        lastUpdated: z.string().optional().describe('최종 수정일 (예: 2026-07-07)'),
      },
    },
    async ({ botId, name, description, lastUpdated }) => {
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (lastUpdated !== undefined) updates.lastUpdated = lastUpdated;
      const meta = await editBotMeta(botId, updates);
      return { content: [{ type: 'text', text: JSON.stringify(meta, null, 2) }] };
    }
  );

  server.registerTool(
    'add_doc',
    {
      title: '문서 추가',
      description:
        '봇에 새 문서(tos/pp 또는 커스텀)를 추가합니다. 이미 있는 문서면 에러가 나며(수정은 edit_doc 사용), 새 커스텀 문서는 label이 필수입니다. 봇이 없으면 이 호출로 자동 생성됩니다.',
      inputSchema: {
        botId: z.string().describe('봇 식별자'),
        type: z.string().describe('문서 종류 키 (tos, pp, 또는 새 커스텀 키)'),
        content: z.string().describe('문서 원문 마크다운'),
        label: z.string().optional().describe('커스텀 문서의 표시 라벨 (예: "후원약관"). 커스텀 문서는 필수, tos/pp는 불필요'),
      },
    },
    async ({ botId, type, content, label }) => {
      const result = await addDoc(botId, type, content, label);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'edit_doc',
    {
      title: '문서 수정',
      description:
        '봇의 기존 문서(tos/pp 또는 커스텀) 내용을 수정합니다. 존재하지 않는 문서면 에러가 납니다 (새로 만들려면 add_doc 사용).',
      inputSchema: {
        botId: z.string().describe('봇 식별자'),
        type: z.string().describe('수정할 문서 종류 키'),
        content: z.string().describe('새 문서 원문 마크다운'),
        label: z.string().optional().describe('커스텀 문서의 라벨을 함께 바꾸고 싶을 때만 지정. tos/pp는 불필요'),
      },
    },
    async ({ botId, type, content, label }) => {
      const result = await editDoc(botId, type, content, label);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'delete_doc',
    {
      title: '문서 삭제',
      description: '봇의 특정 문서를 삭제합니다. 커스텀 문서면 meta.json의 docs 선언도 함께 제거됩니다.',
      inputSchema: {
        botId: z.string().describe('봇 식별자'),
        type: z.string().describe('삭제할 문서 종류 키'),
      },
    },
    async ({ botId, type }) => {
      const deleted = await deleteDoc(botId, type);
      return {
        content: [
          {
            type: 'text',
            text: deleted ? `"${botId}/${type}" 삭제됨` : `"${botId}/${type}" 파일이 이미 없었습니다 (meta.json 선언만 정리됨)`,
          },
        ],
      };
    }
  );

  server.registerTool(
    'delete_bot',
    {
      title: '봇 삭제',
      description: '봇 전체(모든 문서 포함)를 삭제합니다. 되돌릴 수 없으니 주의하세요.',
      inputSchema: {
        botId: z.string().describe('삭제할 봇 식별자'),
      },
    },
    async ({ botId }) => {
      const deleted = await deleteBot(botId);
      return {
        content: [{ type: 'text', text: deleted ? `봇 "${botId}" 전체 삭제됨` : `봇 "${botId}"이(가) 존재하지 않았습니다` }],
      };
    }
  );

  return server;
}

module.exports = { createServer };
