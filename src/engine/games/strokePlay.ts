// 總桿賽：前九 / 後九 / 全場 各自一注。
//   全場讓 N 桿 → 只比 18 洞總桿（扣 N），前九、後九注不適用
//   前 X 後 Y   → 前九扣 X、後九扣 Y、全場扣 X+Y

import { z } from 'zod';
import { sumHoles } from '../course';
import { DEFAULT_STROKE_OPTIONS, type StrokeOptions } from '../config';
import { normalizeGrant } from '../handicap/parser';
import { BACK, FRONT, type Grant, type Seat, type Segment } from '../types';
import type { PairwiseGame } from './base';

export interface StrokeSegmentDetail {
  segment: Segment;
  gross: [number, number]; // [a, b]
  deduct: [number, number];
  net: [number, number];
  points: number; // a 得到的點數
  /** 此注不適用的原因（有值時 points = 0） */
  skipped?: string;
}

export interface StrokeDetail {
  segments: StrokeSegmentDetail[];
}

const SEGMENTS: Segment[] = ['front', 'back', 'total'];
const HOLES_OF: Record<Segment, readonly number[] | undefined> = { front: FRONT, back: BACK, total: undefined };

/** 回傳此注中 seat 可扣的桿數；null 代表這組讓桿方式不適用此注 */
export function strokeDeduction(grant: Grant, seat: Seat, segment: Segment): number | null {
  const g = normalizeGrant(grant);
  if (g.kind === 'even') return 0;
  if (g.kind === 'full') {
    if (segment !== 'total') return null;
    return g.receiver === seat ? g.n : 0;
  }
  if (g.receiver !== seat) return 0;
  if (segment === 'front') return g.front;
  if (segment === 'back') return g.back;
  return g.front + g.back;
}

const segmentSchema = z.object({ enabled: z.boolean(), points: z.number().nonnegative() });

export const strokePlay: PairwiseGame<StrokeOptions, StrokeDetail> = {
  id: 'stroke',
  label: '總桿',
  scope: 'pairwise',
  optionsSchema: z.object({
    mode: z.enum(['fixed', 'perStroke']),
    segments: z.object({ front: segmentSchema, back: segmentSchema, total: segmentSchema }),
  }),
  defaultOptions: DEFAULT_STROKE_OPTIONS,

  computePair(ctx, opt) {
    const { a, b, grant } = ctx;
    const segments: StrokeSegmentDetail[] = [];
    let total = 0;

    for (const segment of SEGMENTS) {
      const setting = opt.segments[segment];
      if (!setting.enabled) continue;

      const holes = HOLES_OF[segment];
      const gross: [number, number] = [sumHoles(ctx.gross[a], holes), sumHoles(ctx.gross[b], holes)];
      const da = strokeDeduction(grant, a, segment);
      const db = strokeDeduction(grant, b, segment);

      if (da === null || db === null) {
        segments.push({
          segment,
          gross,
          deduct: [0, 0],
          net: gross,
          points: 0,
          skipped: '全場讓桿只比 18 洞總桿',
        });
        continue;
      }

      const net: [number, number] = [gross[0] - da, gross[1] - db];
      const diff = net[1] - net[0]; // 正數 = a 桿數較少 = a 贏
      const points = opt.mode === 'fixed' ? Math.sign(diff) * setting.points : diff * setting.points;
      total += points;
      segments.push({ segment, gross, deduct: [da, db], net, points });
    }

    return { points: total, detail: { segments } };
  },
};
