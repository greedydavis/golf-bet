// 比洞賽：每洞以讓桿後的淨桿比勝負，每洞計點；前九 / 後九只是小計。

import { z } from 'zod';
import { DEFAULT_MATCH_OPTIONS, type MatchOptions } from '../config';
import { HOLES, type Segment } from '../types';
import type { PairwiseGame } from './base';

export interface MatchHole {
  hole: number; // 1-based
  gross: [number, number]; // [a, b]
  received: [number, number];
  net: [number, number];
  winner: 'a' | 'b' | null;
  /** 這洞的注數（含累積） */
  stake: number;
  /** a 在這洞得到的點數 */
  points: number;
}

export interface MatchDetail {
  holes: MatchHole[];
  subtotal: Record<Segment, number>;
  holesWon: [number, number];
  /** 打完 18 洞仍未分出勝負而作廢的累積注數 */
  voidedStake: number;
}

export const matchPlay: PairwiseGame<MatchOptions, MatchDetail> = {
  id: 'match',
  label: '比洞',
  scope: 'pairwise',
  optionsSchema: z.object({
    pointsPerHole: z.number().nonnegative(),
    tie: z.enum(['none', 'carry']),
  }),
  defaultOptions: DEFAULT_MATCH_OPTIONS,

  computePair(ctx, opt) {
    const { a, b } = ctx;
    const holes: MatchHole[] = [];
    const subtotal: Record<Segment, number> = { front: 0, back: 0, total: 0 };
    const holesWon: [number, number] = [0, 0];
    let carried = 0;

    for (let i = 0; i < HOLES; i++) {
      const gross: [number, number] = [ctx.gross[a][i], ctx.gross[b][i]];
      const received: [number, number] = [ctx.received[a][i], ctx.received[b][i]];
      const net: [number, number] = [gross[0] - received[0], gross[1] - received[1]];
      const stake = 1 + carried;
      let winner: MatchHole['winner'] = null;
      let points = 0;

      if (net[0] < net[1]) winner = 'a';
      else if (net[1] < net[0]) winner = 'b';

      if (winner) {
        points = (winner === 'a' ? 1 : -1) * stake * opt.pointsPerHole;
        holesWon[winner === 'a' ? 0 : 1]++;
        carried = 0;
      } else if (opt.tie === 'carry') {
        carried = stake;
      }

      subtotal[i < 9 ? 'front' : 'back'] += points;
      subtotal.total += points;
      holes.push({ hole: i + 1, gross, received, net, winner, stake, points });
    }

    return {
      points: subtotal.total,
      detail: { holes, subtotal, holesWon, voidedStake: carried },
    };
  },
};
