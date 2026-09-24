import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useApi } from '@/app/auth';
import { ErrorBox, fmtDate, Loading, PageTitle } from '@/components/ui';
import { ScoreEditor } from './ScoreEditor';

export function ScoresPage() {
  const id = Number(useParams().id);
  const api = useApi();
  const round = useQuery({ queryKey: ['round', id], queryFn: () => api.getRound(id) });

  if (round.isLoading) return <Loading />;
  if (round.error || !round.data) return <ErrorBox error={round.error ?? '找不到球局'} />;
  const r = round.data;

  return (
    <div>
      <PageTitle
        back={r.status === 'settled' ? `/rounds/${r.id}` : '/'}
        action={
          <Link to={`/rounds/${r.id}/edit`} className="text-sm text-brand-700">
            修改設定
          </Link>
        }
      >
        輸入成績
      </PageTitle>
      <p className="-mt-3 mb-4 text-sm text-gray-500">{fmtDate(r.date)}</p>
      <ScoreEditor
        key={r.id}
        roundId={r.id}
        courseName={r.courseName}
        players={r.players.map((p) => ({ seat: p.seat, name: p.name, scores: p.scores }))}
        course={r.course}
      />
    </div>
  );
}
