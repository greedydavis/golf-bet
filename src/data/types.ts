import type { BetConfig } from '@/engine/games/registry';
import type { HandicapMatrix, Scores, Seat } from '@/engine/types';

export type Role = 'owner' | 'member' | 'pending';

export const ROLE_LABEL: Record<Role, string> = {
  owner: '管理者',
  member: '球友',
  pending: '待開通',
};

export interface Me {
  id: string;
  display_name: string;
  role: Role;
  email: string | null;
}

export interface Member {
  id: string;
  display_name: string;
  email: string | null;
  role: Role;
  created_at: string;
}

export interface PlayerRow {
  id: number;
  name: string;
  active: boolean;
  rounds: number;
  wins: number;
  points: number;
  money: number;
}

export interface CourseRow {
  id: number;
  name: string;
  pars: number[];
  hcpIndex: number[];
  rounds: number;
}

export interface Preset {
  id: number;
  name: string;
  text: string;
}

export interface RoundPlayer {
  seat: Seat;
  /** 第幾組（1 或 2）；第 1 組座位 A~D、第 2 組 E~H */
  flight: number;
  playerId: number;
  name: string;
  scores: Scores;
  netPoints: number | null;
  netMoney: number | null;
}

export interface RoundListItem {
  id: number;
  date: string; // YYYY-MM-DD
  courseName: string;
  status: 'draft' | 'settled';
  players: RoundPlayer[];
}

export interface CourseSnapshot {
  pars: number[];
  hcpIndex: number[];
}

export interface RoundDetail extends RoundListItem {
  courseId: number | null;
  course: CourseSnapshot | null;
  handicapText: string;
  matrix: HandicapMatrix;
  bet: BetConfig;
  /** 每組一張成績卡照片：[第 1 組, 第 2 組] */
  scorecardImages: (string | null)[];
}

/** 開局 / 修改設定送出的內容 */
export interface RoundSetupInput {
  date: string;
  /** 依成績卡順序；flights 是對應的組別（1 或 2） */
  playerIds: number[];
  flights: number[];
  courseId: number | null;
  courseName: string;
  handicapText: string;
  matrix: HandicapMatrix;
  bet: BetConfig;
}
