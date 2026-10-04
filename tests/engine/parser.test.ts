import { describe, expect, it } from 'vitest';
import { completeMatrix, formatMatrix, isActive, normalizeForSeats, parseHandicap } from '@/engine/handicap/parser';
import { flightOf, seatAt, seatsForGroups } from '@/engine/pairs';
import type { Seat } from '@/engine/types';
import { SEATS3, SEATS4 } from './fixtures';

describe('讓桿語法解析', () => {
  it('AB平打：平打，其餘配對列為未設定', () => {
    const r = parseHandicap('AB平打', SEATS4);
    expect(r.ok).toBe(true);
    expect(r.matrix.AB).toEqual({ kind: 'even' });
    expect(r.unspecified).toEqual(['AC', 'AD', 'BC', 'BD', 'CD']);
  });

  it('ABC平打：三人兩兩平打', () => {
    const r = parseHandicap('ABC平打', SEATS4);
    expect(Object.keys(r.matrix).sort()).toEqual(['AB', 'AC', 'BC']);
  });

  it('多人讓一人：AB讓D18', () => {
    const r = parseHandicap('AB讓D18', SEATS4);
    expect(r.ok).toBe(true);
    expect(r.matrix.AD).toEqual({ kind: 'full', giver: 'A', receiver: 'D', n: 18 });
    expect(r.matrix.BD).toEqual({ kind: 'full', giver: 'B', receiver: 'D', n: 18 });
    expect(r.unspecified).toEqual(['AB', 'AC', 'BC', 'CD']);
  });

  it('一人讓多人：A讓CD5', () => {
    const r = parseHandicap('A讓CD5', SEATS4);
    expect(r.matrix.AC).toEqual({ kind: 'full', giver: 'A', receiver: 'C', n: 5 });
    expect(r.matrix.AD).toEqual({ kind: 'full', giver: 'A', receiver: 'D', n: 5 });
  });

  it('多人讓多人：AB讓CD3 產生 4 組', () => {
    const r = parseHandicap('AB讓CD3', SEATS4);
    expect(Object.keys(r.matrix).sort()).toEqual(['AC', 'AD', 'BC', 'BD']);
  });

  it('前後九分開：AB讓C前3後3、A讓D前2後4', () => {
    const r = parseHandicap('AB讓C前3後3\nA讓D前2後4', SEATS4);
    expect(r.ok).toBe(true);
    expect(r.matrix.AC).toEqual({ kind: 'split', giver: 'A', receiver: 'C', front: 3, back: 3 });
    expect(r.matrix.BC).toEqual({ kind: 'split', giver: 'B', receiver: 'C', front: 3, back: 3 });
    expect(r.matrix.AD).toEqual({ kind: 'split', giver: 'A', receiver: 'D', front: 2, back: 4 });
  });

  it('只寫一半：A讓B前3 = 後九 0；A讓C後2 = 前九 0', () => {
    const r = parseHandicap('A讓B前3\nA讓C後2', SEATS4);
    expect(r.matrix.AB).toEqual({ kind: 'split', giver: 'A', receiver: 'B', front: 3, back: 0 });
    expect(r.matrix.AC).toEqual({ kind: 'split', giver: 'A', receiver: 'C', front: 0, back: 2 });
  });

  it('沒寫前後 = 全場', () => {
    expect(parseHandicap('A讓B10', SEATS4).matrix.AB).toEqual({ kind: 'full', giver: 'A', receiver: 'B', n: 10 });
  });

  it('讓 0 桿視同平打', () => {
    expect(parseHandicap('A讓B0', SEATS4).matrix.AB).toEqual({ kind: 'even' });
  });

  it('容錯：全形、小寫、簡體、空白、一行多條', () => {
    const r = parseHandicap('ａｂ平打，c 让 d 前2 后1\nA 讓 C 5  B讓D4', SEATS4);
    expect(r.errors).toEqual([]);
    expect(r.matrix.AB).toEqual({ kind: 'even' });
    expect(r.matrix.CD).toEqual({ kind: 'split', giver: 'C', receiver: 'D', front: 2, back: 1 });
    expect(r.matrix.AC).toEqual({ kind: 'full', giver: 'A', receiver: 'C', n: 5 });
    expect(r.matrix.BD).toEqual({ kind: 'full', giver: 'B', receiver: 'D', n: 4 });
  });

  it('空白分隔的多條平打', () => {
    const r = parseHandicap('AB平打 CD平打', SEATS4);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.matrix).sort()).toEqual(['AB', 'CD']);
  });

  it('完整四人設定：無未設定配對', () => {
    const r = parseHandicap('AB平打\nAB讓C前3後3\nAB讓D18\nC讓D5', SEATS4);
    expect(r.ok).toBe(true);
    expect(r.unspecified).toEqual([]);
  });

  describe('錯誤', () => {
    it('小數：全場', () => {
      const r = parseHandicap('A讓B2.5', SEATS4);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatchObject({ line: 1, message: expect.stringContaining('整數') });
      expect(r.matrix.AB).toBeUndefined();
    });

    it('小數：前後九', () => {
      const r = parseHandicap('AB平打\nC讓D前1.5後2', SEATS4);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatchObject({ line: 2, message: expect.stringContaining('整數') });
      expect(r.matrix.AB).toEqual({ kind: 'even' }); // 其他正確的行仍然解析
    });

    it('同一對寫兩次不同讓桿 → 衝突，兩行都標紅，不自動選', () => {
      const r = parseHandicap('A讓B10\nC讓D3\nA讓B8', SEATS4);
      expect(r.ok).toBe(false);
      expect(r.conflicted).toEqual(['AB']);
      expect(r.errors.map((e) => e.line)).toEqual([1, 3]);
      expect(r.matrix.AB).toBeUndefined();
      expect(r.matrix.CD).toBeDefined();
    });

    it('方向相反也是衝突：A讓B5 與 B讓A5', () => {
      const r = parseHandicap('A讓B5\nB讓A5', SEATS4);
      expect(r.conflicted).toEqual(['AB']);
    });

    it('平打與讓桿衝突：AB平打 與 AB讓C3 不衝突，但與 A讓B3 衝突', () => {
      expect(parseHandicap('AB平打\nAB讓C3', SEATS4).ok).toBe(true);
      expect(parseHandicap('AB平打\nA讓B3', SEATS4).conflicted).toEqual(['AB']);
    });

    it('全場與前後九寫法不同也算衝突：A讓B6 與 A讓B前3後3', () => {
      expect(parseHandicap('A讓B6\nA讓B前3後3', SEATS4).conflicted).toEqual(['AB']);
    });

    it('完全相同的重複只給警告', () => {
      const r = parseHandicap('AB讓C10\nA讓C10', SEATS4);
      expect(r.ok).toBe(true);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].line).toBe(2);
    });

    it('本場沒有的座位', () => {
      const r = parseHandicap('A讓D5', SEATS3);
      expect(r.errors[0].message).toContain('D');
    });

    it('自己讓自己', () => {
      expect(parseHandicap('AB讓B5', SEATS4).errors[0].message).toContain('不能讓自己');
    });

    it('缺少讓桿數 / 無法解析 / 平打只寫一人', () => {
      expect(parseHandicap('A讓B', SEATS4).errors[0].message).toContain('缺少讓桿數');
      expect(parseHandicap('亂打一通', SEATS4).errors[0].message).toContain('無法解析');
      expect(parseHandicap('A平打', SEATS4).errors[0].message).toContain('兩位');
      expect(parseHandicap('A讓B十', SEATS4).ok).toBe(false);
    });
  });

  it('completeMatrix 補上未設定配對為平打', () => {
    const r = parseHandicap('A讓B3', SEATS3);
    const m = completeMatrix(r.matrix, SEATS3);
    expect(m).toEqual({
      AB: { kind: 'full', giver: 'A', receiver: 'B', n: 3 },
      AC: { kind: 'even' },
      BC: { kind: 'even' },
    });
  });

  it('formatMatrix 可再解析回相同矩陣', () => {
    const r = parseHandicap('AB平打\nAB讓C前3後3\nAB讓D18\nD讓C後2', SEATS4);
    const text = formatMatrix(r.matrix, SEATS4);
    expect(parseHandicap(text, SEATS4).matrix).toEqual(r.matrix);
  });
});

