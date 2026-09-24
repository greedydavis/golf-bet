import type { RecognizeInput, RecognizeResult } from '../../supabase/functions/recognize-scorecard/core';

export type { RecognizeInput, RecognizeResult };

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface DemoUser {
  id: string;
  display_name: string;
  role: string;
  email: string;
}

/**
 * 前端只透過這個介面存取資料：
 * - supabase：正式環境（Supabase Auth + RPC + Storage + Edge Function）
 * - demo：本機示範／開發（瀏覽器內 PGlite，執行同一套 migrations 與 RPC）
 */
export interface Backend {
  mode: 'supabase' | 'demo';
  getSession(): Promise<SessionUser | null>;
  onAuthChange(callback: () => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signOut(): Promise<void>;
  rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T>;
  uploadImage(path: string, file: Blob): Promise<void>;
  imageUrl(path: string): Promise<string>;
  removeImage(path: string): Promise<void>;
  /** 成績卡辨識是否可用（示範模式只有本機開發伺服器能用） */
  recognitionAvailable: boolean;
  recognize(input: RecognizeInput): Promise<RecognizeResult>;
  /** 示範模式專用 */
  listDemoUsers?(): Promise<DemoUser[]>;
  signInAs?(userId: string): Promise<void>;
  resetDemo?(): Promise<void>;
}

export class RpcError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

let instance: Promise<Backend> | null = null;

export function getBackend(): Promise<Backend> {
  if (!instance) {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    instance =
      url && key
        ? import('./supabaseBackend').then((m) => m.createSupabaseBackend(url, key))
        : import('./demoBackend').then((m) => m.createDemoBackend());
  }
  return instance;
}
