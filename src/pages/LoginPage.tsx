import { type FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/app/auth';
import type { DemoUser } from '@/data/backend';
import { ROLE_LABEL, type Role } from '@/data/types';

export function LoginPage() {
  const { backend } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);

  useEffect(() => {
    backend?.listDemoUsers?.().then(setDemoUsers).catch(() => setDemoUsers([]));
  }, [backend]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!backend) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await backend.signIn(email, password);
      } else {
        if (!name.trim()) throw new Error('請填寫名字');
        if (password.length < 8) throw new Error('密碼至少 8 個字元');
        await backend.signUp(email, password, name.trim());
        setInfo('註冊完成。第一個註冊的帳號是管理者，之後的帳號需要管理者開通。');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <div className="text-5xl" aria-hidden>
          ⛳
        </div>
        <h1 className="mt-2 text-2xl font-bold text-brand-700">高爾夫賭球結算</h1>
      </div>

      {backend?.mode === 'demo' && demoUsers.length > 0 && (
        <div className="card mb-4 space-y-3">
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <b>示範模式</b>：資料只存在這台裝置的瀏覽器。選一個帳號進入。
          </p>
          {demoUsers.map((u) => (
            <button key={u.id} type="button" className="btn-secondary w-full justify-between" onClick={() => backend.signInAs?.(u.id)}>
              <span>{u.display_name}</span>
              <span className="text-sm font-normal text-gray-500">{ROLE_LABEL[u.role as Role] ?? u.role}</span>
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="card space-y-4">
        <h2 className="text-lg font-semibold">{mode === 'signin' ? '登入' : '註冊新帳號'}</h2>
        {mode === 'signup' && (
          <div>
            <label className="label" htmlFor="name">
              名字
            </label>
            <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">
            密碼{mode === 'signup' && '（至少 8 個字元）'}
          </label>
          <input
            id="password"
            type="password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required={backend?.mode !== 'demo'}
          />
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {info && <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">{info}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? '處理中…' : mode === 'signin' ? '登入' : '註冊'}
        </button>
        <button
          type="button"
          className="min-h-11 w-full text-sm text-brand-700"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setInfo(null);
          }}
        >
          {mode === 'signin' ? '還沒有帳號？註冊' : '已經有帳號？登入'}
        </button>
      </form>
    </div>
  );
}

export function PendingPage() {
  const { me, backend } = useAuth();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 text-center">
      <div className="text-4xl" aria-hidden>
        ⏳
      </div>
      <h1 className="mt-3 text-xl font-bold">等待開通</h1>
      <p className="mt-2 text-gray-500">{me?.display_name}，你的帳號還沒有開通。請聯絡管理者。</p>
      <button type="button" className="btn-secondary mx-auto mt-6" onClick={() => backend?.signOut()}>
        登出
      </button>
    </div>
  );
}
