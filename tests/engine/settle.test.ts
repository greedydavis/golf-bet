import { describe, expect, it } from 'vitest';
import { parseHandicap } from '@/engine/handicap/parser';
import { defaultBetConfig, validateBetConfig, type BetConfig } from '@/engine/games/registry';
import { settleRound, type Settlement } from '@/engine/settle';
import { suggestPayments } from '@/engine/payments';
import { buildLineSummary } from '@/engine/summary';
import type { Seat } from '@/engine/types';
import { card, course, SEATS4 } from './fixtures';

function bet(patch: (b: BetConfig) => void = () => {}): BetConfig {
  const b = defaultBetConfig();
  patch(b);
  return b;
}

const scores = {
  A: card({ 1: 1, 5: -1, 12: 1 }), // 73
  B: card({ 2: 1, 3: 1, 9: 2, 14: 1 }), // 77
  C: card({ 1: 2, 4: 1, 7: 2, 10: 1, 13: 2, 15: 1, 18: 2 }), // 83
  D: card({ 1: 3, 2: 2, 6: 2, 8: 3, 11: 2, 13: 3, 16: 2, 17: 3, 18: 2 }), // 94
};

const matrix = parseHandicap('AB平打\nAB讓C前3後3\nAB讓D18\nC讓D5', SEATS4).matrix;

function applyPayments(s: Settlement) {
  const left = { ...s.money };
  for (const p of s.payments) {
    left[p.from] += p.amount;
    left[p.to] -= p.amount;
  }
  return left;
}

describe('四人兩兩配對結算', () => {
  it('6 組配對，總和為 0，付款後全員結清', () => {
    const r = settleRound({
      seats: SEATS4,
      course,
      scores,
      matrix,
      bet: bet((b) => {
        b.games.match.options.tie = 'carry';
        b.games.stroke.options.mode = 'perStroke';
      }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.settlement;
    expect(s.pairs.map((p) => p.pair)).toEqual(['AB', 'AC', 'AD', 'BC', 'BD', 'CD']);
    expect(Object.values(s.points).reduce((a, b) => a + b, 0)).toBe(0);
    expect(Object.values(s.money).reduce((a, b) => a + b, 0)).toBe(0);
    expect(s.money.A).toBe(s.points.A * 100);
    expect(Object.values(applyPayments(s)).every((v) => Math.abs(v) < 0.01)).toBe(true);
    expect(s.payments.length).toBeLessThanOrEqual(3);
  });

  it('每人點數 = 各配對點數加總', () => {
    const r = settleRound({ seats: SEATS4, course, scores, matrix, bet: bet() });
    if (!r.ok) throw new Error(r.errors.join());
    const s = r.settlement;
    for (const seat of SEATS4) {
      const expected = s.pairs.reduce((acc, p) => acc + (p.a === seat ? p.points : p.b === seat ? -p.points : 0), 0);
      expect(s.points[seat]).toBeCloseTo(expected);
    }
  });

  it('前九 / 後九 / 全場分開計算', () => {
    const r = settleRound({
      seats: ['A', 'B'],
      course,
      scores: { A: card(), B: card({ 1: 5, 10: 2 }) },
      matrix: parseHandicap('A讓B前3後3', ['A', 'B']).matrix,
      bet: bet((b) => {
        b.games.match.enabled = false;
        b.games.stroke.options.segments = {
          front: { enabled: true, points: 1 },
          back: { enabled: true, points: 1 },
          total: { enabled: true, points: 2 },
        };
      }),
    });
    if (!r.ok) throw new Error(r.errors.join());
    const stroke = r.settlement.pairs[0].games[0];
    expect(stroke.gameId).toBe('stroke');
    const segs = (stroke.detail as { segments: { segment: string; points: number }[] }).segments;
    expect(segs.map((x) => [x.segment, x.points])).toEqual([
      ['front', 1],
      ['back', -1],
      ['total', 2],
    ]);
    expect(r.settlement.points).toEqual({ A: 2, B: -2 });
  });

  it('只玩比洞', () => {
    const r = settleRound({
      seats: ['A', 'B'],
      course,
      scores: { A: card(), B: card({ 1: 1 }) },
      matrix: {},
      bet: bet((b) => (b.games.stroke.enabled = false)),
    });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.settlement.pairs[0].games.map((g) => g.gameId)).toEqual(['match']);
    expect(r.settlement.points).toEqual({ A: 1, B: -1 });
  });

  it('成績不完整時拒絕結算並指出哪一洞', () => {
    const partial = [...card()] as (number | null)[];
    partial[4] = null;
    const r = settleRound({ seats: ['A', 'B'], course, scores: { A: card(), B: partial }, matrix: {}, bet: bet() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('第 5 洞');
  });
});

describe('付款建議', () => {
  const count = (b: Record<Seat, number>) => suggestPayments(b).length;

  it('兩組各自結清只需 2 筆', () => {
    expect(count({ A: 100, B: -100, C: 50, D: -50 })).toBe(2);
    expect(count({ A: 100, C: 50, B: -100, D: -50 })).toBe(2);
  });

  it('一人收兩人付', () => {
    expect(suggestPayments({ A: 150, B: -100, C: -50, D: 0 })).toEqual(
      expect.arrayContaining([
        { from: 'B', to: 'A', amount: 100 },
        { from: 'C', to: 'A', amount: 50 },
      ]),
    );
  });

  it('無法拆組時 3 筆', () => {
    expect(count({ A: -30, B: -20, C: 10, D: 40 })).toBe(3);
  });

  it('全部 0 不需付款', () => {
    expect(count({ A: 0, B: 0, C: 0, D: 0 })).toBe(0);
  });
});

describe('賭注設定驗證', () => {
  it('預設設定合法', () => {
    expect(validateBetConfig(defaultBetConfig()).ok).toBe(true);
  });

  it('至少要選一種賽制', () => {
    const b = bet((x) => {
      x.games.match.enabled = false;
      x.games.stroke.enabled = false;
    });
    expect(validateBetConfig(b).ok).toBe(false);
  });

  it('選項錯誤會被擋下', () => {
    const b = bet() as unknown as { games: { match: { options: { tie: string } } } };
    b.games.match.options.tie = 'xxx';
    expect(validateBetConfig(b).ok).toBe(false);
  });
});

describe('LINE 摘要', () => {
  it('包含輸贏、付款、對戰明細', () => {
    const r = settleRound({ seats: ['A', 'B'], course, scores: { A: card(), B: card({ 1: 1 }) }, matrix: {}, bet: bet() });
    if (!r.ok) throw new Error();
    const text = buildLineSummary({ date: '2026/09/23', courseName: '測試球場', names: { A: '阿明', B: '大華' } }, r.settlement);
    expect(text).toContain('2026/09/23 測試球場');
    expect(text).toContain('阿明　+2 點（+200 元）');
    expect(text).toContain('大華 → 阿明　200 元');
    expect(text).toContain('阿明 vs 大華：比洞 +1、總桿 +1 → +2');
  });
});
