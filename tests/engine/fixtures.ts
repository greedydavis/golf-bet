import type { CourseData, Seat } from '@/engine/types';

// 前九差點洞序為奇數、後九為偶數（台灣球場常見排法）
export const course: CourseData = {
  name: '測試球場',
  pars: [4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 3, 4, 5, 4],
  hcpIndex: [7, 3, 15, 1, 11, 17, 5, 9, 13, 8, 4, 16, 2, 12, 18, 6, 10, 14],
};

/** 以 par 為基礎，指定洞 (1-based) 的桿數差 */
export function card(overrides: Record<number, number> = {}): number[] {
  return course.pars.map((p, i) => p + (overrides[i + 1] ?? 0));
}

export const SEATS4: Seat[] = ['A', 'B', 'C', 'D'];
export const SEATS3: Seat[] = ['A', 'B', 'C'];

/** 回傳值為 1 的洞號（1-based），方便檢查分配結果 */
export function holesWith(values: number[], v: number): number[] {
  return values.map((x, i) => (x === v ? i + 1 : 0)).filter(Boolean);
}
