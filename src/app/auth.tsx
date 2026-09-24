import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type Api } from '@/data/api';
import { type Backend, type SessionUser, getBackend } from '@/data/backend';
import type { Me } from '@/data/types';

interface AuthState {
  backend: Backend | null;
  api: Api | null;
  session: SessionUser | null;
  me: Me | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [backend, setBackend] = useState<Backend | null>(null);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (b: Backend) => {
    const s = await b.getSession();
    setSession(s);
    setMe(s ? await b.rpc<Me | null>('me') : null);
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    getBackend()
      .then(async (b) => {
        if (cancelled) return;
        setBackend(b);
        await load(b);
        unsubscribe = b.onAuthChange(() => {
          client.clear();
          load(b).catch((e: Error) => setError(e.message));
        });
      })
      .catch((e: Error) => setError(`無法連線資料庫：${e.message}`))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, load]);

  const refresh = useCallback(async () => {
    if (backend) await load(backend);
  }, [backend, load]);

  const apiInstance = useMemo(() => (backend ? api(backend) : null), [backend]);

  return (
    <AuthContext.Provider value={{ backend, api: apiInstance, session, me, loading, error, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必須在 AuthProvider 內使用');
  return ctx;
}

/** 登入後的頁面使用：取得型別化的 API */
export function useApi(): Api {
  const { api } = useAuth();
  if (!api) throw new Error('資料庫尚未連線');
  return api;
}

export function useBackend(): Backend {
  const { backend } = useAuth();
  if (!backend) throw new Error('資料庫尚未連線');
  return backend;
}

export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('尚未登入');
  return me;
}
