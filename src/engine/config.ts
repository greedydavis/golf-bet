// ★ 所有規則參數與預設值集中在這裡。
// 新增玩法時：在 games/ 新增模組 → 在這裡加預設值 → 在 games/registry.ts 登錄。

import type { Segment } from './types';

export const APP_CONFIG = {
  minPlayers: 2,
  maxPlayers: 4,
  currency: '元',
  /** 每點金額預設值 */
  defaultPointValue: 100,
  /** 單洞桿數合理範圍（輸入檢查用） */
  minStroke: 1,
  maxStroke: 20,
  /** 讓桿數上限（輸入檢查用） */
  maxHandicap: 54,
} as const;

// ---- 比洞賽 ----
export type TieRule = 'none' | 'carry';

export const TIE_RULE_LABEL: Record<TieRule, string> = {
  none: '平手不計',
  carry: '平手累積到下一洞',
};

export interface MatchOptions {
  /** 每洞贏幾點 */
  pointsPerHole: number;
  /** 平手處理；carry 會跨前後九一路累積，第 18 洞仍平手則作廢 */
  tie: TieRule;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  pointsPerHole: 1,
  tie: 'none',
};

// ---- 總桿賽 ----
export type StrokeMode = 'fixed' | 'perStroke';

export const STROKE_MODE_LABEL: Record<StrokeMode, string> = {
  fixed: '贏方固定得點',
  perStroke: '每差 1 桿計點',
};

export interface StrokeSegmentOption {
  enabled: boolean;
  points: number;
}

export interface StrokeOptions {
  mode: StrokeMode;
  /**
   * 前九 / 後九 / 全場 各自一注。
   * 讓桿為「全場 N 桿」的配對只比全場總桿（前九、後九注不適用）。
   */
  segments: Record<Segment, StrokeSegmentOption>;
}

export const DEFAULT_STROKE_OPTIONS: StrokeOptions = {
  mode: 'fixed',
  segments: {
    front: { enabled: false, points: 1 },
    back: { enabled: false, points: 1 },
    total: { enabled: true, points: 1 },
  },
};
