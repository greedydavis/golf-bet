import { APP_CONFIG, STROKE_MODE_LABEL, TIE_RULE_LABEL, type StrokeMode, type TieRule } from '@/engine/config';
import type { BetConfig } from '@/engine/games/registry';
import { SEGMENT_LABEL, type Segment } from '@/engine/types';

function NumberInput({ value, onChange, className = '' }: { value: number; onChange: (v: number) => void; className?: string }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      className={`field w-24 text-center ${className}`}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      onFocus={(e) => e.target.select()}
    />
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between">
      <span className="text-lg font-bold">{label}</span>
      <input type="checkbox" className="h-6 w-6 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Radio<T extends string>({ value, options, onChange }: { value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-2">
      {(Object.keys(options) as T[]).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`flex-1 rounded-lg px-2 py-2 text-sm ring-1 ${value === k ? 'bg-brand-600 font-semibold text-white ring-brand-600' : 'ring-gray-300'}`}
        >
          {options[k]}
        </button>
      ))}
    </div>
  );
}

export function betProblems(bet: BetConfig): string[] {
  const errs: string[] = [];
  if (!Number.isFinite(bet.pointValue) || bet.pointValue < 0) errs.push('每點金額不正確');
  const { match, stroke } = bet.games;
  if (!match.enabled && !stroke.enabled) errs.push('至少要選一種賽制');
  if (match.enabled && !(match.options.pointsPerHole >= 0)) errs.push('比洞每洞點數不正確');
  if (stroke.enabled) {
    const segs = Object.values(stroke.options.segments);
    if (!segs.some((s) => s.enabled)) errs.push('總桿至少要選一注（前九 / 後九 / 全場）');
    if (segs.some((s) => s.enabled && !(s.points >= 0))) errs.push('總桿點數不正確');
  }
  return errs;
}

export function BetEditor({ bet, onChange }: { bet: BetConfig; onChange: (b: BetConfig) => void }) {
  const update = (fn: (draft: BetConfig) => void) => {
    const next = structuredClone(bet);
    fn(next);
    onChange(next);
  };
  const { match, stroke } = bet.games;
  const problems = betProblems(bet);

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <span className="text-lg font-bold">每點金額</span>
        <span className="flex items-center gap-2">
          <NumberInput value={bet.pointValue} onChange={(v) => update((d) => void (d.pointValue = v))} />
          {APP_CONFIG.currency}
        </span>
      </div>

      <div className="card space-y-3">
        <Toggle label="比洞賽" checked={match.enabled} onChange={(v) => update((d) => void (d.games.match.enabled = v))} />
        {match.enabled && (
          <>
            <label className="flex items-center justify-between">
              每洞贏
              <span className="flex items-center gap-2">
                <NumberInput
                  value={match.options.pointsPerHole}
                  onChange={(v) => update((d) => void (d.games.match.options.pointsPerHole = v))}
                />
                點
              </span>
            </label>
            <Radio<TieRule>
              value={match.options.tie}
              options={TIE_RULE_LABEL}
              onChange={(v) => update((d) => void (d.games.match.options.tie = v))}
            />
            {match.options.tie === 'carry' && (
              <p className="text-xs text-gray-500">累積會跨前後九一路帶下去；第 18 洞仍平手則作廢。</p>
            )}
          </>
        )}
      </div>

      <div className="card space-y-3">
        <Toggle label="總桿賽" checked={stroke.enabled} onChange={(v) => update((d) => void (d.games.stroke.enabled = v))} />
        {stroke.enabled && (
          <>
            <Radio<StrokeMode>
              value={stroke.options.mode}
              options={STROKE_MODE_LABEL}
              onChange={(v) => update((d) => void (d.games.stroke.options.mode = v))}
            />
            {(['front', 'back', 'total'] as Segment[]).map((seg) => {
              const s = stroke.options.segments[seg];
              return (
                <div key={seg} className="flex items-center justify-between">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-brand-600"
                      checked={s.enabled}
                      onChange={(e) => update((d) => void (d.games.stroke.options.segments[seg].enabled = e.target.checked))}
                    />
                    {SEGMENT_LABEL[seg]}
                  </label>
                  {s.enabled && (
                    <span className="flex items-center gap-2 text-sm">
                      {stroke.options.mode === 'fixed' ? '贏方得' : '每桿'}
                      <NumberInput
                        value={s.points}
                        onChange={(v) => update((d) => void (d.games.stroke.options.segments[seg].points = v))}
                      />
                      點
                    </span>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-gray-500">
              讓桿為「全場 N 桿」的配對只比 18 洞總桿（扣 N）；「前 X 後 Y」的配對前九扣 X、後九扣 Y、全場扣 X+Y。
            </p>
          </>
        )}
      </div>

      {problems.length > 0 && <p className="text-sm text-red-600">{problems.join('、')}</p>}
    </div>
  );
}
