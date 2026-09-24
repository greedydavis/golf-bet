// 產生可貼到 LINE 的純文字結算摘要

import { APP_CONFIG } from './config';
import { describeGrant } from './handicap/parser';
import type { Settlement } from './settle';
import type { Seat } from './types';

export interface SummaryMeta {
  date: string; // 已格式化，例如 2026/09/23
  courseName: string;
  names: Partial<Record<Seat, string>>;
}

export function signed(n: number): string {
  if (n > 0) return `+${fmt(n)}`;
  if (n < 0) return `-${fmt(-n)}`;
  return '0';
}

export function fmt(n: number): string {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

export function buildLineSummary(meta: SummaryMeta, s: Settlement): string {
  const name = (seat: Seat) => meta.names[seat] ?? seat;
  const cur = APP_CONFIG.currency;
  const seats = Object.keys(s.points) as Seat[];
  const lines: string[] = [];

  lines.push(`⛳ ${meta.date} ${meta.courseName}`);
  lines.push(`每點 ${fmt(s.pointValue)} ${cur}`);
  lines.push('');
  lines.push('【輸贏】');
  for (const seat of [...seats].sort((x, y) => s.points[y] - s.points[x])) {
    lines.push(`${name(seat)}　${signed(s.points[seat])} 點（${signed(s.money[seat])} ${cur}）`);
  }

  lines.push('');
  lines.push('【付款】');
  if (s.payments.length === 0) lines.push('無需付款');
  for (const p of s.payments) lines.push(`${name(p.from)} → ${name(p.to)}　${fmt(p.amount)} ${cur}`);

  lines.push('');
  lines.push('【對戰明細】');
  for (const p of s.pairs) {
    const parts = p.games.map((g) => `${g.label} ${signed(g.points)}`).join('、');
    lines.push(`${name(p.a)} vs ${name(p.b)}：${parts || '—'} → ${signed(p.points)}`);
    lines.push(`　（${describeGrant(p.pair, p.grant, meta.names)}）`);
  }
  for (const g of s.groups) {
    const parts = seats.map((seat) => `${name(seat)} ${signed(g.perSeat[seat] ?? 0)}`).join('、');
    lines.push(`${g.label}：${parts}`);
  }

  return lines.join('\n');
}
