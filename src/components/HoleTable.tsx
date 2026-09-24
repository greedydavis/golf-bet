// 球場 Par / 差點洞序 編輯表：前九、後九左右並排

import { validateCourse } from '@/engine/course';

export type Holes = (number | null)[];

export function toNum(v: string): number | null {
  const n = parseInt(v.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function courseProblems(pars: Holes, hcp: Holes) {
  const dupHcp = new Set(hcp.filter((h, i) => h !== null && hcp.indexOf(h) !== i));
  return {
    badPar: (i: number) => pars[i] === null || pars[i]! < 3 || pars[i]! > 6,
    badHcp: (i: number) => hcp[i] === null || hcp[i]! < 1 || hcp[i]! > 18 || dupHcp.has(hcp[i]!),
    errors: validateCourse(pars, hcp),
  };
}

export function HoleTable({
  pars,
  hcpIndex,
  onChange,
}: {
  pars: Holes;
  hcpIndex: Holes;
  onChange: (pars: Holes, hcpIndex: Holes) => void;
}) {
  const p = courseProblems(pars, hcpIndex);
  const set = (kind: 'par' | 'hcp', i: number, v: string) => {
    const nextPars = [...pars];
    const nextHcp = [...hcpIndex];
    (kind === 'par' ? nextPars : nextHcp)[i] = toNum(v);
    onChange(nextPars, nextHcp);
  };
  const sum = (from: number) => pars.slice(from, from + 9).reduce<number>((s, x) => s + (x ?? 0), 0);

  const half = (from: number) => (
    <table className="w-full text-center text-sm">
      <thead>
        <tr className="text-xs text-gray-500">
          <th className="py-1">洞</th>
          <th>Par</th>
          <th>差點</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 9 }, (_, k) => from + k).map((i) => (
          <tr key={i}>
            <td className="py-0.5 font-semibold text-gray-500">{i + 1}</td>
            <td className="px-0.5">
              <input
                inputMode="numeric"
                className={`h-10 w-full rounded-lg border text-center ${p.badPar(i) ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                value={pars[i] ?? ''}
                onChange={(e) => set('par', i, e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </td>
            <td className="px-0.5">
              <input
                inputMode="numeric"
                className={`h-10 w-full rounded-lg border text-center ${p.badHcp(i) ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                value={hcpIndex[i] ?? ''}
                onChange={(e) => set('hcp', i, e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </td>
          </tr>
        ))}
        <tr className="text-xs font-semibold text-gray-500">
          <td className="pt-1">計</td>
          <td className="pt-1">{sum(from)}</td>
          <td />
        </tr>
      </tbody>
    </table>
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {half(0)}
        {half(9)}
      </div>
      {p.errors.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-sm text-red-600">
          {p.errors.slice(0, 4).map((e) => (
            <li key={e}>{e}</li>
          ))}
          {p.errors.length > 4 && <li>…等 {p.errors.length} 項</li>}
        </ul>
      )}
    </div>
  );
}
