-- =====================================================================
--  سياسة التخزين السحابي والصلاحيات — كاتدرائية رئيس الملائكة الجليل ميخائيل - طنطا
--  شغّل هذا الملف في Supabase → SQL Editor (مرة واحدة، وهو قابل لإعادة التشغيل).
--
--  ⚠️ مهم قبل التشغيل:
--  1) هذا الملف كُتب استنتاجًا من كود الصفحات فقط؛ لم أرَ قاعدة بياناتكم الفعلية.
--     شغّل أولًا استعلامات الفحص (القسم 0) وقارن النتائج بالافتراضات الموضحة تحتها.
--  2) ارفع ملفات HTML الجديدة (library.html / admin.html / sw.js) قبل تشغيل القسم 3،
--     لأن القسم 3 يمنع الوصول المباشر القديم لجداول المكتبة.
--  3) القسم 6 (التشديد) شغّله منفصلًا بعد التأكد أن التطبيق يعمل.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) استعلامات فحص (للقراءة فقط — شغّلها أولًا وراجع الناتج)
-- ---------------------------------------------------------------------
-- أعمدة جدول الفصول (المتوقع: chapter_id, chapter_name, password_hash, icon …)
--   select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='chapters' order by ordinal_position;
-- هل دوال التطبيق الحالية security definer؟ (prosecdef يجب أن تكون true قبل القسم 6)
--   select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and proname in
--   ('get_class_record','upsert_class_record','verify_chapter_password','create_chapter','update_chapter','delete_chapter');
-- هل يكشف chapters_public هاش كلمة السر؟ (يجب ألا يظهر عمود password*)
--   select column_name from information_schema.columns where table_schema='public' and table_name='chapters_public';
-- السياسات القديمة الواسعة التي قد تُبطل الحماية (احذف أي سياسة "allow all" يدويًا)
--   select schemaname, tablename, policyname, roles, cmd, qual from pg_policies
--   where (schemaname='public' and tablename in ('class_records','chapters','library_stages','library_passwords','library_files'))
--      or (schemaname='storage' and tablename='objects');


-- ---------------------------------------------------------------------
-- 1) أساسيات
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

-- قائمة المشرفين المسموح لهم (حسابات Supabase Auth). لا يقرأها أحد من المتصفح.
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- أضف المشرفين هنا (غيّر البريد ثم شغّل السطر):
--   insert into public.admin_users (user_id, email)
--   select id, email from auth.users where email = 'admin@example.com'
--   on conflict do nothing;
-- وفي Supabase → Authentication → Providers → Email: عطّل "Allow new users to sign up".


-- ---------------------------------------------------------------------
-- 2) سجلات الفصول: قراءة/حذف للمشرفين المسجّلين فقط (لوحة المشرفين)
--    ملاحظة: التطبيق الرئيسي يتعامل مع السجلات عبر دوال get/upsert_class_record فقط.
-- ---------------------------------------------------------------------
create table if not exists public.class_records (
  class_id   text primary key,
  class_name text,
  data       jsonb,
  updated_at timestamptz not null default now()
);

drop policy if exists "admins read class_records"   on public.class_records;
drop policy if exists "admins delete class_records" on public.class_records;
create policy "admins read class_records"   on public.class_records for select to authenticated using (public.is_admin());
create policy "admins delete class_records" on public.class_records for delete to authenticated using (public.is_admin());
grant select, delete on public.class_records to authenticated;

-- أعمدة إضافية يحتاجها تعديل الفصول من لوحة المشرفين (إضافة فقط، لا تغيّر الموجود)
alter table public.chapters add column if not exists icon       text;
alter table public.chapters add column if not exists updated_at timestamptz not null default now();

