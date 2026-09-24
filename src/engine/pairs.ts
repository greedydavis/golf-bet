import { SEATS, type PairKey, type Seat } from './types';

export function pairKey(a: Seat, b: Seat): PairKey {
  return (a < b ? `${a}${b}` : `${b}${a}`) as PairKey;
}

export function splitPair(key: PairKey): [Seat, Seat] {
  return [key[0] as Seat, key[1] as Seat];
}

export function seatsFor(playerCount: number): Seat[] {
  if (playerCount < 2 || playerCount > SEATS.length) {
    throw new Error(`球員人數需為 2~${SEATS.length} 人`);
  }
  return SEATS.slice(0, playerCount);
}

/** 所有兩兩配對，依 AB, AC, AD, BC, BD, CD 順序 */
export function allPairs(seats: readonly Seat[]): PairKey[] {
  const out: PairKey[] = [];
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) out.push(pairKey(seats[i], seats[j]));
  }
  return out;
}
