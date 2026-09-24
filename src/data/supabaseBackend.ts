import { createClient, FunctionsHttpError } from '@supabase/supabase-js';
import { type Backend, RpcError } from './backend';

const BUCKET = 'scorecards';

export function createSupabaseBackend(url: string, anonKey: string): Backend {
  const client = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });

  return {
    mode: 'supabase',
    recognitionAvailable: true,

    async getSession() {
      const { data } = await client.auth.getSession();
      const user = data.session?.user;
      return user ? { id: user.id, email: user.email ?? null } : null;
    },

    onAuthChange(callback) {
      const { data } = client.auth.onAuthStateChange(() => callback());
      return () => data.subscription.unsubscribe();
    },

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new RpcError(error.message === 'Invalid login credentials' ? 'Email 或密碼錯誤' : error.message);
    },

    async signUp(email, password, displayName) {
      const { error } = await client.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
      if (error) throw new RpcError(error.message);
    },

    async signOut() {
      await client.auth.signOut();
    },

    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw new RpcError(error.message, error.code);
      return data as T;
    },

    async uploadImage(path, file) {
      const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new RpcError(`照片上傳失敗：${error.message}`);
    },

    async imageUrl(path) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error || !data) throw new RpcError('無法讀取照片');
      return data.signedUrl;
    },

    async removeImage(path) {
      const { error } = await client.storage.from(BUCKET).remove([path]);
      if (error) throw new RpcError(`照片檔案刪除失敗：${error.message}`);
    },

    async recognize(input) {
      const { data, error } = await client.functions.invoke('recognize-scorecard', { body: input });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => null);
          throw new RpcError(body?.error ?? '辨識失敗，請稍後再試或改用手動輸入');
        }
        throw new RpcError('無法連線到辨識服務（Edge Function 可能尚未部署）');
      }
      return data;
    },
  };
}
