// 所有 RPC 的型別化包裝。結算由前端計分引擎計算，資料庫檢查（每位球員都有、加總為 0、成績完整）後寫入。

import { defaultBetConfig, validateBetConfig } from '@/engine/games/registry';
import { flightOf } from '@/engine/pairs';
import { frontNineReport, type FrontResult } from '@/engine/interim';
import { settleRound, type RoundInput, type SettleResult } from '@/engine/settle';
import type { HandicapMatrix, Scores, Seat } from '@/engine/types';
import type { Backend } from './backend';
import type { CourseRow, CourseSnapshot, Me, Member, PlayerRow, Preset, Role, RoundDetail, RoundListItem, RoundSetupInput } from './types';

type RawRound = Omit<RoundDetail, 'bet' | 'matrix' | 'scorecardImages'> & {
  bet: unknown;
  matrix: unknown;
  scorecardImage?: string | null;
  scorecardImages?: (string | null)[];
};

function normalizeRound(r: RawRound): RoundDetail {
  const bet = validateBetConfig(r.bet);
  return {
    ...r,
    // 資料庫尚未升級到分組版本時，補上組別與照片欄位
    players: r.players.map((p) => ({ ...p, flight: p.flight ?? flightOf(p.seat) })),
    scorecardImages: r.scorecardImages ?? [r.scorecardImage ?? null, null],
    bet: bet.ok ? bet.value : defaultBetConfig(),
    matrix: (r.matrix && typeof r.matrix === 'object' ? r.matrix : {}) as HandicapMatrix,
  };
}

function roundInput(r: RoundDetail & { course: CourseSnapshot }): RoundInput {
  return {
    seats: r.players.map((p) => p.seat),
    course: { name: r.courseName, ...r.course },
    scores: Object.fromEntries(r.players.map((p) => [p.seat, p.scores])),
    matrix: r.matrix,
    bet: r.bet,
  };
}

/** 以球局目前的資料計算結算結果 */
export function settleDetail(r: RoundDetail): SettleResult {
  if (!r.course) return { ok: false, errors: ['尚未設定球場 Par 與差點洞序'] };
  return settleRound(roundInput({ ...r, course: r.course }));
}

/** 前九戰況：前九填完、整場還沒打完時的暫時輸贏 */
export function frontDetail(r: RoundDetail): FrontResult {
  if (!r.course) return { ok: false, errors: ['尚未設定球場 Par 與差點洞序'] };
  return frontNineReport(roundInput({ ...r, course: r.course }));
}

export function api(b: Backend) {
  const self = {
    me: () => b.rpc<Me | null>('me'),

    // 帳號
    listMembers: () => b.rpc<Member[]>('list_members'),
    setMemberRole: (userId: string, role: Role) => b.rpc<void>('set_member_role', { p_user_id: userId, p_role: role }),

    // 球友
    listPlayers: () => b.rpc<PlayerRow[]>('list_players'),
    createPlayer: (name: string) => b.rpc<{ id: number; name: string }>('create_player', { p_name: name }),
    updatePlayer: (id: number, data: { name?: string; active?: boolean }) =>
      b.rpc<void>('update_player', { p_id: id, p_name: data.name ?? null, p_active: data.active ?? null }),

    // 球場
    listCourses: () => b.rpc<CourseRow[]>('list_courses'),
    getCourse: (id: number) => b.rpc<CourseRow>('get_course', { p_id: id }),
    saveCourse: (c: { id?: number; name: string; pars: (number | null)[]; hcpIndex: (number | null)[] }) =>
      b.rpc<number>('save_course', { p_id: c.id ?? null, p_name: c.name, p_pars: c.pars, p_hcp_index: c.hcpIndex }),
    deleteCourse: (id: number) => b.rpc<void>('delete_course', { p_id: id }),

    // 預設讓桿組合
    listPresets: () => b.rpc<Preset[]>('list_presets'),
    savePreset: (name: string, text: string) => b.rpc<number>('save_preset', { p_name: name, p_text: text }),
    deletePreset: (id: number) => b.rpc<void>('delete_preset', { p_id: id }),

    // 球局
    listRounds: (f: { status?: 'draft' | 'settled'; playerId?: number; limit?: number } = {}) =>
      b.rpc<RoundListItem[]>('list_rounds', { p_status: f.status ?? null, p_player_id: f.playerId ?? null, p_limit: f.limit ?? null }),
    getRound: async (id: number) => normalizeRound(await b.rpc<RawRound>('get_round', { p_id: id })),
    createRound: (input: RoundSetupInput) => b.rpc<number>('create_round', { p_data: input }),

    /** 以資料庫中的最新資料重新結算；成績不完整時維持未結算 */
    async resettle(id: number): Promise<SettleResult> {
      const round = await self.getRound(id);
      const res = settleDetail(round);
      await b.rpc<void>('set_round_result', {
        p_id: id,
        p_result: res.ok ? { points: res.settlement.points, money: res.settlement.money } : null,
      });
      return res;
    },

    async updateRoundSetup(id: number, input: RoundSetupInput) {
      await b.rpc<void>('update_round_setup', { p_id: id, p_data: input });
      return self.resettle(id);
    },

    async saveScores(
      id: number,
      scores: Partial<Record<Seat, Scores>>,
      course?: { pars: (number | null)[]; hcpIndex: (number | null)[]; saveAsCourse: boolean },
    ) {
      await b.rpc<void>('save_scores', { p_id: id, p_scores: scores, p_course: course ?? null });
      return self.resettle(id);
    },

    /** 上傳某一組的成績卡照片（失敗不影響辨識，只回報錯誤） */
    async attachScorecard(id: number, file: Blob, flight = 1) {
      const path = `${id}/f${flight}-${Date.now()}.jpg`;
      await b.uploadImage(path, file);
      const old = await b.rpc<string | null>('set_round_image', { p_id: id, p_path: path, p_flight: flight });
      if (old) await b.removeImage(old).catch(() => {});
    },

    async deleteRound(id: number) {
      const images = await b.rpc<string[] | string | null>('delete_round', { p_id: id });
      for (const path of Array.isArray(images) ? images : images ? [images] : []) {
        await b.removeImage(path).catch(() => {});
      }
    },
  };
  return self;
}

export type Api = ReturnType<typeof api>;
