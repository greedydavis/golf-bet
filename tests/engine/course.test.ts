import { describe, expect, it } from 'vitest';
import { isPerNineIndex, toEighteenIndex, validateCourse } from '@/engine/course';
import { allocateFull, allocateSplit } from '@/engine/handicap/allocate';
import { course, holesWith } from './fixtures';

// 27 洞球場：前九、後九各自排 1~9
const FRONT9 = [5, 1, 9, 3, 7, 2, 8, 4, 6];
const BACK9 = [2, 8, 4, 6, 1, 9, 3, 7, 5];
const PER_NINE = [...FRONT9, ...BACK9];

describe('27 洞球場：前後九各自 1~9 的差點洞序', () => {
  it('辨識這種寫法', () => {
    expect(isPerNineIndex(PER_NINE)).toBe(true);
    expect(isPerNineIndex(course.hcpIndex)).toBe(false); // 一般 1~18
    expect(isPerNineIndex([...FRONT9, ...BACK9.slice(0, 8), null])).toBe(false); // 還沒填完
    expect(isPerNineIndex([...FRONT9, 1, 1, 3, 4, 5, 6, 7, 8, 9])).toBe(false); // 九洞內重複
    expect(isPerNineIndex([...FRONT9, 10, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(false);
  });

  it('換算成 18 洞：前九單數、後九雙數，換算後通過檢查', () => {
    const idx = toEighteenIndex(PER_NINE);
    expect(idx.slice(0, 9)).toEqual([9, 1, 17, 5, 13, 3, 15, 7, 11]);
    expect(idx.slice(9)).toEqual([4, 16, 8, 12, 2, 18, 6, 14, 10]);
    expect(validateCourse(course.pars, PER_NINE).some((e) => e.includes('重複'))).toBe(true);
    expect(validateCourse(course.pars, idx)).toEqual([]);
  });

  it('一般的 1~18 差點洞序原樣回傳', () => {
    expect(toEighteenIndex(course.hcpIndex)).toBe(course.hcpIndex);
  });

  it('前後九分開讓桿：讓的洞就是各九洞內最難的幾洞，和原本的 1~9 排名一致', () => {
    const r = allocateSplit(3, 2, toEighteenIndex(PER_NINE));
    // 前九排名 1、2、3 是第 2、6、4 洞；後九排名 1、2 是第 14、10 洞
    expect(holesWith(r, 1)).toEqual([2, 4, 6, 10, 14]);
  });

  it('全場讓桿：前九、後九輪流給，從前九最難的洞開始', () => {
    const idx = toEighteenIndex(PER_NINE);
    expect(holesWith(allocateFull(1, idx), 1)).toEqual([2]); // 前九最難
    expect(holesWith(allocateFull(2, idx), 1)).toEqual([2, 14]); // + 後九最難
    expect(holesWith(allocateFull(4, idx), 1)).toEqual([2, 6, 10, 14]); // 前後九各兩洞
    expect(allocateFull(18, idx)).toEqual(new Array(18).fill(1));
  });
});
