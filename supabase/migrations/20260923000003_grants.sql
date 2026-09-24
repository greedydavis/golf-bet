-- 高爾夫賭球結算：權限
-- 前端（anon、authenticated）只能執行 public schema 的 RPC；app schema 完全不可見。
-- ★ 之後新增或修改 RPC 的 migration，結尾一定要重跑這一段：Supabase 預設會把新函式開放給 anon。

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
