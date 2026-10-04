// 抓球對象與讓桿設定
//   1. 抓球對象：表格點選誰跟誰抓（不抓的配對不比輸贏）
//   2. 讓桿：每一對要抓的球員一列，點選平打 / 誰讓誰、全場 / 前後九、− + 調桿數
// 文字簡寫收在「進階」裡；全部共用同一份讓桿文字，任一邊修改另一邊會同步。

import { useMemo, useState, useTransition } from 'react';
import { useApi } from '@/app/auth';
import type { Preset } from '@/data/types';
import { APP_CONFIG } from '@/engine/config';
import { fullToSplit } from '@/engine/handicap/allocate';
import { formatMatrix, isActive, normalizeForSeats, normalizeGrant, parseHandicap, type ParseResult } from '@/engine/handicap/parser';
import { allPairs, flightOf, pairKey } from '@/engine/pairs';
import { SEATS, type Grant, type HandicapMatrix, type PairKey, type Seat } from '@/engine/types';

export type { Preset };

interface Props {
  seats: Seat[];
  names: Record<Seat, string>;
  text: string;
  onTextChange: (text: string) => void;
  presets: Preset[];
  onPresetsChange: (p: Preset[]) => void;
  /** 球場差點洞序；知道時，全場切換成前後九會依實際落點換算 */
  hcpIndex?: number[] | null;
  /** 沒寫到的配對要補成什麼：單組球局平打、兩組球局不抓 */
  fallback: Grant;
}

export function useHandicapParse(text: string, seats: Seat[]): ParseResult {
  return useMemo(() => parseHandicap(text, seats), [text, seats]);
}

const sameFlight = (pair: PairKey) => flightOf(pair[0] as Seat) === flightOf(pair[1] as Seat);

