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

export function sumHoles(values: Scores, holes?: readonly number[]): number {
  const idx = holes ?? values.map((_, i) => i);
  return idx.reduce((s, i) => s + (values[i] ?? 0), 0);
}

export function isValidStroke(v: number | null): v is number {
  return v !== null && Number.isInteger(v) && v >= 1 && v <= 20;
}
