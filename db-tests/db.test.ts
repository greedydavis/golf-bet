import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

const PARS = [4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 3, 4, 5, 4];
const HCP = [7, 3, 15, 1, 11, 17, 5, 9, 13, 8, 4, 16, 2, 12, 18, 6, 10, 14];
const BET = { pointValue: 100, games: {} };
const card = (d = 0) => PARS.map((p) => p + d);

let t: TestDb;
let owner: string;
let member: string;
let pending: string;

beforeAll(async () => {
  t = await createTestDb();
  ({ owner, member, pending } = t.users);
});

async function newPlayers(...names: string[]) {
  const ids: number[] = [];
  for (const n of names) ids.push((await t.rpc<{ id: number }>(member, 'create_player', { p_name: n })).id);
  return ids;
}

async function newRound(playerIds: number[], extra: Record<string, unknown> = {}) {
  return t.rpc<number>(member, 'create_round', {
    p_data: { date: '2026-09-20', playerIds, courseId: null, courseName: '測試球場', handicapText: '', matrix: {}, bet: BET, ...extra },
  });
}

describe('帳號與權限', () => {
  it('第一個註冊的帳號成為 owner，之後是 pending', async () => {
    const rows = await t.sql<{ id: string; role: string }>(`select id, role from app.profiles`);
    expect(rows.find((r) => r.id === owner)?.role).toBe('owner');
    expect(rows.find((r) => r.id === pending)?.role).toBe('pending');
  });

  it('pending 與未登入不能讀資料', async () => {
    await expect(t.rpc(pending, 'list_players')).rejects.toThrow('沒有權限');
    await expect(t.rpc(null, 'list_players')).rejects.toThrow(/permission denied|沒有權限/);
  });

  it('前端角色不能直接讀寫資料表', async () => {
    await expect(
      t.db.transaction(async (tx) => {
        await tx.query('set local role authenticated');
        await tx.query('select * from app.players');
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('me() 回傳自己的角色', async () => {
    expect(await t.rpc(member, 'me')).toMatchObject({ id: member, role: 'member' });
    expect(await t.rpc(pending, 'me')).toMatchObject({ role: 'pending' });
  });

  it('只有 owner 能管理帳號，且不能改自己', async () => {
    await expect(t.rpc(member, 'list_members')).rejects.toThrow('只有管理者');
    await expect(t.rpc(member, 'set_member_role', { p_user_id: pending, p_role: 'member' })).rejects.toThrow('只有管理者');
    await expect(t.rpc(owner, 'set_member_role', { p_user_id: owner, p_role: 'member' })).rejects.toThrow('不能修改自己');
    const members = await t.rpc<unknown[]>(owner, 'list_members');
    expect(members).toHaveLength(3);
  });
});

describe('球友、球場、預設組合', () => {
  it('球友名字不可重複（不分大小寫、前後空白）', async () => {
    await newPlayers('Tom');
    await expect(t.rpc(member, 'create_player', { p_name: ' tom ' })).rejects.toThrow('已經在名單中');
  });

  it('球場 Par / 差點洞序驗證', async () => {
    await expect(t.rpc(member, 'save_course', { p_id: null, p_name: 'X', p_pars: PARS.slice(0, 17), p_hcp_index: HCP })).rejects.toThrow(
      'Par',
    );
    const dupHcp = [...HCP];
    dupHcp[0] = dupHcp[1];
    await expect(t.rpc(member, 'save_course', { p_id: null, p_name: 'X', p_pars: PARS, p_hcp_index: dupHcp })).rejects.toThrow(
      '差點洞序',
    );
    const id = await t.rpc<number>(member, 'save_course', { p_id: null, p_name: '好球場', p_pars: PARS, p_hcp_index: HCP });
    expect(await t.rpc(member, 'get_course', { p_id: id })).toMatchObject({ name: '好球場', pars: PARS, hcpIndex: HCP });
    await expect(t.rpc(member, 'save_course', { p_id: null, p_name: '好球場', p_pars: PARS, p_hcp_index: HCP })).rejects.toThrow(
      '已存在',
    );
  });

  it('預設組合同名覆蓋', async () => {
    await t.rpc(member, 'save_preset', { p_name: '週六組', p_text: 'AB平打' });
    await t.rpc(member, 'save_preset', { p_name: '週六組', p_text: 'A讓B3' });
    const list = await t.rpc<{ name: string; text: string }[]>(member, 'list_presets');
    expect(list.filter((p) => p.name === '週六組')).toEqual([expect.objectContaining({ text: 'A讓B3' })]);
  });
});

describe('球局', () => {
  it('建立球局：座位依順序，人數與重複檢查', async () => {
    const [a, b] = await newPlayers('甲1', '乙1');
    await expect(newRound([a])).rejects.toThrow('2~4');
    await expect(newRound([a, a])).rejects.toThrow('重複');
    await expect(newRound([a, b], { matrix: { AC: { kind: 'even' } } })).rejects.toThrow('不存在的配對');
    const id = await newRound([a, b]);
    const round = await t.rpc<{ players: { seat: string; playerId: number }[]; status: string; course: null }>(member, 'get_round', {
      p_id: id,
    });
    expect(round.players.map((p) => [p.seat, p.playerId])).toEqual([
      ['A', a],
      ['B', b],
    ]);
    expect(round.status).toBe('draft');
    expect(round.course).toBeNull();
  });

  it('完整流程：成績 → 補球場 → 結算 → 統計', async () => {
    const [a, b] = await newPlayers('甲2', '乙2');
    const id = await newRound([a, b]);

    // 成績未填完不能結算
    await t.rpc(member, 'save_scores', { p_id: id, p_scores: { A: card(), B: [...card(1).slice(0, 17), null] } });
    const result = { points: { A: 3, B: -3 }, money: { A: 300, B: -300 } };
    await expect(t.rpc(member, 'set_round_result', { p_id: id, p_result: result })).rejects.toThrow(/球場|成績/);

    // 桿數格式錯誤
    await expect(t.rpc(member, 'save_scores', { p_id: id, p_scores: { A: [...card().slice(0, 17), 4.5] } })).rejects.toThrow('格式錯誤');

    // 補齊成績並把球場存檔
    await t.rpc(member, 'save_scores', {
      p_id: id,
      p_scores: { B: card(1) },
      p_course: { pars: PARS, hcpIndex: HCP, saveAsCourse: true },
    });
    const courses = await t.rpc<{ name: string; id: number }[]>(member, 'list_courses');
    const saved = courses.find((c) => c.name === '測試球場');
    expect(saved).toBeTruthy();

    // 加總不為 0 被擋
    await expect(
      t.rpc(member, 'set_round_result', { p_id: id, p_result: { points: { A: 3, B: -2 }, money: { A: 300, B: -200 } } }),
    ).rejects.toThrow('不為 0');
    // 座位不符被擋
    await expect(t.rpc(member, 'set_round_result', { p_id: id, p_result: { points: { A: 0 }, money: { A: 0 } } })).rejects.toThrow(
      '不符',
    );

    await t.rpc(member, 'set_round_result', { p_id: id, p_result: result });
    const round = await t.rpc<{ status: string; courseId: number; players: { netMoney: number }[] }>(member, 'get_round', { p_id: id });
    expect(round.status).toBe('settled');
    expect(round.courseId).toBe(saved!.id);
    expect(round.players.map((p) => p.netMoney)).toEqual([300, -300]);

    const players = await t.rpc<{ id: number; rounds: number; wins: number; money: number }[]>(member, 'list_players');
    expect(players.find((p) => p.id === a)).toMatchObject({ rounds: 1, wins: 1, money: 300 });
    expect(players.find((p) => p.id === b)).toMatchObject({ rounds: 1, wins: 0, money: -300 });

    // 修改成績後退回未結算，統計不再計入
    await t.rpc(member, 'save_scores', { p_id: id, p_scores: { A: card(1) } });
    expect((await t.rpc<{ status: string }>(member, 'get_round', { p_id: id })).status).toBe('draft');
    const after = await t.rpc<{ id: number; rounds: number }[]>(member, 'list_players');
    expect(after.find((p) => p.id === a)?.rounds).toBe(0);
  });

  it('修改設定：成績依座位保留，球場沒換時保留快照', async () => {
    const [a, b, c] = await newPlayers('甲3', '乙3', '丙3');
    const id = await newRound([a, b]);
    await t.rpc(member, 'save_scores', { p_id: id, p_scores: { A: card(), B: card(1) }, p_course: { pars: PARS, hcpIndex: HCP, saveAsCourse: false } });
    await t.rpc(member, 'update_round_setup', {
      p_id: id,
      p_data: { date: '2026-09-21', playerIds: [a, b, c], courseId: null, courseName: '測試球場', handicapText: 'A讓B3', matrix: { AB: { kind: 'full', giver: 'A', receiver: 'B', n: 3 } }, bet: BET },
    });
    const round = await t.rpc<{ date: string; course: unknown; players: { seat: string; scores: unknown[] }[] }>(member, 'get_round', {
      p_id: id,
    });
    expect(round.date).toBe('2026-09-21');
    expect(round.course).toEqual({ pars: PARS, hcpIndex: HCP });
    expect(round.players[0].scores).toEqual(card());
    expect(round.players[2].scores).toEqual(new Array(18).fill(null));
  });

  it('列表篩選：狀態、球友', async () => {
    const [a, b] = await newPlayers('甲4', '乙4');
    const id = await newRound([a, b]);
    const drafts = await t.rpc<{ id: number }[]>(member, 'list_rounds', { p_status: 'draft' });
    expect(drafts.some((r) => r.id === id)).toBe(true);
    const mine = await t.rpc<{ id: number }[]>(member, 'list_rounds', { p_player_id: a });
    expect(mine.map((r) => r.id)).toEqual([id]);
  });

  it('成績卡照片路徑與刪除', async () => {
    const [a, b] = await newPlayers('甲5', '乙5');
    const id = await newRound([a, b]);
    await expect(t.rpc(member, 'set_round_image', { p_id: id, p_path: `999/x.jpg` })).rejects.toThrow('路徑');
    expect(await t.rpc(member, 'set_round_image', { p_id: id, p_path: `${id}/1.jpg` })).toBeNull();
    expect(await t.rpc(member, 'set_round_image', { p_id: id, p_path: `${id}/2.jpg` })).toBe(`${id}/1.jpg`);
    expect(await t.rpc(member, 'delete_round', { p_id: id })).toBe(`${id}/2.jpg`);
    await expect(t.rpc(member, 'get_round', { p_id: id })).rejects.toThrow('找不到');
  });

  it('有球局的球友不能被刪除（資料表層保護）', async () => {
    const [a, b] = await newPlayers('甲6', '乙6');
    await newRound([a, b]);
    await expect(t.sql(`delete from app.players where id = $1`, [a])).rejects.toThrow(/foreign key/);
  });
});