describe('normalizeForSeats', () => {
  it('空白文字：所有配對寫成平打', () => {
    expect(normalizeForSeats('', SEATS3)).toBe('AB平打\nAC平打\nBC平打');
  });

  it('從 4 人改成 3 人：去掉 D 的配對，其餘保留', () => {
    expect(normalizeForSeats('AB讓D18\nA讓C前3\nB讓C5', SEATS3)).toBe('AB平打\nA讓C前3\nB讓C5');
  });

  it('文字有錯誤時原樣回傳', () => {
    expect(normalizeForSeats('A讓B2.5', SEATS3)).toBe('A讓B2.5');
  });
});

describe('不抓（指定抓球對象）', () => {
  const SEATS6: Seat[] = ['A', 'B', 'C', 'E', 'F', 'G']; // 第 1 組 3 人、第 2 組 3 人

  it('AE不抓：這一對不比輸贏', () => {
    const r = parseHandicap('AE不抓', SEATS6);
    expect(r.ok).toBe(true);
    expect(r.matrix.AE).toEqual({ kind: 'none' });
  });

  it('多人不抓：ABE不抓 = 三人兩兩不抓', () => {
    expect(Object.keys(parseHandicap('ABE不抓', SEATS6).matrix).sort()).toEqual(['AB', 'AE', 'BE']);
  });

  it('不抓與平打 / 讓桿衝突', () => {
    expect(parseHandicap('AE不抓\nAE平打', SEATS6).conflicted).toEqual(['AE']);
    expect(parseHandicap('AE不抓\nA讓E3', SEATS6).conflicted).toEqual(['AE']);
  });

  it('跨組讓桿：A讓EF5、座位 D 不在這場', () => {
    const r = parseHandicap('A讓EF5', SEATS6);
    expect(r.matrix.AE).toEqual({ kind: 'full', giver: 'A', receiver: 'E', n: 5 });
    expect(parseHandicap('A讓D5', SEATS6).ok).toBe(false);
  });

  it('formatMatrix 寫出不抓，可再解析回來', () => {
    const r = parseHandicap('AB平打\nAE不抓\nB讓E3', SEATS6);
    const text = formatMatrix(r.matrix, SEATS6);
    expect(text).toContain('AE不抓');
    expect(parseHandicap(text, SEATS6).matrix).toEqual(r.matrix);
  });

  it('normalizeForSeats：兩組球局沒寫到的配對補成不抓', () => {
    const text = normalizeForSeats('AB平打\nA讓E3', ['A', 'B', 'E'], { kind: 'none' });
    expect(text).toBe('AB平打\nA讓E3\nBE不抓');
  });

  it('isActive', () => {
    expect(isActive({ kind: 'none' })).toBe(false);
    expect(isActive({ kind: 'even' })).toBe(true);
    expect(isActive(undefined)).toBe(true); // 沒寫到 = 平打
  });
});

describe('座位與組別', () => {
  it('第 1 組 A~D、第 2 組 E~H，人數不滿時代號不位移', () => {
    expect(seatsForGroups([3, 2])).toEqual(['A', 'B', 'C', 'E', 'F']);
    expect(seatsForGroups([4, 4])).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(seatAt(2, 0)).toBe('E');
    expect(flightOf('D')).toBe(1);
    expect(flightOf('E')).toBe(2);
    expect(() => seatAt(1, 4)).toThrow();
  });
});
