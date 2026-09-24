import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = join(import.meta.dirname, '..');

export function readSql(relative: string): string {
  return readFileSync(join(root, relative), 'utf8');
}

export function migrationFiles(): string[] {
  const dir = join(root, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join('supabase', 'migrations', f));
}

export interface TestDb {
  db: PGlite;
  users: { owner: string; member: string; pending: string };
  /** 以指定使用者身分呼叫 RPC（和 Supabase 一樣：authenticated 角色 + JWT sub） */
  rpc<T = unknown>(userId: string | null, fn: string, args?: Record<string, unknown>): Promise<T>;
  /** 以超級使用者執行（測試準備用） */
  sql<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(readSql('supabase/local/auth_shim.sql'));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readSql(file));
    } catch (error) {
      throw new Error(`執行 ${file} 失敗：${(error as Error).message}`);
    }
  }

  // 第一個帳號自動成為 owner，之後的是 pending
  const users = {} as TestDb['users'];
  for (const key of ['owner', 'member', 'pending'] as const) {
    const res = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [`${key}@example.test`, JSON.stringify({ display_name: key })],
    );
    users[key] = res.rows[0].id;
  }
  await db.query(`update app.profiles set role = 'member' where id = $1`, [users.member]);

  const rpc: TestDb['rpc'] = async (userId, fn, args = {}) => {
    const names = Object.keys(args);
    const placeholders = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
    const values = names.map((n) => {
      const v = args[n];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    return db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        userId ? JSON.stringify({ sub: userId, role: 'authenticated' }) : '',
      ]);
      await tx.query(userId ? 'set local role authenticated' : 'set local role anon');
      const res = await tx.query<{ result: unknown }>(`select public.${fn}(${placeholders}) as result`, values);
      return res.rows[0]?.result as never;
    });
  };

  const sql: TestDb['sql'] = async (query, params) => {
    const res = await db.query(query, params);
    return res.rows as never;
  };

  return { db, users, rpc, sql };
}