-- دوال إدارة الفصول للمشرفين (تتحقق من الجلسة داخل القاعدة وليس في المتصفح)
create or replace function public.admin_list_chapters()
returns table (chapter_id text, chapter_name text, icon text, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select c.chapter_id::text, c.chapter_name::text, c.icon::text, r.updated_at
    from public.chapters c
    left join public.class_records r on r.class_id = c.chapter_id::text
    order by c.chapter_name;
end;
$$;

-- يفترض أن عمود هاش كلمة سر الفصل اسمه password_hash ومُجزّأ بـ bcrypt (crypt/gen_salt)
-- كما تفعل create_chapter الحالية. إن كان الاسم أو الأسلوب مختلفًا فعدّل السطر المشار إليه.
create or replace function public.admin_update_chapter(
  p_chapter_id text, p_new_name text, p_icon text, p_new_password text default null)
returns boolean
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if coalesce(btrim(p_new_name), '') = '' then return false; end if;
  update public.chapters
     set chapter_name = btrim(p_new_name),
         icon         = coalesce(nullif(btrim(p_icon), ''), icon),
         updated_at   = now()
   where chapter_id::text = p_chapter_id;
  if not found then return false; end if;
  if p_new_password is not null and length(p_new_password) >= 4 then
    update public.chapters
       set password_hash = crypt(p_new_password, gen_salt('bf'))   -- ← عدّل اسم العمود/الأسلوب إن اختلف
     where chapter_id::text = p_chapter_id;
  end if;
  return true;
end;
$$;

create or replace function public.admin_delete_chapter(p_chapter_id text)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  delete from public.class_records where class_id = p_chapter_id;
  delete from public.chapters      where chapter_id::text = p_chapter_id;
  return found;
end;
$$;

revoke all on function public.admin_list_chapters()                      from public;
revoke all on function public.admin_update_chapter(text,text,text,text)  from public;
revoke all on function public.admin_delete_chapter(text)                 from public;
grant execute on function public.admin_list_chapters()                      to authenticated;
grant execute on function public.admin_update_chapter(text,text,text,text)  to authenticated;
grant execute on function public.admin_delete_chapter(text)                 to authenticated;


-- ---------------------------------------------------------------------
-- 3) المكتبة الروحية: كلمات مرور الأقسام تُتحقق في القاعدة، ولا يقرأ الجداول أحد مباشرة
-- ---------------------------------------------------------------------
create table if not exists public.library_stages (
  id         text primary key,
  name       text not null,
  group_name text,
  icon       text,
  created_at timestamptz not null default now()
);
create table if not exists public.library_passwords (
  stage_id      text primary key,
  password_hash text not null,
  updated_at    timestamptz not null default now()
);
create table if not exists public.library_files (
  id           bigint generated always as identity primary key,
  stage_id     text not null,
  category     text not null check (category in ('pdf','audio','video')),
  name         text not null,
  size         bigint,
  type         text,
  storage_path text not null unique,
  date_added   timestamptz not null default now()
);

alter table public.library_stages    enable row level security;
alter table public.library_passwords enable row level security;
alter table public.library_files     enable row level security;

-- لا وصول مباشر لكلمات المرور ولا لقائمة الملفات (الوصول عبر الدوال أدناه فقط)
revoke all on public.library_passwords from anon, authenticated;
revoke all on public.library_files     from anon, authenticated;

