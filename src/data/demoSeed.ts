// 示範模式的虛構資料：兩個帳號、四位球友、一座球場、一組預設讓桿、一場已結算的球局

import { defaultBetConfig } from '@/engine/games/registry';
import { parseHandicap } from '@/engine/handicap/parser';
import { settleRound } from '@/engine/settle';
import type { Seat } from '@/engine/types';
import type { RpcAs } from './demoBackend';

const PARS = [4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 3, 4, 5, 4];
const HCP = [7, 3, 15, 1, 11, 17, 5, 9, 13, 8, 4, 16, 2, 12, 18, 6, 10, 14];
const card = (o: Record<number, number>) => PARS.map((p, i) => p + (o[i + 1] ?? 0));

export async function seedDemoData(ctx: {
  createUser(email: string, displayName: string): Promise<string>;
  setRole(id: string, role: string): Promise<void>;
  rpcAs: RpcAs;
}) {
  const owner = await ctx.createUser('owner@demo.test', '示範管理者');
  const friend = await ctx.createUser('friend@demo.test', '示範球友');
  await ctx.setRole(friend, 'member');
  await ctx.createUser('new@demo.test', '新註冊帳號');

  const rpc = <T,>(fn: string, args?: Record<string, unknown>) => ctx.rpcAs<T>(owner, fn, args);

  const ids: number[] = [];
  for (const name of ['阿明', '大華', '小陳', '老王']) ids.push((await rpc<{ id: number }>('create_player', { p_name: name })).id);
  const courseId = await rpc<number>('save_course', { p_id: null, p_name: '示範球場', p_pars: PARS, p_hcp_index: HCP });
  const text = 'AB平打\nAB讓C前3後3\nAB讓D18\nC讓D2';
  await rpc('save_preset', { p_name: '週六四人組', p_text: text });

  const seats: Seat[] = ['A', 'B', 'C', 'D'];
  const matrix = parseHandicap(text, seats).matrix;
  const bet = defaultBetConfig();
  bet.games.match.options.tie = 'carry';
  const roundId = await rpc<number>('create_round', {
    p_data: { date: '2026-09-20', playerIds: ids, courseId, courseName: '示範球場', handicapText: text, matrix, bet },
  });
  const scores = {
    A: card({ 1: 1, 5: -1, 12: 1 }),
    B: card({ 2: 1, 3: 1, 9: 2, 14: 1 }),
    C: card({ 1: 2, 4: 1, 7: 2, 10: 1, 13: 2, 15: 1, 18: 2 }),
    D: card({ 1: 3, 2: 2, 6: 2, 8: 3, 11: 2, 13: 3, 16: 2, 17: 3, 18: 2 }),
  };
  await rpc('save_scores', { p_id: roundId, p_scores: scores });
  const res = settleRound({ seats, course: { name: '示範球場', pars: PARS, hcpIndex: HCP }, scores, matrix, bet });
  if (res.ok) {
    await rpc('set_round_result', {
      p_id: roundId,
      p_result: { points: res.settlement.points, money: res.settlement.money },
    });
  }
}
