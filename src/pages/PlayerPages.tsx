import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApi } from '@/app/auth';
import { RoundList } from '@/components/RoundList';
import { Empty, ErrorBox, Loading, PageTitle, Section, Signed } from '@/components/ui';
import { APP_CONFIG } from '@/engine/config';

export function PlayersPage() {
  const api = useApi();
  const qc = useQueryClient();
  const players = useQuery({ queryKey: ['players'], queryFn: api.listPlayers });
  const [name, setName] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['players'] });

  const create = useMutation({
    mutationFn: () => api.createPlayer(name),
    onSuccess: () => {
      setName('');
      invalidate();
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: number; name?: string; active?: boolean }) => api.updatePlayer(v.id, v),
    onSuccess: invalidate,
    onError: (e) => alert((e as Error).message),
  });

  return (
    <div>
      <PageTitle>球友</PageTitle>
      <Section title="新增球友">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <div className="flex gap-2">
            <input className="field" placeholder="名字或綽號" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-primary shrink-0" disabled={create.isPending || !name.trim()}>
              新增
            </button>
          </div>
          {create.error && <p className="mt-2 text-sm text-red-600">{create.error.message}</p>}
        </form>
      </Section>

      <Section title="累計輸贏">
        {players.isLoading && <Loading />}
        {players.error && <ErrorBox error={players.error} />}
        {players.data?.length === 0 && <Empty>還沒有球友</Empty>}
        <ul className="divide-y divide-gray-100">
          {players.data?.map((p) => (
            <li key={p.id} className={`flex items-center gap-3 py-3 ${p.active ? '' : 'opacity-50'}`}>
              <Link to={`/players/${p.id}`} className="flex-1">
                <div className="font-semibold">
                  {p.name}
                  {!p.active && <span className="ml-2 text-xs text-gray-400">（已停用）</span>}
                </div>
                <div className="text-xs text-gray-500">
                  {p.rounds} 場・贏 {p.wins} 場・
                  <Signed value={p.points} suffix=" 點" />
                </div>
              </Link>
              <Signed value={p.money} suffix={` ${APP_CONFIG.currency}`} className="font-bold" />
              <details className="relative">
                <summary className="cursor-pointer list-none px-2 text-xl text-gray-400">⋯</summary>
                <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-xl bg-white text-sm shadow-lg ring-1 ring-black/10">
                  <button
                    type="button"
                    className="block w-full px-3 py-2.5 text-left active:bg-gray-100"
                    onClick={() => {
                      const n = prompt('修改名字', p.name);
                      if (n && n !== p.name) update.mutate({ id: p.id, name: n });
                    }}
                  >
                    改名
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2.5 text-left active:bg-gray-100"
                    onClick={() => update.mutate({ id: p.id, active: !p.active })}
                  >
                    {p.active ? '停用' : '啟用'}
                  </button>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export function PlayerPage() {
  const id = Number(useParams().id);
  const api = useApi();
  const players = useQuery({ queryKey: ['players'], queryFn: api.listPlayers });
  const rounds = useQuery({ queryKey: ['rounds', 'player', id], queryFn: () => api.listRounds({ playerId: id }) });
  const p = players.data?.find((x) => x.id === id);

  if (players.isLoading) return <Loading />;
  if (!p) return <ErrorBox error="找不到球友" />;

  return (
    <div>
      <PageTitle back="/players">{p.name}</PageTitle>
      <Section>
        <div className="grid grid-cols-3 text-center">
          <div>
            <div className="text-xs text-gray-500">場數</div>
            <div className="text-xl font-bold">{p.rounds}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">贏的場數</div>
            <div className="text-xl font-bold">{p.wins}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">累計（{APP_CONFIG.currency}）</div>
            <Signed value={p.money} className="text-xl font-bold" />
            <div className="text-xs">
              <Signed value={p.points} suffix=" 點" />
            </div>
          </div>
        </div>
      </Section>
      {rounds.isLoading && <Loading />}
      {rounds.data && (rounds.data.length ? <RoundList rounds={rounds.data} /> : <Empty>還沒有球局</Empty>)}
    </div>
  );
}
