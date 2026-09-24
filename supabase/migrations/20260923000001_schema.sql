-- 高爾夫賭球結算：資料表
-- 所有業務資料表放在 app schema、啟用 RLS 且不開任何 policy；前端只能透過 public schema 的 RPC 存取。

create schema if not exists app;

-- ---------- 驗證函式（供 check constraint 使用） ----------

create or replace function app.valid_pars(a int[]) returns boolean
language sql immutable as $$
  select coalesce(array_length(a, 1) = 18 and array_position(a, null) is null
    and (select bool_and(x between 3 and 6) from unnest(a) x), false)
$$;

create or replace function app.valid_hcp(a int[]) returns boolean
language sql immutable as $$
  select coalesce(array_length(a, 1) = 18 and array_position(a, null) is null
    and (select count(distinct x) = 18 and bool_and(x between 1 and 18) from unnest(a) x), false)
$$;

-- 18 洞桿數：每格為 null（未填）或 1~20 的整數
create or replace function app.valid_strokes(s jsonb) returns boolean
language sql immutable as $$
  select coalesce(jsonb_typeof(s) = 'array' and jsonb_array_length(s) = 18
    and (select bool_and(
          jsonb_typeof(v) = 'null'
          or (jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
              and (v #>> '{}')::numeric between 1 and 20))
        from jsonb_array_elements(s) v), false)
$$;

-- jsonb 整數陣列 → int[]；格式不對回傳 null
create or replace function app.jsonb_int_array(j jsonb) returns int[]
language plpgsql immutable as $$
begin
  if j is null or jsonb_typeof(j) <> 'array' then return null; end if;
  return array(select (v #>> '{}')::int from jsonb_array_elements(j) with ordinality e(v, i) order by i);
exception when others then
  return null;
end $$;

create or replace function app.valid_snapshot(s jsonb) returns boolean
language sql immutable as $$
  select coalesce(jsonb_typeof(s) = 'object'
    and app.valid_pars(app.jsonb_int_array(s -> 'pars'))
    and app.valid_hcp(app.jsonb_int_array(s -> 'hcpIndex')), false)
$$;

-- ---------- 帳號 ----------

create table app.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  -- owner：管理者（第一個註冊的帳號）；member：球友，可使用全部功能；pending：待開通
  role text not null default 'pending' check (role in ('owner', 'member', 'pending')),
  created_at timestamptz not null default now()
);

-- ---------- 球友、球場、預設讓桿 ----------

create table app.players (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> '' and char_length(name) <= 30),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index players_name_key on app.players (lower(btrim(name)));

create table app.courses (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> '' and char_length(name) <= 60),
  pars int[] not null check (app.valid_pars(pars)),
  hcp_index int[] not null check (app.valid_hcp(hcp_index)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index courses_name_key on app.courses (lower(btrim(name)));

create table app.handicap_presets (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> '' and char_length(name) <= 30),
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now()
);
create unique index handicap_presets_name_key on app.handicap_presets (lower(btrim(name)));

-- ---------- 球局 ----------

create table app.rounds (
  id bigint generated always as identity primary key,
  play_date date not null,
  course_name text not null check (btrim(course_name) <> ''),
  course_id bigint references app.courses (id) on delete set null,
  -- 球場 Par 與差點洞序的快照 {pars, hcpIndex}；尚未建檔時為 null，等輸入成績時補上
  course_snapshot jsonb,
  handicap_text text not null default '',
  -- 確認後的讓桿矩陣（以它為準）
  handicap_matrix jsonb not null default '{}'::jsonb check (jsonb_typeof(handicap_matrix) = 'object'),
  bet_config jsonb not null check (jsonb_typeof(bet_config) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'settled')),
  scorecard_image text,
  settled_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (course_snapshot is null or app.valid_snapshot(course_snapshot))
);
create index rounds_date_idx on app.rounds (play_date desc, id desc);

create table app.round_players (
  round_id bigint not null references app.rounds (id) on delete cascade,
  seat text not null check (seat in ('A', 'B', 'C', 'D')),
  player_id bigint not null references app.players (id) on delete restrict,
  strokes jsonb not null default '[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]'::jsonb
    check (app.valid_strokes(strokes)),
  -- 結算後寫入（點數 / 金額），累計統計用；尚未結算為 null
  net_points numeric(12, 2),
  net_money numeric(14, 2),
  primary key (round_id, seat),
  unique (round_id, player_id)
);
create index round_players_player_idx on app.round_players (player_id);

alter table app.profiles enable row level security;
alter table app.players enable row level security;
alter table app.courses enable row level security;
alter table app.handicap_presets enable row level security;
alter table app.rounds enable row level security;
alter table app.round_players enable row level security;

-- ---------- 新帳號自動建立 profile：第一個帳號成為 owner ----------

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- 避免兩個帳號同時註冊時都成為 owner
  lock table app.profiles in exclusive mode;
  insert into app.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    case when exists (select 1 from app.profiles where role = 'owner') then 'pending' else 'owner' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();
