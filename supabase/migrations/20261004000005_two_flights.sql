-- 分組抓球：一場球局最多 2 組、8 人；可指定誰跟誰抓（讓桿矩陣 kind = 'none' 代表不抓）
-- 座位：第 1 組固定 A~D、第 2 組固定 E~H（組別可由座位推得，不另存欄位）
-- 成績卡照片：每組各一張

alter table app.round_players drop constraint round_players_seat_check;
alter table app.round_players add constraint round_players_seat_check
  check (seat in ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'));

alter table app.rounds add column scorecard_image_2 text;

-- ---------- 球員與座位 ----------

drop function if exists app.player_ids(jsonb);
drop function if exists app.check_setup(jsonb, int);

-- p_data.playerIds：球員 id（依成績卡順序）；p_data.flights：對應的組別（1 或 2），省略時全部是第 1 組
create or replace function app.setup_players(p_data jsonb) returns table (seat text, player_id bigint)
language plpgsql stable set search_path = '' as $$
declare v_ids bigint[]; v_flights int[]; n int; f int; cnt int[] := array[0, 0];
begin
  if jsonb_typeof(p_data -> 'playerIds') is distinct from 'array' then raise exception '請選擇球員'; end if;
  v_ids := array(select (x #>> '{}')::bigint from jsonb_array_elements(p_data -> 'playerIds') with ordinality e(x, i) order by i);
  n := coalesce(array_length(v_ids, 1), 0);
  if n < 2 or n > 8 then raise exception '球員人數需為 2~8 人'; end if;
  if (select count(distinct x) from unnest(v_ids) x) <> n then raise exception '球員重複'; end if;
  if (select count(*) from app.players where id = any (v_ids)) <> n then raise exception '找不到球員'; end if;

  if jsonb_typeof(p_data -> 'flights') = 'array' then
    v_flights := array(select (x #>> '{}')::int from jsonb_array_elements(p_data -> 'flights') with ordinality e(x, i) order by i);
    if coalesce(array_length(v_flights, 1), 0) <> n then raise exception '組別資料與球員人數不符'; end if;
  else
    v_flights := array_fill(1, array[n]);
  end if;

  if not (1 = any (v_flights)) then raise exception '第 1 組至少要有 1 位球員'; end if;
  for i in 1..n loop
    f := v_flights[i];
    if f is null or f not in (1, 2) then raise exception '組別需為第 1 組或第 2 組'; end if;
    cnt[f] := cnt[f] + 1;
    if cnt[f] > 4 then raise exception '每組最多 4 人'; end if;
    seat := chr(64 + (f - 1) * 4 + cnt[f]);
    player_id := v_ids[i];
    return next;
  end loop;
end $$;

-- 檢查球局設定；讓桿矩陣與賭注的細節由前端計分引擎驗證，這裡只擋結構錯誤
create or replace function app.check_setup(p_data jsonb, p_seats text) returns void
language plpgsql stable set search_path = '' as $$
declare k text;
begin
  if coalesce(p_data ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '日期格式錯誤'; end if;
  perform (p_data ->> 'date')::date;
  if coalesce(btrim(p_data ->> 'courseName'), '') = '' then raise exception '請輸入球場名稱'; end if;
  if jsonb_typeof(p_data -> 'bet') is distinct from 'object' then raise exception '賭注設定錯誤'; end if;
  if jsonb_typeof(p_data -> 'matrix') is distinct from 'object' then raise exception '讓桿設定錯誤'; end if;
  for k in select jsonb_object_keys(p_data -> 'matrix') loop
    if k !~ '^[A-H]{2}$' or position(substr(k, 1, 1) in p_seats) = 0 or position(substr(k, 2, 1) in p_seats) = 0
       or substr(k, 1, 1) >= substr(k, 2, 1) then
      raise exception '讓桿設定包含不存在的配對 %', k;
    end if;
    if coalesce(p_data -> 'matrix' -> k ->> 'kind', '') not in ('none', 'even', 'full', 'split') then
      raise exception '配對 % 的讓桿格式錯誤', k;
    end if;
  end loop;
end $$;

create or replace function app.round_players_json(p_round_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'seat', rp.seat, 'flight', case when rp.seat <= 'D' then 1 else 2 end,
      'playerId', rp.player_id, 'name', p.name, 'scores', rp.strokes,
      'netPoints', rp.net_points, 'netMoney', rp.net_money) order by rp.seat), '[]'::jsonb)
  from app.round_players rp join app.players p on p.id = rp.player_id
  where rp.round_id = p_round_id
$$;

-- ---------- 球局 ----------

create or replace function public.get_round(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform app.require_member();
  select jsonb_build_object('id', r.id, 'date', r.play_date, 'courseName', r.course_name, 'courseId', r.course_id,
      'course', r.course_snapshot, 'handicapText', r.handicap_text, 'matrix', r.handicap_matrix, 'bet', r.bet_config,
      'status', r.status, 'scorecardImage', r.scorecard_image,
      'scorecardImages', jsonb_build_array(r.scorecard_image, r.scorecard_image_2),
      'players', app.round_players_json(r.id))
    into v
  from app.rounds r where r.id = p_id;
  if v is null then raise exception '找不到球局'; end if;
  return v;
end $$;

create or replace function public.create_round(p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_course_id bigint; v_seats text;
begin
  perform app.require_member();
  select string_agg(s.seat, '' order by s.seat) into v_seats from app.setup_players(p_data) s;
  perform app.check_setup(p_data, v_seats);
  v_course_id := nullif(p_data ->> 'courseId', '')::bigint;

  insert into app.rounds (play_date, course_name, course_id, course_snapshot, handicap_text, handicap_matrix, bet_config, created_by)
  values ((p_data ->> 'date')::date, btrim(p_data ->> 'courseName'), v_course_id, app.snapshot_of(v_course_id),
    coalesce(p_data ->> 'handicapText', ''), p_data -> 'matrix', p_data -> 'bet', auth.uid())
  returning id into v_id;

  insert into app.round_players (round_id, seat, player_id)
  select v_id, s.seat, s.player_id from app.setup_players(p_data) s;
  return v_id;
end $$;

-- 修改設定：成績依座位保留；球局退回未結算，由前端重新結算後呼叫 set_round_result
create or replace function public.update_round_setup(p_id bigint, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_course_id bigint; old app.rounds; v_snapshot jsonb; kept jsonb; v_seats text;
begin
  perform app.require_member();
  select * into old from app.rounds where id = p_id for update;
  if not found then raise exception '找不到球局'; end if;
  select string_agg(s.seat, '' order by s.seat) into v_seats from app.setup_players(p_data) s;
  perform app.check_setup(p_data, v_seats);
  v_course_id := nullif(p_data ->> 'courseId', '')::bigint;
  -- 球場沒換時保留原快照（可能是輸入成績時補上的）
  v_snapshot := case
    when v_course_id is not null then app.snapshot_of(v_course_id)
    when old.course_id is null then old.course_snapshot
    else null end;

  select jsonb_object_agg(rp.seat, rp.strokes) into kept from app.round_players rp where rp.round_id = p_id;
  delete from app.round_players where round_id = p_id;
  update app.rounds
  set play_date = (p_data ->> 'date')::date, course_name = btrim(p_data ->> 'courseName'), course_id = v_course_id,
      course_snapshot = v_snapshot, handicap_text = coalesce(p_data ->> 'handicapText', ''),
      handicap_matrix = p_data -> 'matrix', bet_config = p_data -> 'bet', updated_at = now()
  where id = p_id;
  insert into app.round_players (round_id, seat, player_id, strokes)
  select p_id, s.seat, s.player_id,
    coalesce(kept -> s.seat, '[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]'::jsonb)
  from app.setup_players(p_data) s;
  perform app.apply_result(p_id, null);
end $$;

-- ---------- 成績卡照片：每組一張 ----------

drop function if exists public.set_round_image(bigint, text);

-- 回傳被取代的舊照片路徑，讓前端刪除檔案
create or replace function public.set_round_image(p_id bigint, p_path text, p_flight int default 1) returns text
language plpgsql security definer set search_path = '' as $$
declare old_path text;
begin
  perform app.require_member();
  if p_flight not in (1, 2) then raise exception '組別需為第 1 組或第 2 組'; end if;
  if p_path is not null and p_path !~ ('^' || p_id || '/[A-Za-z0-9._-]+$') then raise exception '照片路徑不正確'; end if;
  select case when p_flight = 1 then scorecard_image else scorecard_image_2 end into old_path
  from app.rounds where id = p_id for update;
  if not found then raise exception '找不到球局'; end if;
  if p_flight = 1 then
    update app.rounds set scorecard_image = p_path, updated_at = now() where id = p_id;
  else
    update app.rounds set scorecard_image_2 = p_path, updated_at = now() where id = p_id;
  end if;
  return old_path;
end $$;

drop function if exists public.delete_round(bigint);

-- 回傳成績卡照片路徑（陣列），讓前端刪除檔案
create or replace function public.delete_round(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare paths jsonb;
begin
  perform app.require_member();
  delete from app.rounds where id = p_id
  returning to_jsonb(array_remove(array[scorecard_image, scorecard_image_2], null)) into paths;
  return coalesce(paths, '[]'::jsonb);
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

-- 讓 Data API 立刻看到函式簽章的變更
notify pgrst, 'reload schema';
