import { describe, expect, it } from 'vitest';
import {
  describeApiError,
  postprocess,
  recognizeScorecard,
  validateInput,
  type MessagesClient,
} from '../supabase/functions/recognize-scorecard/core';

const input = { imageBase64: 'AAAA', mediaType: 'image/jpeg' as const, playerNames: ['阿明'], needCourse: true };

function fakeClient(response: { stop_reason: string; text?: string }, capture?: (p: Record<string, unknown>) => void): MessagesClient {
  return {
    messages: {
      async create(params) {
        capture?.(params);
        return { stop_reason: response.stop_reason, content: response.text ? [{ type: 'text', text: response.text }] : [] };
      },
    },
  };
}

describe('成績卡辨識核心', () => {
  it('輸入檢查', () => {
    expect(() => validateInput({})).toThrow('沒有收到圖片');
    expect(() => validateInput({ imageBase64: 'x', mediaType: 'image/gif' })).toThrow('JPG');
    expect(validateInput({ ...input, needCourse: 'yes' }).needCourse).toBe(false);
  });

  it('補齊 18 格、剔除不合理數字', () => {
    const r = postprocess({
      players: [{ nameOnCard: ' 阿明 ', strokes: [4, 5, 0, 25, 4.5, null] }],
      pars: [4, 4],
      hcpIndex: null,
      notes: '',
    });
    expect(r.players[0].nameOnCard).toBe('阿明');
    expect(r.players[0].strokes).toHaveLength(18);
    expect(r.players[0].strokes.slice(0, 6)).toEqual([4, 5, null, null, null, null]);
    expect(r.pars).toHaveLength(18);
    expect(r.hcpIndex).toBeNull();
    expect(r.notes).toContain('不是 18 洞');
  });

  it('找不到球員時回報錯誤', () => {
    expect(() => postprocess({ players: [], pars: null, hcpIndex: null, notes: '' })).toThrow('找不到球員');
  });

  it('送出 claude-sonnet-5、圖片與 JSON schema，並解析回應', async () => {
    let params: Record<string, unknown> = {};
    const text = JSON.stringify({ players: [{ nameOnCard: 'A', strokes: new Array(18).fill(4) }], pars: null, hcpIndex: null, notes: '' });
    const r = await recognizeScorecard(fakeClient({ stop_reason: 'end_turn', text }, (p) => (params = p)), input);
    expect(params.model).toBe('claude-sonnet-5');
    expect(JSON.stringify(params.messages)).toContain('"media_type":"image/jpeg"');
    expect(JSON.stringify(params.messages)).toContain('Par 與差點洞序');
    expect((params.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect(r.players[0].strokes).toEqual(new Array(18).fill(4));
  });

  it('拒絕與截斷', async () => {
    await expect(recognizeScorecard(fakeClient({ stop_reason: 'refusal' }), input)).rejects.toThrow('無法辨識');
    await expect(recognizeScorecard(fakeClient({ stop_reason: 'max_tokens' }), input)).rejects.toThrow('過長');
    await expect(recognizeScorecard(fakeClient({ stop_reason: 'end_turn', text: 'not json' }), input)).rejects.toThrow('格式不正確');
  });

  it('API 錯誤轉成中文訊息', () => {
    expect(describeApiError({ status: 401 }).message).toContain('API_KEY');
    expect(describeApiError({ status: 429 }).status).toBe(503);
    expect(describeApiError(new Error('network')).message).toContain('無法連線');
  });
});
