import { useMemo, useState, useTransition } from 'react';
import { describeGrant, formatMatrix, parseHandicap, type ParseResult } from '@/engine/handicap/parser';
import { allPairs, pairKey } from '@/engine/pairs';
import type { Grant, HandicapMatrix, PairKey, Seat } from '@/engine/types';
import { useApi } from '@/app/auth';
import type { Preset } from '@/data/types';

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

/** 矩陣格子內容：列（row）讓 欄（col）幾桿 */
function cellText(grant: Grant | undefined, row: Seat, col: Seat): { text: string; tone: 'give' | 'get' | 'even' | 'none' } {
  if (!grant) return { text: '—', tone: 'none' };
  if (grant.kind === 'even') return { text: '平', tone: 'even' };
  const v = grant.kind === 'full' ? `${grant.n}` : `${grant.front}/${grant.back}`;
  if (grant.giver === row && grant.receiver === col) return { text: v, tone: 'give' };
  return { text: `-${v}`, tone: 'get' };
}

export function HandicapEditor({ seats, names, text, onTextChange, presets, onPresetsChange }: Props) {
  const parsed = useHandicapParse(text, seats);
  const [editing, setEditing] = useState<PairKey | null>(null);
  const [presetName, setPresetName] = useState('');
  const [presetMsg, setPresetMsg] = useState('');
  const [pending, start] = useTransition();
  const api = useApi();

  const lines = text.split(/\r?\n/);
  const errorsByLine = new Map<number, string[]>();
  for (const e of [...parsed.errors, ...parsed.warnings]) {
    errorsByLine.set(e.line, [...(errorsByLine.get(e.line) ?? []), e.message]);
  }
  const errorLines = new Set(parsed.errors.map((e) => e.line));

  // 從矩陣修改：以目前解析結果為準重寫文字（衝突的這一對改用新設定）
  const setGrant = (pair: PairKey, grant: Grant) => {
    const m: HandicapMatrix = { ...parsed.matrix, [pair]: grant };
    onTextChange(formatMatrix(m, seats));
  };

  const loadPreset = (id: string) => {
    const p = presets.find((x) => String(x.id) === id);
    if (!p) return;
    if (text.trim() && !confirm(`以「${p.name}」取代目前的讓桿規則？`)) return;
    onTextChange(p.text);
    setPresetName(p.name);
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
      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <label className="font-bold">讓桿規則</label>
          {presets.length > 0 && (
            <select className="rounded-lg border border-gray-300 px-2 py-1 text-sm" value="" onChange={(e) => loadPreset(e.target.value)}>
              <option value="">帶入預設組合…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <textarea
          className="field min-h-32 font-mono"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={'每行一條，例如：\nAB平打\nAB讓C前3後3\nAB讓D18\nC讓D5'}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <details className="mt-2 text-sm text-gray-500">
          <summary>語法說明</summary>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>AB平打：A、B 不讓桿</li>
            <li>AB讓D18：A、B 各讓 D 全場 18 桿</li>
            <li>A讓CD5：A 各讓 C、D 5 桿</li>
            <li>A讓B前2後4：前九 2 桿、後九 4 桿（可只寫一半，如 A讓B前3）</li>
            <li>沒寫到的配對以平打計算</li>
          </ul>
        </details>

        {errorsByLine.size > 0 && (
          <ol className="mt-3 space-y-1 text-sm">
            {lines.map((l, i) => {
              const msgs = errorsByLine.get(i + 1);
              if (!msgs) return null;
              const isErr = errorLines.has(i + 1);
              return (
                <li key={i} className={`rounded-lg px-2 py-1 ${isErr ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  <span className="font-mono">
                    第 {i + 1} 行「{l.trim()}」
                  </span>
                  ：{[...new Set(msgs)].join('；')}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="card">
        <div className="mb-2 font-bold">讓桿矩陣</div>
        <p className="mb-2 text-xs text-gray-500">格子 = 該列球員讓該欄球員幾桿（前/後九寫成 3/3）。點格子可直接修改。</p>
        <table className="w-full table-fixed text-center text-sm">
          <thead>
            <tr>
              <th className="w-16" />
              {seats.map((s) => (
                <th key={s} className="truncate py-1 font-semibold">
                  {s}
                  <div className="truncate text-xs font-normal text-gray-500">{names[s]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {seats.map((row) => (
              <tr key={row}>
                <th className="truncate py-1 text-left font-semibold">
                  {row} <span className="text-xs font-normal text-gray-500">{names[row]}</span>
                </th>
                {seats.map((col) => {
                  if (row === col) return <td key={col} className="bg-gray-100" />;
                  const pair = pairKey(row, col);
                  const conflicted = parsed.conflicted.includes(pair);
                  const unspecified = parsed.unspecified.includes(pair);
                  const c = cellText(parsed.matrix[pair], row, col);
                  const tone = conflicted
                    ? 'bg-red-100 text-red-700 font-bold'
                    : unspecified
                      ? 'bg-amber-50 text-amber-600'
                      : c.tone === 'give'
                        ? 'bg-brand-50 text-brand-700 font-bold'
                        : c.tone === 'get'
                          ? 'text-gray-400'
                          : 'text-gray-600';
                  return (
                    <td key={col} className="p-0.5">
                      <button
                        type="button"
                        className={`h-11 w-full rounded-lg ring-1 ring-gray-200 ${tone} ${editing === pair ? 'ring-2 ring-brand-500' : ''}`}
                        onClick={() => setEditing(editing === pair ? null : pair)}
                      >
                        {conflicted ? '衝突' : unspecified ? '平?' : c.text}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {editing && (
          <PairEditor
            key={editing}
            pair={editing}
            names={names}
            grant={parsed.matrix[editing]}
            disabled={parsed.errors.some((e) => e.pair !== editing)}
            onSave={(g) => {
              setGrant(editing, g);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}

        {parsed.unspecified.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            ⚠️ 以下配對未設定，將以<b>平打</b>計算：
            {parsed.unspecified.map((p) => `${names[p[0] as Seat]}–${names[p[1] as Seat]}`).join('、')}
          </p>
        )}

        {parsed.ok && (
          <ul className="mt-3 space-y-0.5 text-sm text-gray-600">
            {allPairs(seats).map((p) => (
              <li key={p}>・{describeGrant(p, parsed.matrix[p], names)}</li>
            ))}
          </ul>
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
                <button type="button" className="px-1 text-gray-400" onClick={() => remove(p)} aria-label={`刪除 ${p.name}`}>
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

/** 整數檢查：回傳數字或錯誤訊息 */
function intOrError(v: string): number | string {
  if (v.trim() === '') return 0;
  if (/[.．]/.test(v)) return '讓桿數只接受整數';
  if (!/^\d+$/.test(v.trim())) return '請輸入數字';
  return Number(v);
}

function PairEditor({
  pair,
  names,
  grant,
  disabled,
  onSave,
  onCancel,
}: {
  pair: PairKey;
  names: Record<Seat, string>;
  grant: Grant | undefined;
  disabled: boolean;
  onSave: (g: Grant) => void;
  onCancel: () => void;
}) {
  const [x, y] = [pair[0] as Seat, pair[1] as Seat];
  const [dir, setDir] = useState<'even' | 'xy' | 'yx'>(!grant || grant.kind === 'even' ? 'even' : grant.giver === x ? 'xy' : 'yx');
  const [mode, setMode] = useState<'full' | 'split'>(grant?.kind === 'split' ? 'split' : 'full');
  const [n, setN] = useState(grant?.kind === 'full' ? String(grant.n) : '');
  const [front, setFront] = useState(grant?.kind === 'split' ? String(grant.front) : '');
  const [back, setBack] = useState(grant?.kind === 'split' ? String(grant.back) : '');

  const vals = mode === 'full' ? [intOrError(n)] : [intOrError(front), intOrError(back)];
  const err = dir !== 'even' ? vals.find((v) => typeof v === 'string') : undefined;

  const build = (): Grant => {
    if (dir === 'even') return { kind: 'even' };
    const [giver, receiver] = dir === 'xy' ? [x, y] : [y, x];
    if (mode === 'full') return { kind: 'full', giver, receiver, n: vals[0] as number };
    return { kind: 'split', giver, receiver, front: vals[0] as number, back: vals[1] as number };
  };

  const Opt = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-2 py-2 text-sm ring-1 ${active ? 'bg-brand-600 font-semibold text-white ring-brand-600' : 'ring-gray-300'}`}
    >
      {children}
    </button>
  );

  return (
    <div className="mt-3 rounded-xl bg-gray-50 p-3">
      <div className="mb-2 text-sm font-semibold">
        {names[x]}（{x}）與 {names[y]}（{y}）
      </div>
      <div className="mb-2 flex gap-2">
        <Opt active={dir === 'even'} onClick={() => setDir('even')}>
          平打
        </Opt>
        <Opt active={dir === 'xy'} onClick={() => setDir('xy')}>
          {x} 讓 {y}
        </Opt>
        <Opt active={dir === 'yx'} onClick={() => setDir('yx')}>
          {y} 讓 {x}
        </Opt>
      </div>
      {dir !== 'even' && (
        <>
          <div className="mb-2 flex gap-2">
            <Opt active={mode === 'full'} onClick={() => setMode('full')}>
              全場
            </Opt>
            <Opt active={mode === 'split'} onClick={() => setMode('split')}>
              前後九分開
            </Opt>
          </div>
          {mode === 'full' ? (
            <label className="flex items-center gap-2 text-sm">
              全場讓
              <input className="field w-20 text-center" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} />桿
            </label>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              前九
              <input className="field w-16 text-center" inputMode="numeric" value={front} onChange={(e) => setFront(e.target.value)} />
              後九
              <input className="field w-16 text-center" inputMode="numeric" value={back} onChange={(e) => setBack(e.target.value)} />桿
            </div>
          )}
        </>
      )}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {disabled && <p className="mt-2 text-sm text-red-600">請先修正上方紅色的錯誤，再從矩陣修改。</p>}
      {grant === undefined && !disabled && <p className="mt-2 text-xs text-gray-500">套用後，讓桿文字會依矩陣重新整理。</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={!!err || disabled}
          onClick={() => onSave(build())}
        >
          套用
        </button>
      </div>
    </div>
  );
}