-- الأقسام: أسماؤها عامة. القراءة مسموحة، والإضافة مسموحة للأقسام المخصصة فقط (c_…)، ولا تعديل/حذف
revoke all on public.library_stages from anon, authenticated;
grant select, insert on public.library_stages to anon, authenticated;
drop policy if exists "stages readable"      on public.library_stages;
drop policy if exists "stages custom insert" on public.library_stages;
create policy "stages readable" on public.library_stages for select to anon, authenticated using (true);
create policy "stages custom insert" on public.library_stages for insert to anon, authenticated
  with check (id like 'c\_%' escape '\' and char_length(btrim(name)) between 1 and 80);

-- فحص كلمة المرور (داخلية). تدعم الهاش القديم SHA-256 وتُرقّيه تلقائيًا إلى bcrypt عند أول دخول ناجح
create or replace function public._library_check(p_stage_id text, p_password text)
returns boolean
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_hash text; v_ok boolean := false;
begin
  select password_hash into v_hash from public.library_passwords where stage_id = p_stage_id;
  if v_hash is null or p_password is null then
    perform pg_sleep(0.4); return false;
  end if;
  if v_hash ~ '^[0-9a-f]{64}$' then
    v_ok := (encode(digest('churchLib_' || p_password, 'sha256'), 'hex') = v_hash);
    if v_ok then
      update public.library_passwords
         set password_hash = crypt(p_password, gen_salt('bf')), updated_at = now()
       where stage_id = p_stage_id;
    end if;
  else
    v_ok := (crypt(p_password, v_hash) = v_hash);
  end if;
  if not v_ok then perform pg_sleep(0.4); end if;   -- إبطاء التخمين المتكرر
  return v_ok;
end;
$$;
revoke all on function public._library_check(text,text) from public, anon, authenticated;

create or replace function public.library_unlock_stage(p_stage_id text, p_password text)
returns boolean language sql security definer
set search_path = public, extensions, pg_temp
as $$ select public._library_check(p_stage_id, p_password); $$;

create or replace function public.library_locked_stage_ids()
returns text[] language sql stable security definer
set search_path = public, pg_temp
as $$ select coalesce(array_agg(stage_id), '{}') from public.library_passwords; $$;

create or replace function public.library_stage_counts()
returns table (stage_id text, category text, n bigint)
language sql stable security definer
set search_path = public, pg_temp
as $$ select stage_id, category, count(*) from public.library_files group by stage_id, category; $$;

-- تعيين أول كلمة مرور (بلا كلمة قديمة) أو تغييرها (بعد التحقق من القديمة)
create or replace function public.library_change_password(
  p_stage_id text, p_old_password text, p_new_password text)
returns boolean
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_new_password is null or length(p_new_password) < 4 then return false; end if;
  if not exists (select 1 from public.library_stages where id = p_stage_id)
     and p_stage_id not in ('p1','p2','p3','p4','p5','p6','m1','m2','m3','s1','s2','s3','grad') then
    return false;
  end if;
  if exists (select 1 from public.library_passwords where stage_id = p_stage_id) then
    if not public._library_check(p_stage_id, p_old_password) then return false; end if;
    update public.library_passwords
       set password_hash = crypt(p_new_password, gen_salt('bf')), updated_at = now()
     where stage_id = p_stage_id;
    return true;
  end if;
  insert into public.library_passwords (stage_id, password_hash)
  values (p_stage_id, crypt(p_new_password, gen_salt('bf')))
  on conflict (stage_id) do nothing;
  return found;   -- false لو سبقه جهاز آخر في التعيين
end;
$$;

create or replace function public.library_list_files(p_stage_id text, p_password text)
returns table (id bigint, stage_id text, category text, name text, size bigint,
               type text, storage_path text, date_added timestamptz)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public._library_check(p_stage_id, p_password) then return; end if;
  return query
    select f.id, f.stage_id, f.category, f.name, f.size, f.type, f.storage_path, f.date_added
    from public.library_files f where f.stage_id = p_stage_id order by f.date_added desc;
end;
$$;

-- تسجيل ملف قبل رفعه (سياسة التخزين لا تقبل الرفع إلا لمسار مسجَّل هنا)
create or replace function public.library_add_file(
  p_stage_id text, p_password text, p_category text, p_name text,
  p_size bigint, p_type text, p_storage_path text)
returns bigint
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_id bigint;
begin
  if not public._library_check(p_stage_id, p_password) then
    raise exception 'wrong password' using errcode = '42501';
  end if;
  if p_category not in ('pdf','audio','video') then raise exception 'bad category'; end if;
  if left(p_storage_path, length(p_stage_id || '/' || p_category || '/')) <> (p_stage_id || '/' || p_category || '/')
     or p_storage_path like '%..%' then
    raise exception 'bad path';
  end if;
  insert into public.library_files (stage_id, category, name, size, type, storage_path)
  values (p_stage_id, p_category, left(p_name, 255), p_size, p_type, p_storage_path)
  returning id into v_id;
  return v_id;
end;
$$;

-- حذف سجل الملف (يرجع مساره ليحذف المتصفح الملف نفسه — يسمح بذلك سياسة التخزين لأنه صار غير مسجَّل)
create or replace function public.library_delete_file(p_file_id bigint, p_stage_id text, p_password text)
returns text
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_path text;
begin
  if not public._library_check(p_stage_id, p_password) then
    raise exception 'wrong password' using errcode = '42501';
  end if;
  delete from public.library_files where id = p_file_id and stage_id = p_stage_id
  returning storage_path into v_path;
  return v_path;
end;
$$;

revoke all on function public.library_unlock_stage(text,text)                                   from public;
revoke all on function public.library_locked_stage_ids()                                        from public;
revoke all on function public.library_stage_counts()                                            from public;
revoke all on function public.library_change_password(text,text,text)                           from public;
revoke all on function public.library_list_files(text,text)                                     from public;
revoke all on function public.library_add_file(text,text,text,text,bigint,text,text)            from public;
revoke all on function public.library_delete_file(bigint,text,text)                             from public;
grant execute on function public.library_unlock_stage(text,text)                                to anon, authenticated;
grant execute on function public.library_locked_stage_ids()                                     to anon, authenticated;
grant execute on function public.library_stage_counts()                                         to anon, authenticated;
grant execute on function public.library_change_password(text,text,text)                        to anon, authenticated;
grant execute on function public.library_list_files(text,text)                                  to anon, authenticated;
grant execute on function public.library_add_file(text,text,text,text,bigint,text,text)         to anon, authenticated;
grant execute on function public.library_delete_file(bigint,text,text)                          to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4) سياسة التخزين (Storage) لملفات المكتبة — الحاوية library-files
--    • القراءة برابط مباشر (الحاوية عامة وأسماء الملفات عشوائية) ولا سياسة SELECT فلا يمكن سرد المحتويات
--    • الرفع: فقط لمسار سجّلته library_add_file بعد التحقق من كلمة المرور
--    • الحذف: فقط للملفات غير المسجّلة (أي بعد حذف سجلها بكلمة المرور) — لا يمكن حذف ملف قائم
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library-files', 'library-files', true, 52428800,
        array['application/pdf','audio/*','video/*','application/octet-stream'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.library_path_registered(p_name text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$ select exists (select 1 from public.library_files where storage_path = p_name); $$;
revoke all on function public.library_path_registered(text) from public;
grant execute on function public.library_path_registered(text) to anon, authenticated;

drop policy if exists "library upload registered paths" on storage.objects;
drop policy if exists "library delete orphans"          on storage.objects;
create policy "library upload registered paths" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'library-files' and public.library_path_registered(name));
create policy "library delete orphans" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'library-files' and not public.library_path_registered(name));


-- =====================================================================
-- 6) خطوة التشديد (شغّلها منفصلة بعد التأكد أن الدخول للفصول والمزامنة تعمل)
--    تمنع القراءة المباشرة لجداول الفصول؛ يبقى التعامل عبر الدوال فقط.
--    شرط: أن تكون الدوال الستة في قسم الفحص security definer (prosecdef = true)
--    وأن chapters_public لا يعمل بـ security_invoker. وإلا ستتوقف المزامنة.
-- =====================================================================
--   alter table public.class_records enable row level security;
--   alter table public.chapters      enable row level security;
--   revoke all on public.chapters from anon, authenticated;
--   revoke all on public.class_records from anon;
--   -- (يبقى لـ authenticated صلاحية select/delete على class_records بسياسات المشرفين أعلاه)
