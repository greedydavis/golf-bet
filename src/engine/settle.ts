// 整場結算：跑完所有啟用的賽制 → 每人淨點數 → 付款建議

import { validateCourse, isValidStroke } from './course';
import { strokesReceived } from './handicap/allocate';
import { completeMatrix } from './handicap/parser';
import { allPairs, splitPair } from './pairs';
import { round2, suggestPayments, type Payment } from './payments';
import { GAMES, type BetConfig } from './games/registry';
import { HOLES, type CourseData, type Grant, type HandicapMatrix, type PairKey, type Scores, type Seat } from './types';

export interface RoundInput {
  seats: Seat[];
  course: CourseData;
  scores: Partial<Record<Seat, Scores>>;
  matrix: HandicapMatrix;
  bet: BetConfig;
}

export interface PairGameOutcome {
  gameId: string;
  label: string;
  points: number; // a 的角度
  detail: unknown;
}

export interface PairSettlement {
  pair: PairKey;
  a: Seat;
  b: Seat;
  grant: Grant;
  games: PairGameOutcome[];
  points: number; // a 的角度
}

export interface GroupOutcome {
  gameId: string;
  label: string;
  perSeat: Partial<Record<Seat, number>>;
  detail: unknown;
}

export interface Settlement {
  pairs: PairSettlement[];
  groups: GroupOutcome[];
  /** 每人淨點數 */
  points: Record<Seat, number>;
  /** 每人淨金額 = 點數 × 每點金額 */
  money: Record<Seat, number>;
  pointValue: number;
  /** 付款建議（金額） */
  payments: Payment<Seat>[];
}

export type SettleResult = { ok: true; settlement: Settlement } | { ok: false; errors: string[] };

export function validateScores(seats: Seat[], scores: Partial<Record<Seat, Scores>>): string[] {
  const errors: string[] = [];
  for (const s of seats) {
    const row = scores[s];
    if (!row || row.length !== HOLES) {
      errors.push(`${s} 的成績不足 18 洞`);
      continue;
    }
    const bad = row.map((v, i) => (isValidStroke(v) ? null : i + 1)).filter((x) => x !== null);
    if (bad.length) errors.push(`${s} 第 ${bad.join('、')} 洞桿數未填或不正確`);
  }
  return errors;
}

export function settleRound(input: RoundInput): SettleResult {
  const { seats, course, bet } = input;
  const errors = [...validateCourse(course.pars, course.hcpIndex), ...validateScores(seats, input.scores)];
  if (errors.length) return { ok: false, errors };

  const gross = input.scores as Record<Seat, number[]>;
  const matrix = completeMatrix(input.matrix, seats);
  const points = Object.fromEntries(seats.map((s) => [s, 0])) as Record<Seat, number>;
  const enabled = GAMES.filter((g) => bet.games[g.id]?.enabled);

  const pairs: PairSettlement[] = allPairs(seats).map((pair) => {
    const [a, b] = splitPair(pair);
    const grant = matrix[pair];
    const received = strokesReceived(grant, a, b, course.hcpIndex);
    const games: PairGameOutcome[] = [];
    for (const game of enabled) {
      if (game.scope !== 'pairwise') continue;
      const r = game.computePair({ a, b, grant, gross, received, course }, bet.games[game.id].options);
      games.push({ gameId: game.id, label: game.label, points: round2(r.points), detail: r.detail });
    }
    const total = round2(games.reduce((s, g) => s + g.points, 0));
    points[a] += total;
    points[b] -= total;
    return { pair, a, b, grant, games, points: total };
  });

  const groups: GroupOutcome[] = [];
  for (const game of enabled) {
    if (game.scope !== 'group') continue;
    const r = game.compute({ seats, gross, course }, bet.games[game.id].options);
    for (const s of seats) points[s] += r.perSeat[s] ?? 0;
    groups.push({ gameId: game.id, label: game.label, perSeat: r.perSeat, detail: r.detail });
  }

  for (const s of seats) points[s] = round2(points[s]);
  const sum = round2(seats.reduce((acc, s) => acc + points[s], 0));
  if (sum !== 0) return { ok: false, errors: [`結算錯誤：全體加總為 ${sum}，不等於 0`] };

  const money = Object.fromEntries(seats.map((s) => [s, round2(points[s] * bet.pointValue)])) as Record<Seat, number>;

  return {
    ok: true,
    settlement: {
      pairs,
      groups,
      points,
      money,
      pointValue: bet.pointValue,
      payments: suggestPayments(money),
    },
  };
}
