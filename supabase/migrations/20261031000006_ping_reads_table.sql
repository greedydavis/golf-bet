-- 保活加強：ping() 實際讀一次資料表，讓每次呼叫都是真正的資料庫查詢。
-- 只回傳資料庫目前時間，不回傳任何資料內容，所以仍然可以開放給未登入（anon）呼叫。

create or replace function public.ping() returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
begin
  perform count(*) from app.rounds;
  return now();
end $$;

-- ---------- 重跑權限區塊（新增 / 修改 RPC 後必做，見 20260923000003_grants.sql） ----------

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

-- 唯一開放給未登入的函式（保活排程用）
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.ping() to anon';
  end if;
end $$;
