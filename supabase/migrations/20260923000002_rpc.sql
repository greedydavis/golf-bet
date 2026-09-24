-- 高爾夫賭球結算：RPC
-- 全部為 security definer，進入點先檢查身分；錯誤訊息直接顯示給使用者，一律用繁體中文。

-- ---------- 身分 ----------

create or replace function app.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from app.profiles where id = auth.uid()
$$;

create or replace function app.require_member() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(app.my_role(), '') not in ('owner', 'member') then
    raise exception '沒有權限：請先登入，並由管理者開通帳號' using errcode = '42501';
  end if;
end $$;

create or replace function app.require_owner() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(app.my_role(), '') <> 'owner' then
    raise exception '只有管理者可以執行這個操作' using errcode = '42501';
  end if;
end $$;

-- storage policy 用
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_role() in ('owner', 'member'), false)
$$;

create or replace function public.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'role', p.role, 'email', u.email)
  from app.profiles p join auth.users u on u.id = p.id
  where p.id = auth.uid()
$$;

create or replace function public.list_members() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'email', u.email,
      'role', p.role, 'created_at', p.created_at) order by p.created_at)
    from app.profiles p join auth.users u on u.id = p.id), '[]'::jsonb);
end $$;

create or replace function public.set_member_role(p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_owner();
  if p_role not in ('owner', 'member', 'pending') then raise exception '角色不正確'; end if;
  if p_user_id = auth.uid() then raise exception '不能修改自己的角色'; end if;
  update app.profiles set role = p_role where id = p_user_id;
  if not found then raise exception '找不到這個帳號'; end if;
end $$;

-- ---------- 球友 ----------

create or replace function public.list_players() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_member();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.active desc, x.money desc, x.name)
    from (
      select p.id, p.name, p.active,
        count(r.id) filter (where r.status = 'settled') as rounds,
        count(r.id) filter (where r.status = 'settled' and rp.net_money > 0) as wins,
        coalesce(sum(rp.net_points) filter (where r.status = 'settled'), 0) as points,
        coalesce(sum(rp.net_money) filter (where r.status = 'settled'), 0) as money
      from app.players p
      left join app.round_players rp on rp.player_id = p.id
      left join app.rounds r on r.id = rp.round_id
      group by p.id
    ) x), '[]'::jsonb);
end $$;

create or replace function public.create_player(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v app.players;
begin
  perform app.require_member();
  if coalesce(btrim(p_name), '') = '' then raise exception '請輸入名字'; end if;
  insert into app.players (name) values (btrim(p_name)) returning * into v;
  return jsonb_build_object('id', v.id, 'name', v.name);
exception when unique_violation then
  raise exception '「%」已經在名單中', btrim(p_name);
end $$;

create or replace function public.update_player(p_id bigint, p_name text default null, p_active boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_member();
  if p_name is not null and btrim(p_name) = '' then raise exception '名字不可空白'; end if;
  update app.players set name = coalesce(btrim(p_name), name), active = coalesce(p_active, active) where id = p_id;
  if not found then raise exception '找不到球友'; end if;
exception when unique_violation then
  raise exception '「%」已經在名單中', btrim(p_name);
end $$;

-- ---------- 球場 ----------

create or replace function app.course_json(c app.courses) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'pars', to_jsonb(c.pars), 'hcpIndex', to_jsonb(c.hcp_index),
    'rounds', (select count(*) from app.rounds r where r.course_id = c.id))
$$;

create or replace function public.list_courses() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_member();
  return coalesce((select jsonb_agg(app.course_json(c) order by c.name) from app.courses c), '[]'::jsonb);
end $$;

create or replace function public.get_course(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform app.require_member();
  select app.course_json(c) into v from app.courses c where c.id = p_id;
  if v is null then raise exception '找不到球場'; end if;
  return v;
end $$;

create or replace function app.check_course(p_pars jsonb, p_hcp jsonb) returns void
language plpgsql immutable as $$
begin
  if not app.valid_pars(app.jsonb_int_array(p_pars)) then
    raise exception 'Par 需為 18 洞、每洞 3~6';
  end if;
  if not app.valid_hcp(app.jsonb_int_array(p_hcp)) then
    raise exception '差點洞序需為 18 洞，1~18 各出現一次';
  end if;
end $$;

create or replace function public.save_course(p_id bigint, p_name text, p_pars jsonb, p_hcp_index jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform app.require_member();
  if coalesce(btrim(p_name), '') = '' then raise exception '請輸入球場名稱'; end if;
  perform app.check_course(p_pars, p_hcp_index);
  if p_id is null then
    insert into app.courses (name, pars, hcp_index)
    values (btrim(p_name), app.jsonb_int_array(p_pars), app.jsonb_int_array(p_hcp_index))
    returning id into v_id;
  else
    update app.courses
    set name = btrim(p_name), pars = app.jsonb_int_array(p_pars), hcp_index = app.jsonb_int_array(p_hcp_index), updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception '找不到球場'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception '球場「%」已存在', btrim(p_name);
end $$;

create or replace function public.delete_course(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_member();
  -- 過去球局保留自己的球場快照，不受影響
  delete from app.courses where id = p_id;
end $$;

-- ---------- 預設讓桿組合 ----------

create or replace function public.list_presets() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_member();
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'text', body) order by name)
    from app.handicap_presets), '[]'::jsonb);
