import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useApi, useAuth, useMe } from '@/app/auth';
import { ErrorBox, Loading, PageTitle, Section } from '@/components/ui';
import { ROLE_LABEL, type Role } from '@/data/types';

export function MorePage() {
  const me = useMe();
  const { backend } = useAuth();
  return (
    <div>
      <PageTitle>更多</PageTitle>
      <Section>
        <ul className="divide-y divide-gray-100">
          <li>
            <Link to="/courses" className="flex min-h-12 items-center justify-between py-2">
              🏌️ 球場資料 <span className="text-gray-400">›</span>
            </Link>
          </li>
          {me.role === 'owner' && (
            <li>
              <Link to="/members" className="flex min-h-12 items-center justify-between py-2">
                🔑 帳號與權限 <span className="text-gray-400">›</span>
              </Link>
            </li>
          )}
        </ul>
      </Section>
      <Section title="目前登入">
        <p>
          {me.display_name}
          <span className="ml-2 text-sm text-gray-500">
            {me.email}・{ROLE_LABEL[me.role]}
          </span>
        </p>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={() => backend?.signOut()}>
          登出
        </button>
        {backend?.mode === 'demo' && (
          <button
            type="button"
            className="btn-danger mt-2 w-full"
            onClick={() => confirm('清除示範資料並重新建立？') && backend.resetDemo?.()}
          >
            重設示範資料
          </button>
        )}
      </Section>
    </div>
  );
}

export function MembersPage() {
  const api = useApi();
  const me = useMe();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['members'], queryFn: api.listMembers });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api.setMemberRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });

  return (
    <div>
      <PageTitle back="/more">帳號與權限</PageTitle>
      <p className="mb-3 text-sm text-gray-500">
        請球友自己到網站註冊，註冊後會顯示在這裡，改成「球友」就能使用。「管理者」可以管理帳號。
      </p>
      {members.isLoading && <Loading />}
      {members.error && <ErrorBox error={members.error} />}
      {setRole.error && <ErrorBox error={setRole.error} />}
      <ul className="space-y-2">
        {members.data?.map((m) => (
          <li key={m.id} className="card flex items-center gap-3">
            <div className="flex-1">
              <div className="font-semibold">{m.display_name}</div>
              <div className="text-xs text-gray-500">{m.email}</div>
            </div>
            {m.id === me.id ? (
              <span className="text-sm text-gray-500">{ROLE_LABEL[m.role]}（自己）</span>
            ) : (
              <select
                className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
                value={m.role}
                disabled={setRole.isPending}
                onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as Role })}
              >
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