export function HandicapEditor({ seats, names, text, onTextChange, presets, onPresetsChange, hcpIndex, fallback }: Props) {
  const parsed = useHandicapParse(text, seats);
  const [showText, setShowText] = useState(!parsed.ok);
  const [presetName, setPresetName] = useState('');
  const [presetMsg, setPresetMsg] = useState('');
  const [pending, start] = useTransition();
  const api = useApi();

  const pairs = allPairs(seats);
  const multi = new Set(seats.map(flightOf)).size > 1;
  const grantOf = (p: PairKey): Grant => parsed.matrix[p] ?? { kind: 'even' };
  const activePairs = pairs.filter((p) => isActive(grantOf(p)));

  const lines = text.split(/\r?\n/);
  const issuesByLine = new Map<number, string[]>();
  for (const e of [...parsed.errors, ...parsed.warnings]) {
    issuesByLine.set(e.line, [...(issuesByLine.get(e.line) ?? []), e.message]);
  }
  const errorLines = new Set(parsed.errors.map((e) => e.line));

  // 點選修改：以目前解析結果為準重寫文字，所有配對都明確寫出
  const rewrite = (change: (p: PairKey, g: Grant) => Grant) => {
    const m: HandicapMatrix = {};
    for (const p of pairs) m[p] = change(p, grantOf(p));
    onTextChange(formatMatrix(m, seats));
  };
  const setGrant = (pair: PairKey, grant: Grant) => rewrite((p, g) => (p === pair ? grant : g));
  const togglePair = (pair: PairKey) => setGrant(pair, isActive(grantOf(pair)) ? { kind: 'none' } : { kind: 'even' });

  const loadPreset = (id: string) => {
    const p = presets.find((x) => String(x.id) === id);
    if (!p) return;
    // 預設組合不綁座位：略過這場沒有的座位，沒寫到的配對依球局預設補上
    const all = parseHandicap(p.text, SEATS);
    const skipped = all.ok && Object.keys(all.matrix).some((k) => ![...k].every((c) => seats.includes(c as Seat)));
    onTextChange(normalizeForSeats(p.text, seats, fallback));
    setPresetName(p.name);
    setPresetMsg(`已帶入「${p.name}」${skipped ? '（已略過本場沒有的座位）' : ''}`);
  };

  const save = () =>
    start(async () => {
      let id: number;
      try {
        id = await api.savePreset(presetName, text);
      } catch (e) {
        return setPresetMsg((e as Error).message);
      }
      const next = presets.filter((p) => p.id !== id);
      onPresetsChange([...next, { id, name: presetName.trim(), text }].sort((a, b) => a.name.localeCompare(b.name)));
      setPresetMsg(`已儲存「${presetName.trim()}」`);
    });

  const remove = (p: Preset) => {
    if (!confirm(`刪除預設組合「${p.name}」？`)) return;
    start(async () => {
      await api.deletePreset(p.id);
      onPresetsChange(presets.filter((x) => x.id !== p.id));
    });
  };

  return (
    <div className="space-y-4">
      {presets.length > 0 && (
        <div className="card">
          <label className="label">帶入預設組合</label>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className="rounded-full bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 ring-1 ring-brand-100 active:bg-brand-100"
                onClick={() => loadPreset(String(p.id))}
              >
                {p.name}
              </button>
            ))}
          </div>
          {presetMsg.startsWith('已帶入') && <p className="mt-2 text-sm text-gray-600">{presetMsg}</p>}
        </div>
      )}

      {!parsed.ok ? (
        <div className="card">
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            下方文字規則有錯誤，請先修正（或清空文字）才能用點選設定。
          </p>
        </div>
      ) : (
        <>
          <div className="card px-2">
            <div className="mb-1 flex items-baseline justify-between px-2">
              <span className="font-bold">抓球對象</span>
              <span className="text-sm text-gray-500">
                要抓 <b className="text-brand-700">{activePairs.length}</b> / {pairs.length} 對
              </span>
            </div>
            <p className="mb-2 px-2 text-xs text-gray-500">點格子決定誰跟誰抓，綠色打勾 = 要抓。</p>
            <BetGrid seats={seats} names={names} isOn={(p) => isActive(grantOf(p))} onToggle={togglePair} />
            <div className="mt-3 flex flex-wrap gap-2 px-2">
              {multi && (
                <button
                  type="button"
                  className="btn-secondary min-h-9 px-3 text-sm"
                  onClick={() => rewrite((p, g) => (sameFlight(p) && !isActive(g) ? { kind: 'even' } : g))}
                >
                  同組互抓
                </button>
              )}
              <button
                type="button"
                className="btn-secondary min-h-9 px-3 text-sm"
                onClick={() => rewrite((_, g) => (isActive(g) ? g : { kind: 'even' }))}
              >
                全部互抓
              </button>
              <button
                type="button"
                className="btn-secondary min-h-9 px-3 text-sm"
                disabled={activePairs.length === 0}
                onClick={() => confirm('清除所有抓球對象？已設定的讓桿也會清掉。') && rewrite(() => ({ kind: 'none' }))}
              >
                全部清除
              </button>
            </div>
          </div>

          <div className="card">
            <div className="mb-3 font-bold">讓桿設定</div>
            {activePairs.length === 0 ? (
              <p className="py-3 text-center text-sm text-gray-400">先在上面的表格點選要抓的對象</p>
            ) : (
              <ul className="space-y-3">
                {activePairs.map((p) => (
                  <PairRow
                    key={p}
                    pair={p}
                    names={names}
                    grant={grantOf(p)}
                    hcpIndex={hcpIndex ?? null}
                    crossFlight={multi && !sameFlight(p)}
                    onChange={(g) => setGrant(p, g)}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="card">
        <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setShowText(!showText)}>
          <span className="font-bold">用文字快速輸入（進階）</span>
          <span className="text-gray-400">{showText ? '▲' : '▼'}</span>
        </button>
        {showText && (
          <div className="mt-3">
            <textarea
              className="field min-h-28 font-mono"
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder={'每行一條，例如：\nAB平打\nAB讓C前3後3\nAB讓D18\nC讓D5'}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-gray-500">
              <li>AB平打：A、B 不讓桿；AE不抓：A、E 不比輸贏</li>
              <li>AB讓D18：A、B 各讓 D 全場 18 桿；A讓CD5：A 各讓 C、D 5 桿</li>
              <li>A讓B前2後4：前九 2 桿、後九 4 桿（可只寫一半，如 A讓B前3）</li>
              <li>第 1 組座位 A~D、第 2 組 E~H；沒寫到的配對以平打計算</li>
            </ul>
            {issuesByLine.size > 0 && (
              <ol className="mt-3 space-y-1 text-sm">
                {lines.map((l, i) => {
                  const msgs = issuesByLine.get(i + 1);
                  if (!msgs) return null;
                  return (
                    <li
                      key={i}
                      className={`rounded-lg px-2 py-1 ${errorLines.has(i + 1) ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}
                    >
                      <span className="font-mono">
                        第 {i + 1} 行「{l.trim()}」
                      </span>
                      ：{[...new Set(msgs)].join('；')}
                    </li>
                  );
                })}
              </ol>
            )}
            {parsed.ok && parsed.unspecified.length > 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                ⚠️ 以下配對未設定，將以<b>平打</b>計算：
                {parsed.unspecified.map((p) => `${names[p[0] as Seat]}–${names[p[1] as Seat]}`).join('、')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-2 font-bold">存成預設組合</div>
        <div className="flex gap-2">
          <input className="field" placeholder="例如：週六四人組" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
          <button type="button" className="btn-secondary shrink-0" onClick={save} disabled={pending || !presetName.trim() || !parsed.ok}>
            儲存
          </button>
        </div>
        {presetMsg && !presetMsg.startsWith('已帶入') && <p className="mt-2 text-sm text-gray-600">{presetMsg}</p>}
        {presets.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {presets.map((p) => (
              <li key={p.id} className="flex items-center gap-1 rounded-full bg-gray-100 py-1 pr-1 pl-3">
                {p.name}
                <button type="button" className="min-h-8 px-2 text-gray-400" onClick={() => remove(p)} aria-label={`刪除 ${p.name}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 抓球對象表格：列與欄都是球員，點格子切換這一對要不要抓；兩組之間用粗線隔開 */
function BetGrid({
  seats,
  names,
  isOn,
  onToggle,
}: {
  seats: Seat[];
  names: Record<Seat, string>;
  isOn: (p: PairKey) => boolean;
  onToggle: (p: PairKey) => void;
}) {
  const firstOfFlight2 = seats.find((s) => flightOf(s) === 2);
  const edge = (s: Seat, side: 'l' | 't') => (s === firstOfFlight2 ? (side === 'l' ? 'border-l-2 border-l-gray-400' : 'border-t-2 border-t-gray-400') : '');
  return (
    <table className="w-full table-fixed border-collapse text-center text-sm">
      <thead>
        <tr>
          <th className="w-[4.5rem]" />
          {seats.map((s) => (
            <th key={s} className={`px-0 pb-1 font-semibold ${edge(s, 'l')}`}>
              <div className="text-xs text-brand-700">{s}</div>
              <div className="truncate text-xs font-normal text-gray-600">{names[s]}</div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {seats.map((row) => (
          <tr key={row} className={edge(row, 't')}>
            <th className="truncate pr-1 text-left text-xs font-normal">
              <b className="text-brand-700">{row}</b> {names[row]}
            </th>
            {seats.map((col) => {
              if (row === col) return <td key={col} className={`bg-gray-100 ${edge(col, 'l')}`} />;
              const pair = pairKey(row, col);
              const on = isOn(pair);
              return (
                <td key={col} className={`p-0.5 ${edge(col, 'l')}`}>
                  <button
                    type="button"
                    aria-label={`${names[row]} 與 ${names[col]}${on ? '：要抓' : '：不抓'}`}
                    aria-pressed={on}
                    onClick={() => onToggle(pair)}
                    className={`h-10 w-full rounded-md text-base font-bold ${
                      on ? 'bg-brand-600 text-white' : 'bg-white text-gray-300 ring-1 ring-gray-200 ring-inset active:bg-gray-100'
                    }`}
                  >
                    {on ? '✓' : ''}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 flex-1 truncate rounded-lg px-2 text-sm ring-1 ${
        active ? 'bg-brand-600 font-semibold text-white ring-brand-600' : 'bg-white ring-gray-300 active:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

/** − 數字 + ；只能是整數 */
function Stepper({ value, min, onChange, label }: { value: number; min: number; onChange: (v: number) => void; label: string }) {
  const max = APP_CONFIG.maxHandicap;
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex items-center gap-1">
      <span className="w-10 text-sm text-gray-600">{label}</span>
      <button
        type="button"
        className="h-11 w-11 rounded-lg bg-gray-100 text-xl font-bold active:bg-gray-200 disabled:opacity-30"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        aria-label={`${label}減 1`}
      >
        −
      </button>
      <input
        inputMode="numeric"
        className="h-11 w-14 rounded-lg border border-gray-300 text-center text-lg font-bold tabular-nums"
        value={value}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
          if (Number.isFinite(n)) onChange(clamp(n));
        }}
      />
      <button
        type="button"
        className="h-11 w-11 rounded-lg bg-gray-100 text-xl font-bold active:bg-gray-200 disabled:opacity-30"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        aria-label={`${label}加 1`}
      >
        ＋
      </button>
      <span className="text-sm text-gray-600">桿</span>
    </div>
  );
}

/**
 * 一對要抓的球員的讓桿。讓桿數維持至少 1 桿（0 桿等於平打），
 * 讓畫面狀態可以完全由讓桿文字還原。
 */
function PairRow({
  pair,
  names,
  grant,
  hcpIndex,
  crossFlight,
  onChange,
}: {
  pair: PairKey;
  names: Record<Seat, string>;
  grant: Grant;
  hcpIndex: number[] | null;
  crossFlight: boolean;
  onChange: (g: Grant) => void;
}) {
  const [x, y] = [pair[0] as Seat, pair[1] as Seat];
  const g = normalizeGrant(grant);
  const giver = g.kind === 'full' || g.kind === 'split' ? g.giver : null;
  const receiverOf = (s: Seat) => (s === x ? y : x);

  const setGiver = (s: Seat | null) => {
    if (s === null) return onChange({ kind: 'even' });
    if (g.kind === 'split') return onChange({ ...g, giver: s, receiver: receiverOf(s) });
    onChange({ kind: 'full', giver: s, receiver: receiverOf(s), n: g.kind === 'full' ? g.n : 1 });
  };

  const setMode = (mode: 'full' | 'split') => {
    if (g.kind === mode) return;
    if (mode === 'split' && g.kind === 'full') {
      // 全場 N 換成前後九：知道差點洞序就依實際落點換算（前九維持打球當下的讓桿），否則平均分、前九多一桿
      const { front, back } = hcpIndex ? fullToSplit(g.n, hcpIndex) : { front: Math.ceil(g.n / 2), back: Math.floor(g.n / 2) };
      onChange({ kind: 'split', giver: g.giver, receiver: g.receiver, front, back });
    } else if (mode === 'full' && g.kind === 'split') {
      onChange({ kind: 'full', giver: g.giver, receiver: g.receiver, n: Math.max(1, g.front + g.back) });
    }
  };

  return (
    <li className="rounded-xl bg-gray-50 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span>
          {names[x]} <span className="text-gray-400">vs</span> {names[y]}
        </span>
        {crossFlight && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">跨組</span>}
        <button type="button" className="ml-auto min-h-8 px-2 text-xs font-normal text-gray-400" onClick={() => onChange({ kind: 'none' })}>
          不抓
        </button>
      </div>
      <div className="flex gap-2">
        <Choice active={giver === null} onClick={() => setGiver(null)}>
          平打
        </Choice>
        <Choice active={giver === x} onClick={() => setGiver(x)}>
          {names[x]} 讓
        </Choice>
        <Choice active={giver === y} onClick={() => setGiver(y)}>
          {names[y]} 讓
        </Choice>
      </div>
      {(g.kind === 'full' || g.kind === 'split') && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <Choice active={g.kind === 'full'} onClick={() => setMode('full')}>
              全場
            </Choice>
            <Choice active={g.kind === 'split'} onClick={() => setMode('split')}>
              前九 / 後九分開
            </Choice>
          </div>
          {g.kind === 'full' ? (
            <Stepper label="全場" value={g.n} min={1} onChange={(n) => onChange({ ...g, n })} />
          ) : (
            <>
              <Stepper label="前九" value={g.front} min={g.back === 0 ? 1 : 0} onChange={(front) => onChange({ ...g, front })} />
              <Stepper label="後九" value={g.back} min={g.front === 0 ? 1 : 0} onChange={(back) => onChange({ ...g, back })} />
            </>
          )}
          {g.kind === 'full' && (
            <p className="text-xs text-gray-400">
              {hcpIndex
                ? '切換成前後九時，會依球場差點洞序算出前九實際讓的桿數，前九輸贏不變。'
                : '球場尚未建檔：切換成前後九時先平均分配，請自行確認前九桿數。'}
            </p>
          )}
          <p className="text-xs text-gray-500">
            {names[g.giver]} 讓 {names[g.receiver]}
            {g.kind === 'full' ? ` 全場 ${g.n} 桿` : ` 前九 ${g.front} 桿、後九 ${g.back} 桿`}
          </p>
        </div>
      )}
    </li>
  );
}
