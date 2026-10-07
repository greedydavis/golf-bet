import { HOLES, type Scores } from './types';

/** 檢查球場 Par 與差點洞序，回傳錯誤訊息（空陣列 = 正確） */
export function validateCourse(pars: (number | null)[], hcpIndex: (number | null)[]): string[] {
  const errors: string[] = [];
  if (pars.length !== HOLES) errors.push('Par 必須有 18 洞');
  if (hcpIndex.length !== HOLES) errors.push('差點洞序必須有 18 洞');
  pars.forEach((p, i) => {
    if (p === null || !Number.isInteger(p) || p < 3 || p > 6) errors.push(`第 ${i + 1} 洞 Par 不正確`);
  });
  const seen = new Set<number>();
  hcpIndex.forEach((h, i) => {
    if (h === null || !Number.isInteger(h) || h < 1 || h > 18) {
      errors.push(`第 ${i + 1} 洞差點洞序需為 1~18`);
    } else if (seen.has(h)) {
      errors.push(`差點洞序 ${h} 重複出現`);
    } else {
      seen.add(h);
    }
  });
  return errors;
}

const NINE = 9;
const isRank1to9 = (xs: (number | null)[]) =>
  xs.length === NINE && new Set(xs).size === NINE && xs.every((x) => x !== null && Number.isInteger(x) && x >= 1 && x <= NINE);

/**
 * 是否為「前九、後九各自排 1~9」的差點洞序。
 * 27 洞球場每個九洞各自排難度，當天打哪兩個九洞才組成 18 洞。
 */
export function isPerNineIndex(hcpIndex: (number | null)[]): boolean {
  return hcpIndex.length === HOLES && isRank1to9(hcpIndex.slice(0, NINE)) && isRank1to9(hcpIndex.slice(NINE));
}

/**
 * 把「前後九各自 1~9」換算成 18 洞差點洞序：前九 → 單數（1、3…17）、後九 → 雙數（2、4…18），
 * 各九洞內的難易順序不變。前後九分開讓桿的結果完全不受影響；全場讓桿會前九、後九輪流給。
 * 不是這種寫法時原樣回傳。
 */
export function toEighteenIndex<T extends number | null>(hcpIndex: T[]): T[] {
  if (!isPerNineIndex(hcpIndex)) return hcpIndex;
  return hcpIndex.map((r, i) => (i < NINE ? (r as number) * 2 - 1 : (r as number) * 2) as T);
}

export function sumHoles(values: Scores, holes?: readonly number[]): number {
  const idx = holes ?? values.map((_, i) => i);
  return idx.reduce((s, i) => s + (values[i] ?? 0), 0);
}

export function isValidStroke(v: number | null): v is number {
  return v !== null && Number.isInteger(v) && v >= 1 && v <= 20;
}
