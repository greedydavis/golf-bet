// 讓桿簡寫語法解析
//
//   AB平打        A、B 互不讓桿（可多人，例如 ABC平打 = 三人兩兩平打）
//   AB讓D18       A 讓 D 18 桿、B 讓 D 18 桿
//   A讓CD5        A 讓 C 5 桿、A 讓 D 5 桿
//   AB讓C前3後3   前九 3 桿、後九 3 桿
//   A讓B前3       只寫一半 = 另一半 0 桿
//
// 一行可以寫多條規則（以空白、逗號、分號隔開）。解析失敗或衝突一律回報錯誤，不自動猜。

import { allPairs, pairKey } from '../pairs';
import type { Grant, HandicapMatrix, PairKey, Seat } from '../types';

export interface LineIssue {
  line: number; // 1-based
  text: string;
  message: string;
  /** 衝突錯誤所屬的配對 */
  pair?: PairKey;
}

export interface ParseResult {
  /** 成功解析且沒有衝突的配對（未寫到的配對不在其中） */
  matrix: HandicapMatrix;
  errors: LineIssue[];
  warnings: LineIssue[];
  /** 沒有寫到的配對：預設平打，需提醒使用者 */
  unspecified: PairKey[];
  /** 規則互相衝突的配對 */
  conflicted: PairKey[];
  ok: boolean;
}

interface Entry {
  pair: PairKey;
  grant: Grant;
  line: number;
  text: string;
}

const FORMAT_HINT = '格式例如「AB平打」「AB讓C10」「A讓B前2後4」';

/** 全形轉半形、轉大寫、簡體字轉繁體 */
export function normalizeToken(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/让/g, '讓')
    .replace(/后/g, '後')
    .toUpperCase();
}

/** 讓桿數為 0 的關係等同平打 */
export function normalizeGrant(g: Grant): Grant {
  if (g.kind === 'full' && g.n === 0) return { kind: 'even' };
  if (g.kind === 'split' && g.front === 0 && g.back === 0) return { kind: 'even' };
  return g;
}

export function grantsEqual(x: Grant, y: Grant): boolean {
  const a = normalizeGrant(x);
  const b = normalizeGrant(y);
  if (a.kind !== b.kind) return false;
  if (a.kind === 'even') return true;
  if (a.giver !== (b as typeof a).giver || a.receiver !== (b as typeof a).receiver) return false;
  if (a.kind === 'full') return a.n === (b as typeof a).n;
  return a.front === (b as typeof a).front && a.back === (b as typeof a).back;
}

type TokenResult = { ok: true; entries: Omit<Entry, 'line' | 'text'>[] } | { ok: false; message: string };

function parseSeats(letters: string, seats: readonly Seat[]): Seat[] | string {
  const out: Seat[] = [];
  for (const ch of letters) {
    if (!seats.includes(ch as Seat)) {
      return `座位「${ch}」不存在（本場只有 ${seats.join('、')}）`;
    }
    if (!out.includes(ch as Seat)) out.push(ch as Seat);
  }
  return out;
}

function parseToken(token: string, seats: readonly Seat[]): TokenResult {
  const head = /^([A-Z]+)(平打|讓)(.*)$/.exec(token);
  if (!head) return { ok: false, message: `無法解析，${FORMAT_HINT}` };
  const [, leftLetters, verb, rest] = head;

  const left = parseSeats(leftLetters, seats);
  if (typeof left === 'string') return { ok: false, message: left };

  if (verb === '平打') {
    if (rest !== '') return { ok: false, message: `「平打」後面不應有其他內容，${FORMAT_HINT}` };
    if (left.length < 2) return { ok: false, message: '平打至少要寫兩位球員，例如「AB平打」' };
    return {
      ok: true,
      entries: allPairs([...left].sort()).map((pair) => ({ pair, grant: { kind: 'even' } })),
    };
  }

  const recv = /^([A-Z]+)(.*)$/.exec(rest);
  if (!recv) return { ok: false, message: `「讓」後面要接被讓的球員，${FORMAT_HINT}` };
  const [, rightLetters, amount] = recv;
  const right = parseSeats(rightLetters, seats);
  if (typeof right === 'string') return { ok: false, message: right };

  const self = left.find((s) => right.includes(s));
  if (self) return { ok: false, message: `${self} 不能讓自己` };

  if (/\d*\.\d*/.test(amount) && /\d/.test(amount)) {
    return { ok: false, message: '讓桿數只接受整數，不可輸入小數' };
  }
  if (amount === '') return { ok: false, message: '缺少讓桿數，例如「A讓B10」或「A讓B前2後4」' };

  const make = (giver: Seat, receiver: Seat): Grant | null => {
    if (/^\d+$/.test(amount)) return { kind: 'full', giver, receiver, n: Number(amount) };
    const split = /^(?:前(\d+))?(?:後(\d+))?$/.exec(amount);
    if (split && (split[1] !== undefined || split[2] !== undefined)) {
      return {
        kind: 'split',
        giver,
        receiver,
        front: Number(split[1] ?? 0),
        back: Number(split[2] ?? 0),
      };
    }
    return null;
  };

  if (!make(left[0], right[0])) {
    return { ok: false, message: `讓桿數格式錯誤「${amount}」，${FORMAT_HINT}` };
  }

  const entries: Omit<Entry, 'line' | 'text'>[] = [];
  for (const g of left) {
    for (const r of right) {
      entries.push({ pair: pairKey(g, r), grant: normalizeGrant(make(g, r)!) });
    }
  }
  return { ok: true, entries };
}

