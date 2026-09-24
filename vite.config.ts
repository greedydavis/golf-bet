import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import {
  describeApiError,
  recognizeScorecard,
  validateInput,
  type MessagesClient,
} from './supabase/functions/recognize-scorecard/core';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * 只在本機開發（示範模式）使用：提供 /api/recognize，用 .env 的 ANTHROPIC_API_KEY 呼叫 Claude。
 * 正式環境改由 Supabase Edge Function 處理，API key 不會進到前端。
 */
function devRecognize(apiKey: string | undefined): Plugin {
  return {
    name: 'dev-recognize',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/recognize', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
        if (!apiKey) return send(503, { error: '尚未在 .env 設定 ANTHROPIC_API_KEY' });
        try {
          const input = validateInput(JSON.parse(await readBody(req)));
          const { default: Anthropic } = await import('@anthropic-ai/sdk');
          const client = new Anthropic({ apiKey }) as unknown as MessagesClient;
          send(200, await recognizeScorecard(client, input));
        } catch (e) {
          const err = describeApiError(e);
          send(err.status, { error: err.message });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // 部署在子路徑（GitHub Pages）也能運作
    base: './',
    plugins: [react(), tailwindcss(), devRecognize(env.ANTHROPIC_API_KEY)],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    server: { host: true, port: 5190 },
    test: {
      include: ['tests/**/*.test.ts', 'db-tests/**/*.test.ts'],
      testTimeout: 60_000,
      hookTimeout: 120_000,
    },
  };
});
