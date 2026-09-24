// 讓桿設定：每一對球員一列，用點選設定（平打 / 誰讓誰、全場 / 前後九、− + 調桿數）。
// 文字簡寫收在「進階」裡；兩者共用同一份讓桿文字，任一邊修改另一邊會同步。

import { useMemo, useState, useTransition } from 'react';
import { useApi } from '@/app/auth';
import type { Preset } from '@/data/types';
import { APP_CONFIG } from '@/engine/config';
import { formatMatrix, normalizeForSeats, normalizeGrant, parseHandicap, type ParseResult } from '@/engine/handicap/parser';
import { allPairs } from '@/engine/pairs';
import type { Grant, HandicapMatrix, PairKey, Seat } from '@/engine/types';

export type { Preset };

interface Props {
  seats: Seat[];
  names: Record<Seat, string>;
  text: string;
  onTextChange: (text: string) => void;
  presets: Preset[];
  onPresetsChange: (p: Preset[]) => void;
}

export function useHandicapParse(text: string, seats: Seat[]): ParseResult {
  return useMemo(() => parseHandicap(text, seats), [text, seats]);
}

export function HandicapEditor({ seats, names, text, onTextChange, presets, onPresetsChange }: Props) {
  const parsed = useHandicapParse(text, seats);
  const [showText, setShowText] = useState(!parsed.ok);
  const [presetName, setPresetName] = useState('');
  const [presetMsg, setPresetMsg] = useState('');
  const [pending, start] = useTransition();
  const api = useApi();

  const lines = text.split(/\r?\n/);
  const issuesByLine = new Map<number, string[]>();
  for (const e of [...parsed.errors, ...parsed.warnings]) {
    issuesByLine.set(e.line, [...(issuesByLine.get(e.line) ?? []), e.message]);
  }
  const errorLines = new Set(parsed.errors.map((e) => e.line));

  // 點選修改：以目前解析結果為準重寫文字，所有配對都明確寫出
  const setGrant = (pair: PairKey, grant: Grant) => {
    const m: HandicapMatrix = {};
    for (const p of allPairs(seats)) m[p] = parsed.matrix[p] ?? { kind: 'even' };
    m[pair] = grant;
    onTextChange(formatMatrix(m, seats));
  };

  const loadPreset = (id: string) => {
    const p = presets.find((x) => String(x.id) === id);
    if (!p) return;
    // 預設組合不綁座位：人數比組合少時略過不存在的座位
    const all = parseHandicap(p.text, ['A', 'B', 'C', 'D']);
    const skipped = all.ok && Object.keys(all.matrix).some((k) => ![...k].every((c) => seats.includes(c as Seat)));
    onTextChange(normalizeForSeats(p.text, seats));
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
        </div>
      )}

      <div className="card">
        <div className="mb-3 font-bold">讓桿設定</div>
        {!parsed.ok ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            下方文字規則有錯誤，請先修正（或清空文字）才能用點選設定。
          </p>
        ) : (
          <ul className="space-y-3">
            {allPairs(seats).map((p) => (
              <PairRow key={p} pair={p} names={names} grant={parsed.matrix[p]} onChange={(g) => setGrant(p, g)} />
            ))}
          </ul>
        )}
      </div>

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
              <li>AB平打：A、B 不讓桿</li>
              <li>AB讓D18：A、B 各讓 D 全場 18 桿；A讓CD5：A 各讓 C、D 5 桿</li>
              <li>A讓B前2後4：前九 2 桿、後九 4 桿（可只寫一半，如 A讓B前3）</li>
              <li>沒寫到的配對以平打計算</li>
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
        {presetMsg && <p className="mt-2 text-sm text-gray-600">{presetMsg}</p>}
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
 * 一對球員的讓桿。讓桿數維持至少 1 桿（0 桿等於平打），
 * 讓畫面狀態可以完全由讓桿文字還原。
 */
function PairRow({ pair, names, grant, onChange }: { pair: PairKey; names: Record<Seat, string>; grant?: Grant; onChange: (g: Grant) => void }) {
  const [x, y] = [pair[0] as Seat, pair[1] as Seat];
  const g = grant ? normalizeGrant(grant) : ({ kind: 'even' } as const);
  const giver = g.kind === 'even' ? null : g.giver;
  const receiverOf = (s: Seat) => (s === x ? y : x);

  const setGiver = (s: Seat | null) => {
    if (s === null) return onChange({ kind: 'even' });
    if (g.kind === 'split') return onChange({ ...g, giver: s, receiver: receiverOf(s) });
    onChange({ kind: 'full', giver: s, receiver: receiverOf(s), n: g.kind === 'full' ? g.n : 1 });
  };

  const setMode = (mode: 'full' | 'split') => {
    if (!giver || g.kind === 'even' || g.kind === mode) return;
    const r = receiverOf(giver);
    if (mode === 'split' && g.kind === 'full') {
      // 全場 N 換成前後九：盡量平均分，前九多一桿
      onChange({ kind: 'split', giver, receiver: r, front: Math.ceil(g.n / 2), back: Math.floor(g.n / 2) });
    } else if (mode === 'full' && g.kind === 'split') {
      onChange({ kind: 'full', giver, receiver: r, n: Math.max(1, g.front + g.back) });
    }
  };

  return (
    <li className="rounded-xl bg-gray-50 p-3">
      <div className="mb-2 text-sm font-semibold">
        {names[x]} <span className="text-gray-400">vs</span> {names[y]}
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
      {g.kind !== 'even' && (
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
          <p className="text-xs text-gray-500">
            {names[g.giver]} 讓 {names[g.receiver]}
            {g.kind === 'full' ? ` 全場 ${g.n} 桿` : ` 前九 ${g.front} 桿、後九 ${g.back} 桿`}
          </p>
        </div>
      )}
    </li>
  );
}