end $$;

create or replace function public.save_preset(p_name text, p_text text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform app.require_member();
  if coalesce(btrim(p_name), '') = '' then raise exception '請輸入組合名稱'; end if;
  if coalesce(btrim(p_text), '') = '' then raise exception '讓桿規則是空的'; end if;
  update app.handicap_presets set body = p_text where lower(btrim(name)) = lower(btrim(p_name)) returning id into v_id;
  if v_id is null then
    insert into app.handicap_presets (name, body) values (btrim(p_name), p_text) returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.delete_preset(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_member();
  delete from app.handicap_presets where id = p_id;
end $$;

-- ---------- 球局 ----------

create or replace function app.round_players_json(p_round_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'seat', rp.seat, 'playerId', rp.player_id, 'name', p.name, 'scores', rp.strokes,
      'netPoints', rp.net_points, 'netMoney', rp.net_money) order by rp.seat), '[]'::jsonb)
  from app.round_players rp join app.players p on p.id = rp.player_id
  where rp.round_id = p_round_id
$$;

create or replace function public.list_rounds(p_status text default null, p_player_id bigint default null, p_limit int default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_member();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'date', r.play_date, 'courseName', r.course_name, 'status', r.status,
      'players', app.round_players_json(r.id)) order by r.play_date desc, r.id desc)
    from (
      select * from app.rounds r
      where (p_status is null or r.status = p_status)
        and (p_player_id is null or exists (select 1 from app.round_players rp where rp.round_id = r.id and rp.player_id = p_player_id))
      order by r.play_date desc, r.id desc
      limit p_limit
    ) r), '[]'::jsonb);
end $$;

