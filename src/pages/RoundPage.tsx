import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApi, useBackend } from '@/app/auth';
import { settleDetail } from '@/data/api';
import { ErrorBox, fmtDate, fmtNum, Loading, PageTitle, Section, Signed } from '@/components/ui';
import { APP_CONFIG, STROKE_MODE_LABEL, TIE_RULE_LABEL } from '@/engine/config';
import { describeGrant } from '@/engine/handicap/parser';
import { buildLineSummary } from '@/engine/summary';
import type { MatchDetail } from '@/engine/games/matchPlay';
import type { StrokeDetail } from '@/engine/games/strokePlay';
import type { PairSettlement } from '@/engine/settle';
import { SEGMENT_LABEL, type Seat, type Segment } from '@/engine/types';
import { CopyButton, DeleteRoundButton } from './ResultActions';

export function RoundPage() {
  const id = Number(useParams().id);
  const api = useApi();
  const query = useQuery({ queryKey: ['round', id], queryFn: () => api.getRound(id) });

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorBox error={query.error ?? '找不到球局'} />;
  const round = query.data;
  const names = Object.fromEntries(round.players.map((p) => [p.seat, p.name])) as Record<Seat, string>;
  const seats = round.players.map((p) => p.seat);
  const res = settleDetail(round);
  const cur = APP_CONFIG.currency;
  const name = (s: Seat) => names[s];

  const header = (
    <>
      <PageTitle back="/history">{round.courseName}</PageTitle>
      <div className="-mt-3 mb-4 flex items-center justify-between text-sm">
        <span className="text-gray-500">{fmtDate(round.date)}</span>
        <span className="flex gap-3">
          <Link to={`/rounds/${round.id}/scores`} className="text-brand-700">
            修改成績
          </Link>
          <Link to={`/rounds/${round.id}/edit`} className="text-brand-700">
            修改設定
          </Link>
        </span>
      </div>
    </>
  );

  if (!res.ok) {
    return (
      <div>
        {header}
        <Section title="尚無法結算">
          <ul className="list-inside list-disc text-sm text-red-600">
            {res.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <Link to={`/rounds/${round.id}/scores`} className="btn-primary mt-4 w-full">
            去輸入成績
          </Link>
        </Section>
      </div>
    );
  }

  const s = res.settlement;
  const ranking = [...seats].sort((a, b) => s.points[b] - s.points[a]);
  const summary = buildLineSummary({ date: fmtDate(round.date), courseName: round.courseName, names: names }, s);
  const { match, stroke } = round.bet.games;

  return (
    <div>
      {header}

      <Section title="輸贏">
        <ul className="divide-y divide-gray-100">
          {ranking.map((seat) => (
            <li key={seat} className="flex items-center justify-between py-2.5">
              <span className="text-lg font-semibold">
                <span className="mr-2 text-sm text-brand-700">{seat}</span>
                {name(seat)}
              </span>
              <span className="text-right">
                <Signed value={s.money[seat]} suffix={` ${cur}`} className="block text-xl font-bold" />
                <Signed value={s.points[seat]} suffix=" 點" className="text-xs" />
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-right text-xs text-gray-400">
          每點 {fmtNum(s.pointValue)} {cur}・合計 {fmtNum(Object.values(s.points).reduce((a, b) => a + b, 0))} ✓
        </p>
      </Section>

      <Section title="付款建議">
        {s.payments.length === 0 ? (
          <p className="text-gray-500">打平，不需付款 🎉</p>
        ) : (
          <ul className="space-y-2">
            {s.payments.map((p, i) => (
              <li key={i} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-3">
                <span className="font-semibold">
                  {name(p.from)} <span className="text-gray-400">→</span> {name(p.to)}
                </span>
                <span className="text-lg font-bold tabular-nums">
                  {fmtNum(p.amount)} {cur}
                </span>
              </li>
            ))}
          </ul>
        )}
        <CopyButton text={summary} />
      </Section>

      <Section title="對戰明細">
        <p className="mb-3 text-xs text-gray-500">
          {match.enabled && `比洞：每洞 ${fmtNum(match.options.pointsPerHole)} 點，${TIE_RULE_LABEL[match.options.tie]}。`}
          {stroke.enabled && `總桿：${STROKE_MODE_LABEL[stroke.options.mode]}。`}
        </p>
        <div className="space-y-3">
          {s.pairs.map((p) => (
            <PairCard key={p.pair} p={p} names={names} pars={round.course!.pars} />
          ))}
        </div>
      </Section>

      {round.scorecardImage && <ScorecardPhoto path={round.scorecardImage} />}

      <details className="card mb-4">
        <summary className="font-bold">LINE 文字預覽</summary>
        <pre className="mt-3 text-sm whitespace-pre-wrap">{summary}</pre>
      </details>

      <DeleteRoundButton id={round.id} />
    </div>
  );
}

function PairCard({ p, names, pars }: { p: PairSettlement; names: Record<Seat, string>; pars: number[] }) {
  const matchGame = p.games.find((g) => g.gameId === 'match');
  const strokeGame = p.games.find((g) => g.gameId === 'stroke');
  const md = matchGame?.detail as MatchDetail | undefined;
  const sd = strokeGame?.detail as StrokeDetail | undefined;

  return (
    <div className="rounded-xl ring-1 ring-gray-200">
      <div className="flex items-center justify-between px-3 pt-3">
        <span className="font-bold">
          {names[p.a]} <span className="text-gray-400">vs</span> {names[p.b]}
        </span>
        <Signed value={p.points} suffix=" 點" className="font-bold" />
      </div>
      <div className="px-3 text-xs text-gray-500">{describeGrant(p.pair, p.grant, names)}</div>

      <div className="space-y-1 px-3 py-2 text-sm">
        {matchGame && md && (
          <div>
            <div className="flex justify-between">
              <span>
                比洞（{md.holesWon[0]} 勝 {md.holesWon[1]} 敗）
              </span>
              <Signed value={matchGame.points} />
            </div>
            <div className="text-xs text-gray-500">
              前九 <Signed value={md.subtotal.front} />・後九 <Signed value={md.subtotal.back} />
              {md.voidedStake > 0 && `・最後 ${md.voidedStake} 洞平手累積作廢`}
            </div>
          </div>
        )}
        {strokeGame &&
          sd?.segments
            .filter((seg) => !seg.skipped)
            .map((seg) => (
              <div key={seg.segment} className="flex justify-between">
                <span>
                  總桿・{SEGMENT_LABEL[seg.segment as Segment]}
                  <span className="ml-1 text-xs text-gray-500">
                    淨 {seg.net[0]} : {seg.net[1]}
                    {(seg.deduct[0] || seg.deduct[1]) > 0 && `（讓 ${seg.deduct[0] || seg.deduct[1]}）`}
                  </span>
                </span>
                <Signed value={seg.points} />
              </div>
            ))}
        {sd?.segments.some((seg) => seg.skipped) && (
          <div className="text-xs text-gray-400">前九 / 後九總桿注不適用（全場讓桿只比 18 洞總桿）</div>
        )}
      </div>

      {md && (
        <details className="border-t border-gray-100">
          <summary className="px-3 py-2 text-sm text-brand-700">逐洞明細</summary>
          <table className="w-full text-center text-sm tabular-nums">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1">洞</th>
                <th>Par</th>
                <th>{names[p.a]}</th>
                <th>{names[p.b]}</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {md.holes.map((h) => (
                <tr key={h.hole} className={`${h.hole === 10 ? 'border-t-2 border-gray-200' : ''} ${h.winner ? '' : 'text-gray-500'}`}>
                  <td className="py-1 text-gray-500">{h.hole}</td>
                  <td className="text-gray-400">{pars[h.hole - 1]}</td>
                  <NetCell gross={h.gross[0]} received={h.received[0]} win={h.winner === 'a'} />
                  <NetCell gross={h.gross[1]} received={h.received[1]} win={h.winner === 'b'} />
                  <td>{h.winner ? <Signed value={h.points} /> : h.stake > 1 ? `平（累積 ${h.stake}）` : '平'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 pb-2 text-xs text-gray-400">● = 該洞被讓桿數，括號內為淨桿；點數以 {names[p.a]} 的角度表示</p>
        </details>
      )}
    </div>
  );
}

function NetCell({ gross, received, win }: { gross: number; received: number; win: boolean }) {
  return (
    <td className={win ? 'font-bold text-brand-700' : ''}>
      {gross}
      {received > 0 && (
        <span className="text-xs text-amber-600">
          {'●'.repeat(received)}({gross - received})
        </span>
      )}
    </td>
  );
}

function ScorecardPhoto({ path }: { path: string }) {
  const backend = useBackend();
  const [open, setOpen] = useState(false);
  const url = useQuery({ queryKey: ['image', path], queryFn: () => backend.imageUrl(path), enabled: open, staleTime: 30 * 60_000 });
  return (
    <details className="card mb-4" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="font-bold">成績卡照片</summary>
      {url.isLoading && <Loading />}
      {url.error && <ErrorBox error={url.error} />}
      {url.data && <img src={url.data} alt="成績卡照片" className="mt-3 w-full rounded-xl" />}
    </details>
  );
}
