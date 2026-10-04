-- 保活用：GitHub Actions 每 3 天呼叫一次，避免免費專案因為 7 天沒有使用而被暫停。
-- 只回傳資料庫目前時間，不讀寫任何資料，所以開放給未登入（anon）呼叫。

create or replace function public.ping() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select now()
$$;

-- ---------- 重跑權限區塊（新增 RPC 後必做，見 20260923000003_grants.sql） ----------

revoke all on schema app from public;
revoke all on all tables in schema app from public;
revoke all on all sequences in schema app from public;
revoke execute on all functions in schema app from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema app from anon';
    execute 'revoke all on all tables in schema app from anon';
    execute 'revoke execute on all functions in schema app from anon';
    execute 'revoke execute on all functions in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema app from authenticated';
    execute 'revoke all on all tables in schema app from authenticated';
    execute 'revoke execute on all functions in schema app from authenticated';
  end if;
end $$;

revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to authenticated;

-- 唯一開放給未登入的函式
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.ping() to anon';
  end if;
end $$;
