import { Link } from 'react-router';
import type { RoundListItem } from '@/data/types';
import { fmtDate, Signed } from './ui';

export function RoundList({ rounds }: { rounds: RoundListItem[] }) {
  return (
    <ul className="space-y-3">
      {rounds.map((r) => (
        <li key={r.id}>
          <Link to={r.status === 'settled' ? `/rounds/${r.id}` : `/rounds/${r.id}/scores`} className="card block active:bg-gray-50">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold">{r.courseName}</div>
                <div className="text-sm text-gray-500">{fmtDate(r.date)}</div>
              </div>
              {r.status !== 'settled' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">待輸入成績</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {r.players.map((p) => (
                <span key={p.seat}>
                  {p.name} {p.netMoney !== null && <Signed value={p.netMoney} />}
                </span>
              ))}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