create or replace function public.get_round(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform app.require_member();
  select jsonb_build_object('id', r.id, 'date', r.play_date, 'courseName', r.course_name, 'courseId', r.course_id,
      'course', r.course_snapshot, 'handicapText', r.handicap_text, 'matrix', r.handicap_matrix, 'bet', r.bet_config,
      'status', r.status, 'scorecardImage', r.scorecard_image, 'players', app.round_players_json(r.id))
    into v
  from app.rounds r where r.id = p_id;
  if v is null then raise exception '找不到球局'; end if;
  return v;
end $$;

-- 檢查球局設定；讓桿矩陣與賭注的細節由前端計分引擎驗證，這裡只擋結構錯誤
create or replace function app.check_setup(p_data jsonb, p_count int) returns void
language plpgsql stable set search_path = '' as $$
declare k text; seats text := substr('ABCD', 1, p_count);
begin
  if coalesce(p_data ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '日期格式錯誤'; end if;
  perform (p_data ->> 'date')::date;
  if coalesce(btrim(p_data ->> 'courseName'), '') = '' then raise exception '請輸入球場名稱'; end if;
  if jsonb_typeof(p_data -> 'bet') is distinct from 'object' then raise exception '賭注設定錯誤'; end if;
  if jsonb_typeof(p_data -> 'matrix') is distinct from 'object' then raise exception '讓桿設定錯誤'; end if;
  for k in select jsonb_object_keys(p_data -> 'matrix') loop
    if k !~ '^[A-D]{2}$' or position(substr(k, 1, 1) in seats) = 0 or position(substr(k, 2, 1) in seats) = 0
       or substr(k, 1, 1) >= substr(k, 2, 1) then
      raise exception '讓桿設定包含不存在的配對 %', k;
    end if;
    if coalesce(p_data -> 'matrix' -> k ->> 'kind', '') not in ('even', 'full', 'split') then
      raise exception '配對 % 的讓桿格式錯誤', k;
    end if;
  end loop;
end $$;

create or replace function app.player_ids(p_data jsonb) returns bigint[]
language plpgsql stable set search_path = '' as $$
declare v bigint[]; n int;
begin
  if jsonb_typeof(p_data -> 'playerIds') is distinct from 'array' then raise exception '請選擇球員'; end if;
  v := array(select (x #>> '{}')::bigint from jsonb_array_elements(p_data -> 'playerIds') with ordinality e(x, i) order by i);
  n := coalesce(array_length(v, 1), 0);
  if n < 2 or n > 4 then raise exception '球員人數需為 2~4 人'; end if;
  if (select count(distinct x) from unnest(v) x) <> n then raise exception '球員重複'; end if;
  if (select count(*) from app.players where id = any (v)) <> n then raise exception '找不到球員'; end if;
  return v;
end $$;

create or replace function app.snapshot_of(p_course_id bigint) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v jsonb;
begin
  if p_course_id is null then return null; end if;
  select jsonb_build_object('pars', to_jsonb(pars), 'hcpIndex', to_jsonb(hcp_index)) into v from app.courses where id = p_course_id;
  if v is null then raise exception '找不到球場'; end if;
  return v;
end $$;

-- 結算結果：null → 退回未結算；否則檢查後寫入每人淨點數與金額
create or replace function app.apply_result(p_round_id bigint, p_result jsonb) returns void
language plpgsql set search_path = '' as $$
declare seats text[]; s text; sum_points numeric := 0; sum_money numeric := 0;
begin
  if p_result is null or jsonb_typeof(p_result) = 'null' then
    update app.rounds set status = 'draft', settled_at = null, updated_at = now() where id = p_round_id;
    update app.round_players set net_points = null, net_money = null where round_id = p_round_id;
    return;
  end if;

  if (select course_snapshot is null from app.rounds where id = p_round_id) then
    raise exception '尚未設定球場 Par 與差點洞序，不能結算';
  end if;
  if exists (select 1 from app.round_players rp, jsonb_array_elements(rp.strokes) v
             where rp.round_id = p_round_id and jsonb_typeof(v) = 'null') then
    raise exception '成績尚未填完，不能結算';
  end if;

  select array_agg(seat order by seat) into seats from app.round_players where round_id = p_round_id;
  if jsonb_typeof(p_result -> 'points') is distinct from 'object' or jsonb_typeof(p_result -> 'money') is distinct from 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_result -> 'points') k) is distinct from seats
     or (select array_agg(k order by k) from jsonb_object_keys(p_result -> 'money') k) is distinct from seats then
    raise exception '結算結果與球員不符';
  end if;
  foreach s in array seats loop
    sum_points := sum_points + (p_result -> 'points' ->> s)::numeric;
    sum_money := sum_money + (p_result -> 'money' ->> s)::numeric;
  end loop;
  -- 金額四捨五入到分，容許 2 分誤差
  if abs(sum_points) > 0.005 or abs(sum_money) > 0.02 then
    raise exception '結算結果加總不為 0（點數 %、金額 %）', sum_points, sum_money;
  end if;

  update app.round_players
  set net_points = (p_result -> 'points' ->> seat)::numeric, net_money = (p_result -> 'money' ->> seat)::numeric
  where round_id = p_round_id;
  update app.rounds set status = 'settled', settled_at = now(), updated_at = now() where id = p_round_id;
end $$;

create or replace function public.create_round(p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_ids bigint[]; v_id bigint; v_course_id bigint;
begin
  perform app.require_member();
  v_ids := app.player_ids(p_data);
  perform app.check_setup(p_data, array_length(v_ids, 1));
  v_course_id := nullif(p_data ->> 'courseId', '')::bigint;

  insert into app.rounds (play_date, course_name, course_id, course_snapshot, handicap_text, handicap_matrix, bet_config, created_by)
  values ((p_data ->> 'date')::date, btrim(p_data ->> 'courseName'), v_course_id, app.snapshot_of(v_course_id),
    coalesce(p_data ->> 'handicapText', ''), p_data -> 'matrix', p_data -> 'bet', auth.uid())
  returning id into v_id;

  insert into app.round_players (round_id, seat, player_id)
  select v_id, substr('ABCD', i, 1), v_ids[i] from generate_subscripts(v_ids, 1) i;
  return v_id;
end $$;

-- 修改設定：成績依座位保留；球局退回未結算，由前端重新結算後呼叫 set_round_result
create or replace function public.update_round_setup(p_id bigint, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ids bigint[]; v_course_id bigint; old app.rounds; v_snapshot jsonb; kept jsonb;
begin
  perform app.require_member();
  select * into old from app.rounds where id = p_id for update;
  if not found then raise exception '找不到球局'; end if;
  v_ids := app.player_ids(p_data);
  perform app.check_setup(p_data, array_length(v_ids, 1));
  v_course_id := nullif(p_data ->> 'courseId', '')::bigint;
  -- 球場沒換時保留原快照（可能是輸入成績時補上的）
  v_snapshot := case
    when v_course_id is not null then app.snapshot_of(v_course_id)
    when old.course_id is null then old.course_snapshot
    else null end;

  select jsonb_object_agg(seat, strokes) into kept from app.round_players where round_id = p_id;
  delete from app.round_players where round_id = p_id;
  update app.rounds
  set play_date = (p_data ->> 'date')::date, course_name = btrim(p_data ->> 'courseName'), course_id = v_course_id,
      course_snapshot = v_snapshot, handicap_text = coalesce(p_data ->> 'handicapText', ''),
      handicap_matrix = p_data -> 'matrix', bet_config = p_data -> 'bet', updated_at = now()
  where id = p_id;
  insert into app.round_players (round_id, seat, player_id, strokes)
  select p_id, substr('ABCD', i, 1), v_ids[i],
    coalesce(kept -> substr('ABCD', i, 1), '[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]'::jsonb)
  from generate_subscripts(v_ids, 1) i;
  perform app.apply_result(p_id, null);
end $$;

-- 儲存成績；球場尚未建檔時可一併寫入 Par 與差點洞序（p_course = {pars, hcpIndex, saveAsCourse}）
create or replace function public.save_scores(p_id bigint, p_scores jsonb, p_course jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r app.rounds; k text; v_course_id bigint;
begin
  perform app.require_member();
  select * into r from app.rounds where id = p_id for update;
  if not found then raise exception '找不到球局'; end if;
  if jsonb_typeof(p_scores) is distinct from 'object' then raise exception '成績格式錯誤'; end if;

  for k in select jsonb_object_keys(p_scores) loop
    if not exists (select 1 from app.round_players where round_id = p_id and seat = k) then
      raise exception '座位 % 不在這場球局', k;
    end if;
    if not app.valid_strokes(p_scores -> k) then
      raise exception '% 的桿數格式錯誤（每洞需為 1~20 的整數）', k;
    end if;
    update app.round_players set strokes = p_scores -> k where round_id = p_id and seat = k;
  end loop;

  if p_course is not null and jsonb_typeof(p_course) = 'object' then
    perform app.check_course(p_course -> 'pars', p_course -> 'hcpIndex');
    v_course_id := r.course_id;
    if coalesce((p_course ->> 'saveAsCourse')::boolean, false) then
      insert into app.courses (name, pars, hcp_index)
      values (r.course_name, app.jsonb_int_array(p_course -> 'pars'), app.jsonb_int_array(p_course -> 'hcpIndex'))
      on conflict ((lower(btrim(name)))) do update set pars = excluded.pars, hcp_index = excluded.hcp_index, updated_at = now()
      returning id into v_course_id;
    end if;
    update app.rounds
    set course_id = v_course_id,
        course_snapshot = jsonb_build_object('pars', p_course -> 'pars', 'hcpIndex', p_course -> 'hcpIndex'),
        updated_at = now()
    where id = p_id;
  end if;

  perform app.apply_result(p_id, null);
end $$;

create or replace function public.set_round_result(p_id bigint, p_result jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_member();
  perform 1 from app.rounds where id = p_id for update;
  if not found then raise exception '找不到球局'; end if;
  perform app.apply_result(p_id, p_result);
end $$;

-- 回傳被取代的舊照片路徑，讓前端刪除檔案
create or replace function public.set_round_image(p_id bigint, p_path text) returns text
language plpgsql security definer set search_path = '' as $$
declare old_path text;
begin
  perform app.require_member();
  if p_path is not null and p_path !~ ('^' || p_id || '/[A-Za-z0-9._-]+$') then raise exception '照片路徑不正確'; end if;
  select scorecard_image into old_path from app.rounds where id = p_id for update;
  if not found then raise exception '找不到球局'; end if;
  update app.rounds set scorecard_image = p_path, updated_at = now() where id = p_id;
  return old_path;
end $$;

-- 回傳成績卡照片路徑，讓前端刪除檔案
create or replace function public.delete_round(p_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare old_path text;
begin
  perform app.require_member();
  delete from app.rounds where id = p_id returning scorecard_image into old_path;
  return old_path;
end $$;
