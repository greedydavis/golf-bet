// 依球場差點洞序，把讓桿分配到每一洞

import { BACK, FRONT, HOLES, type Grant, type Seat } from '../types';
import { normalizeGrant } from './parser';

/**
 * 在一組洞中依難度排名分配 n 桿。
 * holes：洞 index；ranks：該組內的難度排名（1 = 最難）。
 * 每洞先得 floor(n / 洞數)，排名 <= n % 洞數 的洞再多 1 桿（超過洞數即第二輪分配）。
 */
function distribute(n: number, holes: readonly number[], rankOf: (hole: number) => number, out: number[]) {
  const size = holes.length;
  const base = Math.floor(n / size);
  const extra = n % size;
  for (const h of holes) out[h] += base + (rankOf(h) <= extra ? 1 : 0);
}

/** 在指定洞組中，依差點洞序重新排名 1..k */
function rankWithin(holes: readonly number[], hcpIndex: number[]): Map<number, number> {
  const sorted = [...holes].sort((a, b) => hcpIndex[a] - hcpIndex[b]);
  return new Map(sorted.map((h, i) => [h, i + 1]));
}

/** 全場讓 n 桿：依 18 洞差點洞序分配 */
export function allocateFull(n: number, hcpIndex: number[]): number[] {
  const out = new Array<number>(HOLES).fill(0);
  const all = Array.from({ length: HOLES }, (_, i) => i);
  distribute(n, all, (h) => hcpIndex[h], out);
  return out;
}

/** 前九讓 front 桿、後九讓 back 桿：各自在九洞內依差點洞序排名分配 */
export function allocateSplit(front: number, back: number, hcpIndex: number[]): number[] {
  const out = new Array<number>(HOLES).fill(0);
  const fr = rankWithin(FRONT, hcpIndex);
  const br = rankWithin(BACK, hcpIndex);
  distribute(front, FRONT, (h) => fr.get(h)!, out);
  distribute(back, BACK, (h) => br.get(h)!, out);
  return out;
}

/** 回傳配對雙方每洞「被讓」的桿數（讓方全為 0） */
export function strokesReceived(grant: Grant | undefined, a: Seat, b: Seat, hcpIndex: number[]): Record<Seat, number[]> {
  const zeros = () => new Array<number>(HOLES).fill(0);
  const res = { [a]: zeros(), [b]: zeros() } as Record<Seat, number[]>;
  const g = grant ? normalizeGrant(grant) : { kind: 'even' as const };
  if (g.kind === 'full') res[g.receiver] = allocateFull(g.n, hcpIndex);
  if (g.kind === 'split') res[g.receiver] = allocateSplit(g.front, g.back, hcpIndex);
  return res;
}
