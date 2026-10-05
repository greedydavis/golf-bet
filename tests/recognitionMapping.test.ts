import { describe, expect, it } from 'vitest';
import { defaultMapping } from '@/data/recognitionMapping';

describe('辨識結果對應座位', () => {
  it('都沒對到名字（例如卡上寫英文名）：照成績卡順序', () => {
    const r = defaultMapping(4, [{ match: null }, { match: null }, { match: null }, { match: null }]);
    expect(r.rowOfSeat).toEqual([0, 1, 2, 3]);
    expect(r.byName).toEqual([false, false, false, false]);
  });

  it('一人一張的畫面：只有一列，對到名單第 2 位 → 只填第 2 個座位，其他不套用', () => {
    const r = defaultMapping(4, [{ match: 1 }]);
    expect(r.rowOfSeat).toEqual([-1, 0, -1, -1]);
    expect(r.byName).toEqual([false, true, false, false]);
  });

  it('成績卡順序和座位順序不同：依名字對應', () => {
    const r = defaultMapping(3, [{ match: 2 }, { match: 0 }, { match: 1 }]);
    expect(r.rowOfSeat).toEqual([1, 2, 0]);
  });

  it('部分對到名字：沒對到的列照順序填進還空著的座位', () => {
    const r = defaultMapping(4, [{ match: null }, { match: 0 }, { match: null }]);
    expect(r.rowOfSeat).toEqual([1, 0, 2, -1]);
    expect(r.byName).toEqual([true, false, false, false]);
  });

  it('列數比座位多：多出來的列不套用；舊版回應沒有 match 欄位也能用', () => {
    expect(defaultMapping(2, [{}, {}, {}]).rowOfSeat).toEqual([0, 1]);
  });

  it('match 超出範圍時忽略', () => {
    expect(defaultMapping(2, [{ match: 5 }, { match: -1 }]).rowOfSeat).toEqual([0, 1]);
  });
});
