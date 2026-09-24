import type { z } from 'zod';
import type { CourseData, Grant, Seat } from '../types';

/** 兩兩對戰賽制的輸入。gross / received 已確認 18 洞完整。 */
export interface PairContext {
  a: Seat; // 座位較前者（點數以 a 的角度表示）
  b: Seat;
  grant: Grant;
  gross: Record<Seat, number[]>;
  /** 每洞被讓的桿數（讓方全為 0） */
  received: Record<Seat, number[]>;
  course: CourseData;
}

export interface PairGameResult<D = unknown> {
  /** a 贏得的點數（負數代表 a 輸），b 的點數即為其相反數 */
  points: number;
  detail: D;
}

/** 全體一起計算的賽制輸入（例如拉斯維加斯、鬥地主） */
export interface GroupContext {
  seats: Seat[];
  gross: Record<Seat, number[]>;
  course: CourseData;
}

export interface GroupGameResult<D = unknown> {
  /** 每人點數，總和必須為 0 */
  perSeat: Partial<Record<Seat, number>>;
  detail: D;
}

interface GameBase<O> {
  id: string;
  label: string;
  optionsSchema: z.ZodType<O>;
  defaultOptions: O;
}

export interface PairwiseGame<O = any, D = any> extends GameBase<O> {
  scope: 'pairwise';
  computePair(ctx: PairContext, options: O): PairGameResult<D>;
}

export interface GroupGame<O = any, D = any> extends GameBase<O> {
  scope: 'group';
  compute(ctx: GroupContext, options: O): GroupGameResult<D>;
}

export type GameModule = PairwiseGame | GroupGame;
