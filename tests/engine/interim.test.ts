import { describe, expect, it } from 'vitest';
import { defaultBetConfig, type BetConfig } from '@/engine/games/registry';
import type { MatchDetail } from '@/engine/games/matchPlay';
import type { StrokeDetail } from '@/engine/games/strokePlay';
import { parseHandicap } from '@/engine/handicap/parser';
import { frontNineComplete, frontNineReport } from '@/engine/interim';
import { settleRound } from '@/engine/settle';
import type { Scores, Seat } from '@/engine/types';
import { card, course, SEATS4 } from './fixtures';

function bet(patch: (b: BetConfig) => void = () => {}): BetConfig {
  const b = defaultBetConfig();
  patch(b);
  return b;
}

const full = {
  A: card({ 1: 1, 5: -1, 12: 1 }),
  B: card({ 2: 1, 3: 1, 9: 2, 14: 1 }),
  C: card({ 1: 2, 4: 1, 7: 2, 10: 1, 13: 2, 15: 1, 18: 2 }),
  D: card({ 1: 3, 2: 2, 6: 2, 8: 3, 11: 2, 13: 3, 16: 2, 17: 3, 18: 2 }),
};
/** 只打完前九：後九都是 null */
const frontOnly = Object.fromEntries(
  Object.entries(full).map(([s, v]) => [s, v.map((x, i) => (i < 9 ? x : null))]),
) as Record<Seat, Scores>;

const matrix = parseHandicap('AB平打\nAB讓C前3後3\nAB讓D18\nC讓D5', SEATS4).matrix;

describe('前九戰況', () => {
  it('前九填完就能算，後九還沒打也沒關係', () => {
    expect(frontNineComplete(SEATS4, frontOnly)).toBe(true);
    const r = frontNineReport({ seats: SEATS4, course, scores: frontOnly, matrix, bet: bet() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.pairs.map((p) => p.pair)).toEqual(['AB', 'AC', 'AD', 'BC', 'BD', 'CD']);
    expect(Object.values(r.report.points).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('前九沒填完時指出是誰、哪一洞', () => {
    const partial = { ...frontOnly, B: frontOnly.B.map((x, i) => (i === 6 ? null : x)) };
    expect(frontNineComplete(SEATS4, partial)).toBe(false);
    const r = frontNineReport({ seats: SEATS4, course, scores: partial, matrix, bet: bet() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('B 前九第 7 洞');
  });

  it('前九比洞的輸贏，和整場打完後結算裡的前九小計完全一樣', () => {
    for (const tie of ['none', 'carry'] as const) {
      const b = bet((x) => (x.games.match.options.tie = tie));
      const front = frontNineReport({ seats: SEATS4, course, scores: frontOnly, matrix, bet: b });
      const final = settleRound({ seats: SEATS4, course, scores: full, matrix, bet: b });
      if (!front.ok || !final.ok) throw new Error();
      for (const fp of front.report.pairs) {
        const sp = final.settlement.pairs.find((p) => p.pair === fp.pair)!;
        const md = sp.games.find((g) => g.gameId === 'match')!.detail as MatchDetail;
        expect(fp.match!.points).toBe(md.subtotal.front);
        expect(fp.match!.detail.holes).toEqual(md.holes.slice(0, 9));
      }
    }
  });

  it('平手累積：前九結束時還沒分出勝負的注數會標示「帶到後九」，不算作廢', () => {
    // A、B 第 8、9 洞平手（前七洞 A 贏第 1 洞）
    const scores = { A: frontOnly.A.map((x, i) => (i === 0 ? 3 : x)), B: frontOnly.A.map((x, i) => (i === 0 ? 4 : x)) } as Record<Seat, Scores>;
    const r = frontNineReport({
      seats: ['A', 'B'],
      course,
      scores,
      matrix: {},
      bet: bet((x) => (x.games.match.options.tie = 'carry')),
    });
    if (!r.ok) throw new Error(r.errors.join());
    const d = r.report.pairs[0].match!.detail;
    expect(d.pendingStake).toBe(8); // 第 2~9 洞都平手
    expect(d.voidedStake).toBe(0);
    expect(r.report.pairs[0].points).toBe(1);
  });

  it('前九總桿：全場讓桿的配對沒有前九注，但仍顯示依差點洞序落在前九的讓桿與淨桿', () => {
    const b = bet((x) => {
      x.games.stroke.options.segments.front = { enabled: true, points: 2 };
    });
    const r = frontNineReport({ seats: SEATS4, course, scores: frontOnly, matrix, bet: b });
    if (!r.ok) throw new Error();
    const ad = r.report.pairs.find((p) => p.pair === 'AD')!; // A 讓 D 全場 18 → 前九每洞 1 桿
    expect(ad.stroke.received).toEqual([0, 9]);
    expect(ad.stroke.net).toEqual([ad.stroke.gross[0], ad.stroke.gross[1] - 9]);
    expect(ad.stroke.betPoints).toBeNull();

    const ac = r.report.pairs.find((p) => p.pair === 'AC')!; // A 讓 C 前3後3
    expect(ac.stroke.received).toEqual([0, 3]);
    // 和整場結算的前九總桿注一致
    const final = settleRound({ seats: SEATS4, course, scores: full, matrix, bet: b });
    if (!final.ok) throw new Error();
    const sd = final.settlement.pairs.find((p) => p.pair === 'AC')!.games.find((g) => g.gameId === 'stroke')!.detail as StrokeDetail;
    expect(ac.stroke.betPoints).toBe(sd.segments.find((s) => s.segment === 'front')!.points);
    expect(ac.points).toBe(ac.match!.points + ac.stroke.betPoints!);
  });

  it('沒下前九總桿注時，暫計點數只有比洞；沒玩比洞時只看總桿', () => {
    const r = frontNineReport({ seats: SEATS4, course, scores: frontOnly, matrix, bet: bet() });
    if (!r.ok) throw new Error();
    expect(r.report.pairs.every((p) => p.stroke.betPoints === null && p.points === p.match!.points)).toBe(true);

    const noMatch = frontNineReport({ seats: SEATS4, course, scores: frontOnly, matrix, bet: bet((x) => (x.games.match.enabled = false)) });
    if (!noMatch.ok) throw new Error();
    expect(noMatch.report.pairs.every((p) => p.match === null && p.points === 0)).toBe(true);
  });

  it('不抓的配對不列入', () => {
    const r = frontNineReport({ seats: SEATS4, course, scores: frontOnly, matrix: { ...matrix, AB: { kind: 'none' } }, bet: bet() });
    if (!r.ok) throw new Error();
    expect(r.report.pairs.map((p) => p.pair)).not.toContain('AB');
  });
});
