import { describe, expect, it } from 'vitest';
import {
  describeApiError,
  postprocess,
  recognizeScorecard,
  validateInput,
  type MessagesClient,
} from '../supabase/functions/recognize-scorecard/core';

const input = { images: [{ base64: 'AAAA', mediaType: 'image/jpeg' as const }], playerNames: ['阿明'], needCourse: true };

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
    expect(() => validateInput({ images: [{ base64: 'x', mediaType: 'image/gif' }] })).toThrow('JPG');
    expect(() => validateInput({ images: new Array(5).fill(input.images[0]) })).toThrow('最多');
    expect(validateInput({ ...input, needCourse: 'yes' }).needCourse).toBe(false);
    // 舊版前端的單張格式仍然接受
    expect(validateInput({ imageBase64: 'AAAA', mediaType: 'image/png' }).images).toEqual([{ base64: 'AAAA', mediaType: 'image/png' }]);
  });

  it('補齊 18 格、剔除不合理數字', () => {
    const r = postprocess({
      players: [{ nameOnCard: ' 阿明 ', strokes: [4, 5, 0, 25, 4.5, null] }],
      pars: [4, 4],
      hcpIndex: null,
      notes: '',
    });
    expect(r.players[0].nameOnCard).toBe('阿明');
    expect(r.players[0].match).toBeNull();
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

  it('兩張圖片（前九 + 後九）一起送出，並告知是同一張成績卡', async () => {
    let params: Record<string, unknown> = {};
    const text = JSON.stringify({ players: [{ nameOnCard: 'A', strokes: new Array(18).fill(4) }], pars: null, hcpIndex: null, notes: '' });
    const two = { ...input, images: [input.images[0], { base64: 'BBBB', mediaType: 'image/png' as const }] };
    await recognizeScorecard(fakeClient({ stop_reason: 'end_turn', text }, (p) => (params = p)), two);
    const content = (params.messages as { content: { type: string; text?: string }[] }[])[0].content;
    expect(content.filter((c) => c.type === 'image')).toHaveLength(2);
    expect(content.at(-1)!.text).toContain('2 張圖片是同一張成績卡');
  });

  it('只有前九的成績：後九維持 null，不會被補上數字', () => {
    const r = postprocess({
      players: [{ nameOnCard: 'A', strokes: [4, 5, 3, 6, 4, 3, 5, 5, 4, ...new Array(9).fill(null)] }],
      pars: null,
      hcpIndex: null,
      notes: '',
    });
    expect(r.players[0].strokes.slice(0, 9)).toEqual([4, 5, 3, 6, 4, 3, 5, 5, 4]);
    expect(r.players[0].strokes.slice(9)).toEqual(new Array(9).fill(null));
    expect(r.notes).toBe('');
  });

  it('名字對應：編號轉成 0 起算，超出範圍或重複的不採用', () => {
    const row = (matchIndex: unknown) => ({ nameOnCard: 'x', matchIndex, strokes: new Array(18).fill(4) });
    const r = postprocess({ players: [row(2), row(1), row(9), row(null), row('3')], pars: null, hcpIndex: null, notes: '' }, 4);
    expect(r.players.map((p) => p.match)).toEqual([1, 0, null, null, null]);
    // 兩列都說自己是第 2 位 → 兩列都不採用，交給使用者決定
    const dup = postprocess({ players: [row(2), row(2), row(3)], pars: null, hcpIndex: null, notes: '' }, 4);
    expect(dup.players.map((p) => p.match)).toEqual([null, null, 2]);
  });

  it('把有編號的球員名單交給模型', async () => {
    let params: Record<string, unknown> = {};
    const text = JSON.stringify({ players: [{ nameOnCard: '王曉明', matchIndex: 2, strokes: new Array(18).fill(4) }], pars: null, hcpIndex: null, notes: '' });
    const r = await recognizeScorecard(fakeClient({ stop_reason: 'end_turn', text }, (p) => (params = p)), {
      ...input,
      playerNames: ['張大同', '王小明', '李志強'],
    });
    expect(JSON.stringify(params.messages)).toContain('1．張大同、2．王小明、3．李志強');
    expect(r.players[0].match).toBe(1);
  });
});
