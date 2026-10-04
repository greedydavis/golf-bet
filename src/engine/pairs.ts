import { FLIGHT_SIZE, SEATS, type PairKey, type Seat } from './types';

export function pairKey(a: Seat, b: Seat): PairKey {
  return (a < b ? `${a}${b}` : `${b}${a}`) as PairKey;
}

export function splitPair(key: PairKey): [Seat, Seat] {
  return [key[0] as Seat, key[1] as Seat];
}

/** 第 flight 組（1 起算）第 pos 位（0 起算）的座位 */
export function seatAt(flight: number, pos: number): Seat {
  const seat = SEATS[(flight - 1) * FLIGHT_SIZE + pos];
  if (!seat || pos < 0 || pos >= FLIGHT_SIZE) throw new Error('座位超出範圍');
  return seat;
}

/** 座位屬於第幾組（1 起算） */
export function flightOf(seat: Seat): number {
  return Math.floor(SEATS.indexOf(seat) / FLIGHT_SIZE) + 1;
}

/** 依各組人數列出座位，例如 [3, 2] → A B C E F */
export function seatsForGroups(sizes: readonly number[]): Seat[] {
  return sizes.flatMap((n, g) => Array.from({ length: n }, (_, i) => seatAt(g + 1, i)));
}

/** 單組球局的座位（A 起算） */
export function seatsFor(playerCount: number): Seat[] {
  if (playerCount < 2 || playerCount > FLIGHT_SIZE) {
    throw new Error(`每組人數需為 2~${FLIGHT_SIZE} 人`);
  }
  return seatsForGroups([playerCount]);
}

/** 所有兩兩配對，依 AB, AC, AD, BC, BD, CD 順序 */
export function allPairs(seats: readonly Seat[]): PairKey[] {
  const out: PairKey[] = [];
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) out.push(pairKey(seats[i], seats[j]));
  }
  return out;
}
