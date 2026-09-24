-- 只在 Supabase 執行（PGlite 沒有 storage schema）：成績卡照片 bucket 與存取規則
-- 在所有 migrations 之後執行一次。路徑格式：{球局 id}/{時間戳}.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scorecards', 'scorecards', false, 5242880, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "scorecards_select" on storage.objects;
drop policy if exists "scorecards_insert" on storage.objects;
drop policy if exists "scorecards_delete" on storage.objects;

-- 已開通的帳號（管理者、球友）才能讀取、上傳、刪除
create policy "scorecards_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'scorecards' and public.is_member());

create policy "scorecards_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'scorecards' and public.is_member());

create policy "scorecards_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'scorecards' and public.is_member());
