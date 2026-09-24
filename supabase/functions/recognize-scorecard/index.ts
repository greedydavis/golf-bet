// Supabase Edge Function：成績卡辨識
// 部署：supabase functions deploy recognize-scorecard（GitHub Actions 會自動執行）
// 需要的 secret：ANTHROPIC_API_KEY（Supabase 後台 → Edge Functions → Secrets）

import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { describeApiError, recognizeScorecard, RecognizeError, validateInput, type MessagesClient } from './core.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // 只有已開通的帳號可以使用（避免 API 額度被濫用）
    const authorization = req.headers.get('Authorization') ?? '';
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: me } = await supabase.rpc('me');
    if (!me || !['owner', 'member'].includes((me as { role: string }).role)) {
      return json({ error: '沒有權限：請先登入，並由管理者開通帳號' }, 403);
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: '尚未設定 ANTHROPIC_API_KEY（Supabase → Edge Functions → Secrets）' }, 503);

    const input = validateInput(await req.json());
    const client = new Anthropic({ apiKey }) as unknown as MessagesClient;
    const result = await recognizeScorecard(client, input);
    return json(result);
  } catch (e) {
    const err = describeApiError(e);
    if (!(e instanceof RecognizeError)) console.error('recognize failed', e);
    return json({ error: err.message }, err.status);
  }
});
