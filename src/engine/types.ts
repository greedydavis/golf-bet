// 計分引擎共用型別。這個資料夾內的程式都是純函式，不相依 React / Prisma。

export const SEATS = ['A', 'B', 'C', 'D'] as const;
export type Seat = (typeof SEATS)[number];

/** 兩位球員的配對鍵，一律依座位排序，例如 "AB"、"CD" */
export type PairKey = `${Seat}${Seat}`;

export const HOLES = 18;
export const FRONT = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const; // 洞 index（0-based）
export const BACK = [9, 10, 11, 12, 13, 14, 15, 16, 17] as const;

export interface CourseData {
  name: string;
  pars: number[]; // 長度 18
  hcpIndex: number[]; // 長度 18，1~18 各出現一次
}

/** 一組配對的讓桿關係 */
export type Grant =
  | { kind: 'even' }
  | { kind: 'full'; giver: Seat; receiver: Seat; n: number }
  | { kind: 'split'; giver: Seat; receiver: Seat; front: number; back: number };

export type HandicapMatrix = Partial<Record<PairKey, Grant>>;

/** 每位球員 18 洞桿數，null 代表尚未填 / 辨識不出 */
export type Scores = (number | null)[];

export type Segment = 'front' | 'back' | 'total';

export const SEGMENT_LABEL: Record<Segment, string> = {
  front: '前九',
  back: '後九',
  total: '全場',
};
