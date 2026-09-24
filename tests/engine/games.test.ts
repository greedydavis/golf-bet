import { describe, expect, it } from 'vitest';
import { strokesReceived } from '@/engine/handicap/allocate';
import { matchPlay } from '@/engine/games/matchPlay';
import { strokePlay } from '@/engine/games/strokePlay';
import type { PairContext } from '@/engine/games/base';
import type { StrokeOptions } from '@/engine/config';
import type { Grant } from '@/engine/types';
import { card, course } from './fixtures';

function ctx(a: number[], b: number[], grant: Grant = { kind: 'even' }): PairContext {
  return {
    a: 'A',
    b: 'B',
    grant,
    gross: { A: a, B: b } as PairContext['gross'],
    received: strokesReceived(grant, 'A', 'B', course.hcpIndex),
    course,
  };
}

describe('比洞賽', () => {
  it('平手不計：各贏一洞 = 0', () => {
    const r = matchPlay.computePair(ctx(card(), card({ 1: 1, 2: -1 })), { pointsPerHole: 1, tie: 'none' });
    expect(r.points).toBe(0);
    expect(r.detail.holesWon).toEqual([1, 1]);
  });

  // A 第 10 洞 +1；B 第 3、11 洞 +1；其餘平手
  const A = card({ 10: 1 });
  const B = card({ 3: 1, 11: 1 });

  it('平手不計', () => {
    const r = matchPlay.computePair(ctx(A, B), { pointsPerHole: 1, tie: 'none' });
    expect(r.points).toBe(1);
    expect(r.detail.subtotal).toEqual({ front: 1, back: 0, total: 1 });
  });

  it('carry over：累積跨前後九，第 18 洞仍平手則作廢', () => {
    const r = matchPlay.computePair(ctx(A, B), { pointsPerHole: 1, tie: 'carry' });
    const h = r.detail.holes;
    expect(h[2]).toMatchObject({ winner: 'a', stake: 3, points: 3 }); // 1、2 洞平手累積
    expect(h[9]).toMatchObject({ winner: 'b', stake: 7, points: -7 }); // 4~9 洞平手，帶到第 10 洞
    expect(h[10]).toMatchObject({ winner: 'a', stake: 1, points: 1 });
    expect(r.detail.subtotal).toEqual({ front: 3, back: -6, total: -3 });
    expect(r.detail.voidedStake).toBe(7); // 12~18 洞平手作廢
    expect(r.points).toBe(-3);
  });

  it('carry over 搭配每洞 2 點', () => {
    expect(matchPlay.computePair(ctx(A, B), { pointsPerHole: 2, tie: 'carry' }).points).toBe(-6);
  });

  it('以讓桿後淨桿比勝負', () => {
    const grant: Grant = { kind: 'full', giver: 'A', receiver: 'B', n: 1 }; // 讓在差點 1 的第 4 洞
    const tie = matchPlay.computePair(ctx(card(), card({ 4: 1 }), grant), { pointsPerHole: 1, tie: 'none' });
    expect(tie.detail.holes[3]).toMatchObject({ gross: [5, 6], received: [0, 1], net: [5, 5], winner: null });
    expect(tie.points).toBe(0);

    const bWins = matchPlay.computePair(ctx(card(), card(), grant), { pointsPerHole: 1, tie: 'none' });
    expect(bWins.detail.holes[3].winner).toBe('b');
    expect(bWins.points).toBe(-1);
  });
});

const seg = (front: number, back: number, total: number): StrokeOptions['segments'] => ({
  front: { enabled: front > 0, points: front },
  back: { enabled: back > 0, points: back },
  total: { enabled: total > 0, points: total },
});

describe('總桿賽', () => {
  it('全場讓 N：只比 18 洞總桿，前九後九注不適用', () => {
    const grant: Grant = { kind: 'full', giver: 'A', receiver: 'B', n: 10 };
    const B = card({ 1: 6, 12: 6 }); // 84 桿
    const r = strokePlay.computePair(ctx(card(), B, grant), { mode: 'fixed', segments: seg(1, 1, 1) });
    const [front, back, total] = r.detail.segments;
    expect(front.skipped).toBeTruthy();
    expect(back.skipped).toBeTruthy();
    expect(total).toMatchObject({ gross: [72, 84], deduct: [0, 10], net: [72, 74], points: 1 });
    expect(r.points).toBe(1);
  });

  it('每差 1 桿計點', () => {
    const grant: Grant = { kind: 'full', giver: 'A', receiver: 'B', n: 10 };
    const r = strokePlay.computePair(ctx(card(), card({ 1: 12 }), grant), { mode: 'perStroke', segments: seg(0, 0, 2) });
    expect(r.points).toBe(4); // 淨桿差 2 × 2 點
  });

  it('前X後Y：前九扣 X、後九扣 Y、全場扣 X+Y，各注分開計算', () => {
    const grant: Grant = { kind: 'split', giver: 'A', receiver: 'B', front: 3, back: 3 };
    const B = card({ 1: 5, 10: 2 }); // 前九 41、後九 38
    const r = strokePlay.computePair(ctx(card(), B, grant), { mode: 'fixed', segments: seg(1, 1, 2) });
    const [front, back, total] = r.detail.segments;
    expect(front).toMatchObject({ gross: [36, 41], deduct: [0, 3], net: [36, 38], points: 1 });
    expect(back).toMatchObject({ gross: [36, 38], deduct: [0, 3], net: [36, 35], points: -1 });
    expect(total).toMatchObject({ gross: [72, 79], deduct: [0, 6], net: [72, 73], points: 2 });
    expect(r.points).toBe(2);
  });

  it('淨桿相同 = 0', () => {
    const r = strokePlay.computePair(ctx(card(), card()), { mode: 'fixed', segments: seg(1, 1, 1) });
    expect(r.points).toBe(0);
  });

  it('被讓方可以是 a', () => {
    const grant: Grant = { kind: 'full', giver: 'B', receiver: 'A', n: 5 };
    const r = strokePlay.computePair(ctx(card({ 1: 5 }), card(), grant), { mode: 'fixed', segments: seg(0, 0, 1) });
    expect(r.detail.segments[0].net).toEqual([72, 72]);
    expect(r.points).toBe(0);
  });
});
