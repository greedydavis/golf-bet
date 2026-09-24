import { describe, expect, it } from 'vitest';
import { allocateFull, allocateSplit, fullToSplit, strokesReceived } from '@/engine/handicap/allocate';
import { course, holesWith } from './fixtures';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const hcp = course.hcpIndex;

describe('全場讓桿依差點洞序分配', () => {
  it('讓 0 桿', () => {
    expect(sum(allocateFull(0, hcp))).toBe(0);
  });

  it('讓 3 桿：差點洞序 1~3 的洞（第 4、13、2 洞）', () => {
    const r = allocateFull(3, hcp);
    expect(holesWith(r, 1)).toEqual([2, 4, 13]);
    expect(sum(r)).toBe(3);
  });

  it('讓 18 桿：每洞 1 桿', () => {
    expect(allocateFull(18, hcp)).toEqual(new Array(18).fill(1));
  });

  it('讓 20 桿：超過 18 桿，差點洞序 1、2 的洞第二輪各再 1 桿', () => {
    const r = allocateFull(20, hcp);
    expect(holesWith(r, 2)).toEqual([4, 13]);
    expect(holesWith(r, 1)).toHaveLength(16);
    expect(sum(r)).toBe(20);
  });

  it('讓 40 桿：每洞 2 桿，差點洞序 1~4 再多 1 桿', () => {
    const r = allocateFull(40, hcp);
    expect(holesWith(r, 3)).toEqual([2, 4, 11, 13]);
    expect(sum(r)).toBe(40);
  });
});

describe('前後九分開讓桿', () => {
  it('前3後3：各九洞內最難的 3 洞', () => {
    const r = allocateSplit(3, 3, hcp);
    // 前九：差點 1(第4洞)、3(第2洞)、5(第7洞)；後九：差點 2(第13洞)、4(第11洞)、6(第16洞)
    expect(holesWith(r, 1)).toEqual([2, 4, 7, 11, 13, 16]);
  });

  it('前2後4', () => {
    const r = allocateSplit(2, 4, hcp);
    expect(holesWith(r, 1).filter((h) => h <= 9)).toEqual([2, 4]);
    expect(holesWith(r, 1).filter((h) => h > 9)).toEqual([10, 11, 13, 16]);
  });

  it('前九讓 11 桿：超過 9 桿，在前九內第二輪分配，後九不受影響', () => {
    const r = allocateSplit(11, 0, hcp);
    expect(holesWith(r, 2)).toEqual([2, 4]);
    expect(r.slice(0, 9).every((x) => x >= 1)).toBe(true);
    expect(sum(r.slice(9))).toBe(0);
    expect(sum(r)).toBe(11);
  });

  it('後九讓 9 桿：後九每洞 1 桿', () => {
    const r = allocateSplit(0, 9, hcp);
    expect(r).toEqual([...new Array(9).fill(0), ...new Array(9).fill(1)]);
  });

  it('前後九的差點洞序不是奇偶排列時，仍以九洞內排名分配', () => {
    const custom = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const r = allocateSplit(2, 2, custom);
    expect(holesWith(r, 1)).toEqual([1, 2, 10, 11]);
  });
});

describe('strokesReceived', () => {
  it('被讓方拿到桿數，讓方全為 0', () => {
    const r = strokesReceived({ kind: 'full', giver: 'A', receiver: 'B', n: 5 }, 'A', 'B', hcp);
    expect(sum(r.A)).toBe(0);
    expect(sum(r.B)).toBe(5);
  });

  it('平打雙方皆 0', () => {
    const r = strokesReceived({ kind: 'even' }, 'A', 'B', hcp);
    expect(sum(r.A) + sum(r.B)).toBe(0);
  });
});

describe('全場換成前後九分開', () => {
  it('前九單數、後九雙數的球場：全場 10 桿 = 前 5 後 5', () => {
    expect(fullToSplit(10, hcp)).toEqual({ front: 5, back: 5 });
  });

  it('全場 3 桿：差點 1、3 在前九，2 在後九 = 前 2 後 1', () => {
    expect(fullToSplit(3, hcp)).toEqual({ front: 2, back: 1 });
  });

  it('差點洞序不是奇偶排列：依實際落點計算', () => {
    const custom = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    expect(fullToSplit(10, custom)).toEqual({ front: 9, back: 1 });
    expect(fullToSplit(20, custom)).toEqual({ front: 11, back: 9 });
  });

  it('換算後前九的分配與全場讓桿完全相同', () => {
    const custom = [2, 5, 11, 1, 8, 16, 4, 13, 9, 7, 3, 15, 6, 12, 18, 10, 14, 17];
    for (const n of [1, 4, 9, 13, 18, 22]) {
      const { front, back } = fullToSplit(n, custom);
      const full = allocateFull(n, custom);
      const split = allocateSplit(front, back, custom);
      expect(split.slice(0, 9)).toEqual(full.slice(0, 9));
      expect(split.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });
});
