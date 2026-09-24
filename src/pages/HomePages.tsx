import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useApi } from '@/app/auth';
import { RoundList } from '@/components/RoundList';
import { Empty, ErrorBox, Loading, PageTitle } from '@/components/ui';

export function HomePage() {
  const api = useApi();
  const pending = useQuery({ queryKey: ['rounds', 'draft'], queryFn: () => api.listRounds({ status: 'draft' }) });
  const recent = useQuery({ queryKey: ['rounds', 'recent'], queryFn: () => api.listRounds({ status: 'settled', limit: 5 }) });

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">⛳ 賭球結算</h1>
      <Link to="/rounds/new" className="btn-primary mb-6 w-full py-4 text-lg">
        ＋ 開新球局
      </Link>

      {pending.data && pending.data.length > 0 && (
        <>
          <h2 className="mb-2 font-bold text-gray-600">進行中</h2>
          <div className="mb-6">
            <RoundList rounds={pending.data} />
          </div>
        </>
      )}

      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold text-gray-600">最近結算</h2>
        <Link to="/history" className="text-sm text-brand-700">
          全部 ›
        </Link>
      </div>
      {(pending.isLoading || recent.isLoading) && <Loading />}
      {(pending.error || recent.error) && <ErrorBox error={pending.error ?? recent.error} />}
      {recent.data && (recent.data.length ? <RoundList rounds={recent.data} /> : <Empty>還沒有結算紀錄</Empty>)}
    </div>
  );
}

export function HistoryPage() {
  const api = useApi();
  const rounds = useQuery({ queryKey: ['rounds', 'all'], queryFn: () => api.listRounds() });
  return (
    <div>
      <PageTitle>歷史紀錄</PageTitle>
      {rounds.isLoading && <Loading />}
      {rounds.error && <ErrorBox error={rounds.error} />}
      {rounds.data && (rounds.data.length ? <RoundList rounds={rounds.data} /> : <Empty>還沒有球局</Empty>)}
    </div>
  );
}
