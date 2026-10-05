// 前九戰況：前九打完、後九還沒打時的暫時輸贏，用來決定後九要不要調整讓桿。
// 只要所有球員的前九成績都填完就能計算；不寫入資料庫、不影響正式結算。

import { validateCourse, isValidStroke, sumHoles } from './course';
import { matchPlay, type MatchDetail } from './games/matchPlay';
import { strokeDeduction } from './games/strokePlay';
import { strokesReceived } from './handicap/allocate';
import { completeMatrix, isActive } from './handicap/parser';
import { allPairs, splitPair } from './pairs';
import { round2 } from './payments';
import type { RoundInput } from './settle';
import { FRONT, type Grant, type PairKey, type Seat } from './types';

const NINE = FRONT.length;

export interface FrontPair {
  pair: PairKey;
  a: Seat;
  b: Seat;
  grant: Grant;
  /** 比洞前九（沒玩比洞時為 null）；點數以 a 的角度表示 */
  match: { points: number; detail: MatchDetail } | null;
  /** 前九總桿比較（資訊用，不論有沒有下這一注都會算） */
  stroke: {
    gross: [number, number];
    /** 前九實際被讓的桿數：依差點洞序落在前九的讓桿 */
    received: [number, number];
    net: [number, number];
    /** 有下「前九總桿」這一注時的點數；沒下、或全場讓桿不適用時為 null */
    betPoints: number | null;
  };
  /** 前九已確定的點數（比洞 + 前九總桿注），以 a 的角度表示 */
  points: number;
}

export interface FrontReport {
  pairs: FrontPair[];
  /** 每人前九暫計點數與金額（還沒算後九、全場總桿注，以及尚未分出勝負的累積） */
  points: Record<Seat, number>;
  money: Record<Seat, number>;
  pointValue: number;
}

export type FrontResult = { ok: true; report: FrontReport } | { ok: false; errors: string[] };

/** 所有球員的前九是否都已填完 */
export function frontNineComplete(seats: Seat[], scores: RoundInput['scores']): boolean {
  return seats.every((s) => FRONT.every((h) => isValidStroke(scores[s]?.[h] ?? null)));
}

export function frontNineReport(input: RoundInput): FrontResult {
  const { seats, course, bet } = input;
  const errors = validateCourse(course.pars, course.hcpIndex);
  for (const s of seats) {
    const bad = FRONT.filter((h) => !isValidStroke(input.scores[s]?.[h] ?? null)).map((h) => h + 1);
    if (bad.length) errors.push(`${s} 前九第 ${bad.join('、')} 洞桿數未填或不正確`);
  }
  if (errors.length) return { ok: false, errors };

  // 後九還沒打：補 0 讓陣列長度一致，計算時只會用到前九
  const gross = Object.fromEntries(
    seats.map((s) => [s, Array.from({ length: 18 }, (_, i) => (i < NINE ? (input.scores[s]![i] as number) : 0))]),
  ) as Record<Seat, number[]>;
  const matrix = completeMatrix(input.matrix, seats);
  const points = Object.fromEntries(seats.map((s) => [s, 0])) as Record<Seat, number>;
  const matchSetting = bet.games.match;
  const strokeSetting = bet.games.stroke;
  const frontBet = strokeSetting?.enabled ? strokeSetting.options.segments.front : null;

  const active = allPairs(seats).filter((p) => isActive(matrix[p]));
  if (active.length === 0) return { ok: false, errors: ['尚未設定任何抓球對象'] };

  const pairs: FrontPair[] = active.map((pair) => {
    const [a, b] = splitPair(pair);
    const grant = matrix[pair];
    const received = strokesReceived(grant, a, b, course.hcpIndex);

    const match = matchSetting?.enabled
      ? (() => {
          const r = matchPlay.computePair({ a, b, grant, gross, received, course, upTo: NINE }, matchSetting.options);
          return { points: round2(r.points), detail: r.detail as MatchDetail };
        })()
      : null;

    const g: [number, number] = [sumHoles(gross[a], FRONT), sumHoles(gross[b], FRONT)];
    const rec: [number, number] = [sumHoles(received[a], FRONT), sumHoles(received[b], FRONT)];
    const net: [number, number] = [g[0] - rec[0], g[1] - rec[1]];
    let betPoints: number | null = null;
    if (frontBet?.enabled) {
      const da = strokeDeduction(grant, a, 'front');
      const db = strokeDeduction(grant, b, 'front');
      if (da !== null && db !== null) {
        const diff = g[1] - db - (g[0] - da); // 正數 = a 桿數較少 = a 贏
        betPoints = round2(strokeSetting.options.mode === 'fixed' ? Math.sign(diff) * frontBet.points : diff * frontBet.points);
      }
    }

    const total = round2((match?.points ?? 0) + (betPoints ?? 0));
    points[a] += total;
    points[b] -= total;
    return { pair, a, b, grant, match, stroke: { gross: g, received: rec, net, betPoints }, points: total };
  });

  for (const s of seats) points[s] = round2(points[s]);
  const money = Object.fromEntries(seats.map((s) => [s, round2(points[s] * bet.pointValue)])) as Record<Seat, number>;
  return { ok: true, report: { pairs, points, money, pointValue: bet.pointValue } };
}
