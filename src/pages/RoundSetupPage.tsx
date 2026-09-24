import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useApi } from '@/app/auth';
import { ErrorBox, Loading, PageTitle, today } from '@/components/ui';
import { defaultBetConfig } from '@/engine/games/registry';
import { RoundSetupForm } from './RoundSetupForm';

/** 開新球局（/rounds/new）與修改設定（/rounds/:id/edit）共用 */
export function RoundSetupPage() {
  const params = useParams();
  const roundId = params.id ? Number(params.id) : undefined;
  const api = useApi();

  const players = useQuery({ queryKey: ['players'], queryFn: api.listPlayers });
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.listCourses });
  const presets = useQuery({ queryKey: ['presets'], queryFn: api.listPresets });
  const round = useQuery({ queryKey: ['round', roundId], queryFn: () => api.getRound(roundId!), enabled: roundId !== undefined });
  // 開新局時沿用上一場的賭注設定
  const last = useQuery({
    queryKey: ['rounds', 'last'],
    queryFn: async () => {
      const [r] = await api.listRounds({ limit: 1 });
      return r ? api.getRound(r.id) : null;
    },
    enabled: roundId === undefined,
  });

  const queries = [players, courses, presets, roundId ? round : last];
  const error = queries.find((q) => q.error)?.error;
  if (error) return <ErrorBox error={error} />;
  if (queries.some((q) => q.isLoading)) return <Loading />;

  const r = round.data;
  const initial = r
    ? {
        date: r.date,
        playerIds: r.players.map((p) => p.playerId),
        courseId: r.courseId,
        courseName: r.courseName,
        handicapText: r.handicapText,
        bet: r.bet,
        courseSnapshot: r.course,
      }
    : {
        date: today(),
        playerIds: [],
        courseId: null,
        courseName: '',
        handicapText: '',
        bet: last.data?.bet ?? defaultBetConfig(),
      };

  return (
    <div>
      <PageTitle back={roundId ? `/rounds/${roundId}` : '/'}>{roundId ? '修改球局設定' : '開新球局'}</PageTitle>
      <RoundSetupForm
        key={roundId ?? 'new'}
        roundId={roundId}
        initial={initial}
        players={players.data!}
        courses={courses.data!}
        presets={presets.data!}
      />
    </div>
  );
}