/**
 * 把一行切成多條規則。逗號、分號一定是分隔；空白則要看前後文：
 * 「A 讓 B 10」是一條規則，「AB平打 CD平打」是兩條。
 * 作法：依空白切片後逐片合併，當目前累積的內容已是完整規則、且下一片以字母開頭時才切開。
 */
function tokenize(rawLine: string, seats: readonly Seat[]): string[] {
  const tokens: string[] = [];
  for (const segment of normalizeToken(rawLine).split(/[,，;；、。]+/)) {
    const pieces = segment.split(/\s+/).filter(Boolean);
    let current = '';
    for (const piece of pieces) {
      if (current && /^[A-Z]/.test(piece) && parseToken(current, seats).ok) {
        tokens.push(current);
        current = '';
      }
      current += piece;
    }
    if (current) tokens.push(current);
  }
  return tokens;
}

export function parseHandicap(text: string, seats: readonly Seat[]): ParseResult {
  const errors: LineIssue[] = [];
  const warnings: LineIssue[] = [];
  const byPair = new Map<PairKey, Entry[]>();

  text.split(/\r?\n/).forEach((rawLine, idx) => {
    const line = idx + 1;
    for (const token of tokenize(rawLine, seats)) {
      const res = parseToken(token, seats);
      if (!res.ok) {
        errors.push({ line, text: token, message: res.message });
        continue;
      }
      for (const e of res.entries) {
        const list = byPair.get(e.pair) ?? [];
        list.push({ ...e, line, text: token });
        byPair.set(e.pair, list);
      }
    }
  });

  const matrix: HandicapMatrix = {};
  const conflicted: PairKey[] = [];

  for (const [pair, entries] of byPair) {
    const first = entries[0];
    const conflict = entries.find((e) => !grantsEqual(e.grant, first.grant));
    if (conflict) {
      conflicted.push(pair);
      const lines = [...new Set(entries.map((e) => e.line))].join('、');
      for (const e of entries) {
        errors.push({
          line: e.line,
          text: e.text,
          pair,
          message: `${pair[0]}、${pair[1]} 的讓桿規則互相衝突（第 ${lines} 行），請擇一`,
        });
      }
      continue;
    }
    for (const dup of entries.slice(1)) {
      warnings.push({
        line: dup.line,
        text: dup.text,
        message: `${pair[0]}、${pair[1]} 的讓桿與第 ${first.line} 行重複`,
      });
    }
    matrix[pair] = first.grant;
  }

  const unspecified = allPairs(seats).filter((p) => !byPair.has(p));
  errors.sort((a, b) => a.line - b.line);

  return { matrix, errors, warnings, unspecified, conflicted, ok: errors.length === 0 };
}

/** 把未寫到的配對補成平打，得到完整矩陣 */
export function completeMatrix(matrix: HandicapMatrix, seats: readonly Seat[]): Record<PairKey, Grant> {
  const out = {} as Record<PairKey, Grant>;
  for (const p of allPairs(seats)) out[p] = matrix[p] ?? { kind: 'even' };
  return out;
}

/** 單一配對轉回簡寫，例如 "A讓B前2後4" */
export function formatGrant(pair: PairKey, grant: Grant): string {
  const g = normalizeGrant(grant);
  if (g.kind === 'even') return `${pair}平打`;
  if (g.kind === 'full') return `${g.giver}讓${g.receiver}${g.n}`;
  const f = g.front ? `前${g.front}` : '';
  const b = g.back ? `後${g.back}` : '';
  return `${g.giver}讓${g.receiver}${f}${b}`;
}

/** 矩陣轉回簡寫文字（在矩陣上修改後同步回文字框用） */
export function formatMatrix(matrix: HandicapMatrix, seats: readonly Seat[]): string {
  return allPairs(seats)
    .filter((p) => matrix[p])
    .map((p) => formatGrant(p, matrix[p]!))
    .join('\n');
}

/** 人看的描述，例如「A 讓 B 前九 2 桿、後九 4 桿」 */
export function describeGrant(pair: PairKey, grant: Grant | undefined, names?: Partial<Record<Seat, string>>): string {
  const n = (s: Seat) => names?.[s] ?? s;
  const g = grant ? normalizeGrant(grant) : { kind: 'even' as const };
  if (g.kind === 'even') return `${n(pair[0] as Seat)} 與 ${n(pair[1] as Seat)} 平打`;
  if (g.kind === 'full') return `${n(g.giver)} 讓 ${n(g.receiver)} 全場 ${g.n} 桿`;
  return `${n(g.giver)} 讓 ${n(g.receiver)} 前九 ${g.front} 桿、後九 ${g.back} 桿`;
}
