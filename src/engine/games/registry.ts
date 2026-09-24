// 賽制登錄表。新增玩法：寫一個 PairwiseGame 或 GroupGame 模組，加進 GAMES 即可。

import { z } from 'zod';
import { APP_CONFIG, type MatchOptions, type StrokeOptions } from '../config';
import type { GameModule } from './base';
import { matchPlay } from './matchPlay';
import { strokePlay } from './strokePlay';

export const GAMES: GameModule[] = [matchPlay, strokePlay];

export function getGame(id: string): GameModule | undefined {
  return GAMES.find((g) => g.id === id);
}

export interface GameSetting<O = unknown> {
  enabled: boolean;
  options: O;
}

export interface BetConfig {
  /** 每點金額 */
  pointValue: number;
  games: {
    match: GameSetting<MatchOptions>;
    stroke: GameSetting<StrokeOptions>;
    [id: string]: GameSetting<unknown>;
  };
}

export function defaultBetConfig(): BetConfig {
  const games = Object.fromEntries(
    GAMES.map((g) => [g.id, { enabled: true, options: structuredClone(g.defaultOptions) }]),
  ) as BetConfig['games'];
  return { pointValue: APP_CONFIG.defaultPointValue, games };
}

/** 驗證賭注設定；每個賽制的 options 由各自模組的 schema 檢查 */
export function validateBetConfig(input: unknown): { ok: true; value: BetConfig } | { ok: false; errors: string[] } {
  const base = z
    .object({
      pointValue: z.number().nonnegative(),
      games: z.record(z.string(), z.object({ enabled: z.boolean(), options: z.unknown() })),
    })
    .safeParse(input);
  if (!base.success) return { ok: false, errors: base.error.issues.map((i) => i.message) };

  const errors: string[] = [];
  const games: Record<string, GameSetting> = {};
  for (const game of GAMES) {
    const setting = base.data.games[game.id] ?? { enabled: false, options: game.defaultOptions };
    const opt = game.optionsSchema.safeParse(setting.options);
    if (!opt.success) {
      errors.push(`${game.label}設定錯誤：${opt.error.issues.map((i) => i.message).join('、')}`);
      continue;
    }
    games[game.id] = { enabled: setting.enabled, options: opt.data };
  }
  if (!Object.values(games).some((g) => g.enabled)) errors.push('至少要選一種賽制');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { pointValue: base.data.pointValue, games: games as BetConfig['games'] } };
}
