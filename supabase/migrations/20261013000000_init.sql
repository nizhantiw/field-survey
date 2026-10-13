-- FieldSurvey schema, row-level security, and sync functions.
-- Apply with the Supabase CLI against a dedicated project. Do not run this
-- against a database that already holds unrelated application data.

create extension if not exists pgcrypto;

create type public.app_role as enum ('owner', 'admin', 'researcher', 'fieldworker', 'viewer');
create type public.ingestion_status as enum ('pending', 'complete');
create type public.review_status as enum ('unreviewed', 'accepted', 'rejected', 'needs_followup');
create type public.attachment_status as enum ('expected', 'uploaded', 'verified');

create function public.role_rank(r public.app_role)
returns integer
language sql
immutable
as $$
  select case r
    when 'owner' then 5
    when 'admin' then 4
    when 'researcher' then 3
    when 'fieldworker' then 2
    when 'viewer' then 1
  end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  description text not null default '',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  draft_schema jsonb not null,
  current_version_id uuid,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  schema jsonb not null,
  published_by uuid not null references public.profiles (id),
  published_at timestamptz not null default now(),
  unique (form_id, version_number)
);

alter table public.forms
  add constraint forms_current_version_fk
  foreign key (current_version_id) references public.form_versions (id)
  deferrable initially deferred;

create table public.submissions (
  id uuid primary key,
  project_id uuid not null references public.projects (id),
  form_id uuid not null references public.forms (id),
  form_version_id uuid not null references public.form_versions (id),
  collector_id uuid not null references public.profiles (id),
  answers jsonb not null,
  location jsonb,
  client_captured_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  payload_hash text not null check (char_length(payload_hash) >= 32),
  ingestion_status public.ingestion_status not null default 'pending',
  review_status public.review_status not null default 'unreviewed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.submission_attachments (
  id uuid primary key,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  project_id uuid not null references public.projects (id),
  question_id text not null,
  storage_path text not null unique,
  content_type text not null,
  byte_size integer not null check (byte_size >= 0),
  checksum text not null,
  status public.attachment_status not null default 'expected',
  created_at timestamptz not null default now()
);

create table public.map_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  version integer not null check (version > 0),
  manifest jsonb not null,
  status text not null default 'ready',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (project_id, name, version)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_org_idx on public.organization_members (organization_id);
create index project_members_user_idx on public.project_members (user_id);
create index projects_org_idx on public.projects (organization_id);
create index forms_project_idx on public.forms (project_id);
create index form_versions_form_idx on public.form_versions (form_id, version_number);
create index submissions_project_idx on public.submissions (project_id, ingestion_status);
create index submissions_collector_idx on public.submissions (collector_id);
create index submission_attachments_submission_idx on public.submission_attachments (submission_id);
create index audit_events_org_idx on public.audit_events (organization_id, created_at);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated before update on public.profiles
for each row execute function public.set_updated_at();
create trigger organizations_updated before update on public.organizations
for each row execute function public.set_updated_at();
create trigger organization_members_updated before update on public.organization_members
for each row execute function public.set_updated_at();
create trigger projects_updated before update on public.projects
for each row execute function public.set_updated_at();
create trigger project_members_updated before update on public.project_members
for each row execute function public.set_updated_at();
create trigger forms_updated before update on public.forms
for each row execute function public.set_updated_at();

create function public.set_form_owner()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger forms_owner before insert on public.forms
for each row execute function public.set_form_owner();
create trigger submissions_updated before update on public.submissions
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, 'member'), '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.current_org_role(p_org_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.organization_members
  where organization_id = p_org_id and user_id = auth.uid();
$$;

create function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_org_id and user_id = auth.uid()
  );
$$;

create function public.current_project_role(p_project_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.project_members
  where project_id = p_project_id and user_id = auth.uid();
$$;

create function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_project_role(p_project_id) is not null;
$$;

create function public.project_role_at_least(p_project_id uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.role_rank(public.current_project_role(p_project_id)) >= public.role_rank(p_role), false);
$$;

create function public.prevent_form_version_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'published form versions are immutable';
end;
$$;

create trigger form_versions_immutable
before update or delete on public.form_versions
for each row execute function public.prevent_form_version_mutation();

create function public.enforce_last_owner()
returns trigger
language plpgsql
as $$
declare
  remaining integer;
begin
  if tg_op = 'DELETE' and old.role = 'owner' then
    select count(*) into remaining from public.organization_members
    where organization_id = old.organization_id and role = 'owner' and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'cannot remove the last owner';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role is distinct from 'owner' then
    select count(*) into remaining from public.organization_members
    where organization_id = old.organization_id and role = 'owner' and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'cannot demote the last owner';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id or new.organization_id is distinct from old.organization_id) then
    raise exception 'membership identity cannot change';
  end if;
  return new;
end;
$$;

create trigger organization_members_last_owner
before update or delete on public.organization_members
for each row execute function public.enforce_last_owner();

create function public.enforce_submission_integrity()
returns trigger
language plpgsql
as $$
declare
  version_project uuid;
  version_form uuid;
begin
  select project_id, form_id into version_project, version_form
  from public.form_versions where id = new.form_version_id;
  if version_project is null or version_project is distinct from new.project_id or version_form is distinct from new.form_id then
    raise exception 'form version does not belong to this project';
  end if;
  return new;
end;
$$;

create trigger submissions_integrity
before insert or update on public.submissions
for each row execute function public.enforce_submission_integrity();

create function public.enforce_submission_update()
returns trigger
language plpgsql
as $$
begin
  if new.answers is distinct from old.answers
     or new.payload_hash is distinct from old.payload_hash
     or new.location is distinct from old.location
     or new.form_version_id is distinct from old.form_version_id
     or new.form_id is distinct from old.form_id
     or new.project_id is distinct from old.project_id
     or new.collector_id is distinct from old.collector_id
     or new.client_captured_at is distinct from old.client_captured_at
     or new.server_received_at is distinct from old.server_received_at
     or new.id is distinct from old.id
  then
    raise exception 'collected answers are immutable';
  end if;
  if new.ingestion_status is distinct from old.ingestion_status
     and coalesce(current_setting('fieldsurvey.allow_ingestion_write', true), '') <> '1' then
    raise exception 'ingestion status is managed by sync';
  end if;
  return new;
end;
$$;

create trigger submissions_collected_immutable
before update on public.submissions
for each row execute function public.enforce_submission_update();

create function public.validate_survey_schema(p_schema jsonb)
returns void
language plpgsql
as $$
declare
  question jsonb;
  choice jsonb;
  condition jsonb;
  qid text;
  qtype text;
  ref text;
  seen jsonb := '{}'::jsonb;
  earlier text[] := '{}';
  choice_ids text[];
  min_num numeric;
  max_num numeric;
begin
  if coalesce(p_schema->>'schemaVersion', '') <> '1' then
    raise exception 'unsupported schema version';
  end if;
  if coalesce(p_schema->>'title', '') = '' then
    raise exception 'title is required';
  end if;
  if jsonb_typeof(p_schema->'questions') is distinct from 'array' then
    raise exception 'questions must be an array';
  end if;
  for question in select value from jsonb_array_elements(p_schema->'questions')
  loop
    qid := question->>'id';
    qtype := question->>'type';
    if coalesce(qid, '') = '' then
      raise exception 'question id required';
    end if;
    if seen ? qid then
      raise exception 'duplicate question id %', qid;
    end if;
    if qtype not in ('text', 'number', 'single_choice', 'multi_choice', 'date', 'boolean', 'gps', 'photo', 'section') then
      raise exception 'unsupported question type %', qtype;
    end if;
    if coalesce(question->>'label', '') = '' then
      raise exception 'question label required';
    end if;
    if qtype = 'section' and coalesce(question->>'required', 'false') = 'true' then
      raise exception 'sections cannot be required';
    end if;
    if qtype in ('single_choice', 'multi_choice') then
      if jsonb_typeof(question->'choices') is distinct from 'array' or jsonb_array_length(question->'choices') < 1 then
        raise exception 'missing choice options';
      end if;
      choice_ids := '{}';
      for choice in select value from jsonb_array_elements(question->'choices')
      loop
        if coalesce(choice->>'id', '') = '' or coalesce(choice->>'label', '') = '' then
          raise exception 'choice id and label are required';
        end if;
        if choice->>'id' = any(choice_ids) then
          raise exception 'duplicate choice id';
        end if;
        choice_ids := choice_ids || (choice->>'id');
      end loop;
    end if;
    if question ? 'validation' then
      if (question->'validation') ? 'minLength' and (question->'validation') ? 'maxLength'
         and (question->'validation'->>'minLength')::int > (question->'validation'->>'maxLength')::int then
        raise exception 'invalid bounds';
      end if;
      if (question->'validation') ? 'min' and (question->'validation') ? 'max' then
        min_num := (question->'validation'->>'min')::numeric;
        max_num := (question->'validation'->>'max')::numeric;
        if min_num > max_num then
          raise exception 'invalid bounds';
        end if;
      end if;
    end if;
    if question ? 'visibility' then
      if coalesce(question->'visibility'->>'match', '') not in ('all', 'any') then
        raise exception 'invalid visibility match';
      end if;
      if jsonb_typeof(question->'visibility'->'conditions') is distinct from 'array'
         or jsonb_array_length(question->'visibility'->'conditions') < 1 then
        raise exception 'visibility conditions required';
      end if;
      for condition in select value from jsonb_array_elements(question->'visibility'->'conditions')
      loop
        ref := condition->>'questionId';
        if ref is null or not (ref = any(earlier)) then
          raise exception 'condition reference is missing or not earlier';
        end if;
        if coalesce(condition->>'operator', '') not in
          ('eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'not_contains', 'is_empty', 'is_not_empty') then
          raise exception 'unsupported condition operator';
        end if;
        if (seen->>ref) = 'section' then
          raise exception 'sections cannot be referenced by conditions';
        end if;
        if condition->>'operator' in ('is_empty', 'is_not_empty') and condition ? 'value' then
          raise exception 'empty checks do not take a comparison value';
        end if;
        if condition->>'operator' not in ('is_empty', 'is_not_empty') and (seen->>ref) in ('photo', 'gps') then
          raise exception 'invalid condition operand';
        end if;
        if condition->>'operator' in ('gt', 'lt', 'gte', 'lte') and (seen->>ref) not in ('number', 'date') then
          raise exception 'invalid condition operand';
        end if;
      end loop;
    end if;
    seen := seen || jsonb_build_object(qid, qtype);
    earlier := earlier || qid;
  end loop;
end;
$$;

create function public.create_organization(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if org_name is null or char_length(btrim(org_name)) = 0 then
    raise exception 'organization name is required';
  end if;
  insert into public.organizations (name, created_by)
  values (btrim(org_name), auth.uid())
  returning id into new_id;
  if coalesce(current_setting('fieldsurvey.fail_membership', true), '') = '1' then
    raise exception 'forced membership failure';
  end if;
  insert into public.organization_members (organization_id, user_id, role)
  values (new_id, auth.uid(), 'owner');
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id)
  values (new_id, auth.uid(), 'organization.create', 'organization', new_id);
  return new_id;
end;
$$;

create function public.test_failing_org_creation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'user id is required';
  end if;
  -- auth.uid() reads the request JWT subject. The service role has no user id,
  -- so the rollback rehearsal impersonates the supplied account for this transaction only.
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('fieldsurvey.fail_membership', '1', true);
  begin
    perform public.create_organization('should-rollback');
    raise exception 'creation should have failed';
  exception
    when others then
      if sqlerrm = 'creation should have failed' then
        raise;
      end if;
  end;
  if exists (select 1 from public.organizations where name = 'should-rollback') then
    raise exception 'orphan organization';
  end if;
  perform set_config('fieldsurvey.fail_membership', '0', true);
end;
$$;

create function public.set_member_role(p_org_id uuid, p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.app_role;
  target public.app_role;
begin
  actor := public.current_org_role(p_org_id);
  if actor is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select role into target from public.organization_members
  where organization_id = p_org_id and user_id = p_user_id;
  if target is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if actor <> 'owner' and (actor <> 'admin' or target = 'owner' or p_role = 'owner') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.organization_members
  set role = p_role
  where organization_id = p_org_id and user_id = p_user_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org_id, auth.uid(), 'member.role', 'organization_member', p_user_id, jsonb_build_object('role', p_role));
end;
$$;

create function public.create_project(p_org_id uuid, p_name text, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.app_role;
  new_id uuid;
  assigned public.app_role;
begin
  actor := public.current_org_role(p_org_id);
  if actor is null or public.role_rank(actor) < public.role_rank('researcher') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'project name is required';
  end if;
  insert into public.projects (organization_id, name, description, created_by)
  values (p_org_id, btrim(p_name), coalesce(p_description, ''), auth.uid())
  returning id into new_id;
  assigned := case when actor = 'researcher' then 'researcher'::public.app_role else 'owner'::public.app_role end;
  insert into public.project_members (project_id, user_id, role)
  values (new_id, auth.uid(), assigned);
  return jsonb_build_object(
    'id', new_id,
    'organization_id', p_org_id,
    'name', btrim(p_name),
    'description', coalesce(p_description, ''),
    'role', assigned
  );
end;
$$;

create function public.publish_form_version(p_form_id uuid, p_schema jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_version integer;
  v_id uuid;
begin
  select project_id into v_project from public.forms where id = p_form_id;
  if v_project is null then
    raise exception 'form not found' using errcode = '42501';
  end if;
  if not public.project_role_at_least(v_project, 'researcher') then
    raise exception 'not allowed to publish' using errcode = '42501';
  end if;
  perform public.validate_survey_schema(p_schema);
  perform pg_advisory_xact_lock(hashtext(p_form_id::text));
  select coalesce(max(version_number), 0) + 1 into v_version
  from public.form_versions where form_id = p_form_id;
  insert into public.form_versions (form_id, project_id, version_number, schema, published_by)
  values (p_form_id, v_project, v_version, p_schema, auth.uid())
  returning id into v_id;
  update public.forms
  set current_version_id = v_id,
      title = coalesce(p_schema->>'title', title),
      draft_schema = p_schema
  where id = p_form_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  select organization_id, auth.uid(), 'form.publish', 'form_version', v_id, jsonb_build_object('version', v_version)
  from public.projects where id = v_project;
  return v_id;
end;
$$;

create function public.create_or_recover_submission(
  p_id uuid,
  p_project_id uuid,
  p_form_version_id uuid,
  p_answers jsonb,
  p_location jsonb,
  p_client_captured_at timestamptz,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.submissions%rowtype;
  version_form uuid;
begin
  if not public.project_role_at_least(p_project_id, 'fieldworker') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select form_id into version_form from public.form_versions
  where id = p_form_version_id and project_id = p_project_id;
  if version_form is null then
    raise exception 'form version does not belong to this project' using errcode = '23514';
  end if;
  select * into existing from public.submissions where id = p_id;
  if found then
    if existing.payload_hash is distinct from p_payload_hash then
      return jsonb_build_object('status', 'conflict', 'ingestion_status', existing.ingestion_status, 'payload_hash', existing.payload_hash);
    end if;
    return jsonb_build_object('status', 'recovered', 'ingestion_status', existing.ingestion_status, 'payload_hash', existing.payload_hash);
  end if;
  insert into public.submissions (
    id, project_id, form_id, form_version_id, collector_id, answers, location,
    client_captured_at, payload_hash, ingestion_status, review_status
  ) values (
    p_id, p_project_id, version_form, p_form_version_id, auth.uid(), p_answers, p_location,
    p_client_captured_at, p_payload_hash, 'pending', 'unreviewed'
  );
  return jsonb_build_object('status', 'created', 'ingestion_status', 'pending', 'payload_hash', p_payload_hash);
end;
$$;

create function public.register_submission_attachments(p_submission_id uuid, p_attachments jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.submissions%rowtype;
  item jsonb;
  existing_checksum text;
begin
  select * into submission from public.submissions where id = p_submission_id;
  if not found or not public.project_role_at_least(submission.project_id, 'fieldworker') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if submission.collector_id is distinct from auth.uid() and not public.project_role_at_least(submission.project_id, 'researcher') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for item in select value from jsonb_array_elements(p_attachments)
  loop
    select checksum into existing_checksum from public.submission_attachments where id = (item->>'id')::uuid;
    if found and existing_checksum is distinct from item->>'checksum' then
      raise exception 'attachment conflict' using errcode = '23505';
    end if;
    insert into public.submission_attachments (
      id, submission_id, project_id, question_id, storage_path, content_type, byte_size, checksum, status
    ) values (
      (item->>'id')::uuid,
      p_submission_id,
      submission.project_id,
      item->>'question_id',
      submission.project_id::text || '/' || p_submission_id::text || '/' || (item->>'id'),
      item->>'content_type',
      (item->>'byte_size')::integer,
      item->>'checksum',
      'expected'
    )
    on conflict (id) do nothing;
  end loop;
end;
$$;

create function public.mark_attachment_uploaded(p_id uuid, p_checksum text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  attachment public.submission_attachments%rowtype;
  object_exists boolean;
begin
  select * into attachment from public.submission_attachments where id = p_id;
  if not found then
    raise exception 'attachment not found' using errcode = '42501';
  end if;
  if not public.project_role_at_least(attachment.project_id, 'fieldworker') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if attachment.checksum is distinct from p_checksum then
    raise exception 'checksum mismatch' using errcode = '23514';
  end if;
  select exists (
    select 1 from storage.objects
    where bucket_id = 'attachments' and name = attachment.storage_path
  ) into object_exists;
  if not object_exists then
    raise exception 'attachment object missing' using errcode = '23514';
  end if;
  update public.submission_attachments set status = 'verified' where id = p_id;
end;
$$;

create function public.verify_submission_attachments(p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.submissions%rowtype;
  missing text[];
begin
  select * into submission from public.submissions where id = p_submission_id;
  if not found or not public.is_project_member(submission.project_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select coalesce(array_agg(id::text), '{}') into missing
  from public.submission_attachments
  where submission_id = p_submission_id and status is distinct from 'verified';
  return jsonb_build_object('ok', coalesce(array_length(missing, 1), 0) = 0, 'missing', to_jsonb(missing));
end;
$$;

create function public.finalize_submission(p_id uuid, p_payload_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.submissions%rowtype;
begin
  select * into submission from public.submissions where id = p_id;
  if not found or not public.project_role_at_least(submission.project_id, 'fieldworker') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if submission.payload_hash is distinct from p_payload_hash then
    return jsonb_build_object('status', 'conflict', 'ingestion_status', submission.ingestion_status, 'payload_hash', submission.payload_hash);
  end if;
  if submission.ingestion_status = 'complete' then
    return jsonb_build_object('status', 'complete', 'ingestion_status', 'complete', 'payload_hash', submission.payload_hash);
  end if;
  if exists (
    select 1 from public.submission_attachments
    where submission_id = p_id and status is distinct from 'verified'
  ) then
    raise exception 'expected attachment is absent' using errcode = '23514';
  end if;
  perform set_config('fieldsurvey.allow_ingestion_write', '1', true);
  update public.submissions set ingestion_status = 'complete' where id = p_id;
  return jsonb_build_object('status', 'complete', 'ingestion_status', 'complete', 'payload_hash', submission.payload_hash);
end;
$$;

create function public.set_review_status(p_id uuid, p_status public.review_status)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.submissions%rowtype;
begin
  select * into submission from public.submissions where id = p_id;
  if not found or not public.project_role_at_least(submission.project_id, 'researcher') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.submissions set review_status = p_status where id = p_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  select p.organization_id, auth.uid(), 'submission.review', 'submission', p_id, jsonb_build_object('review_status', p_status)
  from public.projects p where p.id = submission.project_id;
  select * into submission from public.submissions where id = p_id;
  return jsonb_build_object(
    'id', submission.id,
    'project_id', submission.project_id,
    'form_id', submission.form_id,
    'form_version_id', submission.form_version_id,
    'collector_id', submission.collector_id,
    'answers', submission.answers,
    'location', submission.location,
    'client_captured_at', submission.client_captured_at,
    'server_received_at', submission.server_received_at,
    'payload_hash', submission.payload_hash,
    'ingestion_status', submission.ingestion_status,
    'review_status', submission.review_status
  );
end;
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.forms enable row level security;
alter table public.form_versions enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_attachments enable row level security;
alter table public.map_packages enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy profiles_update on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy organizations_select on public.organizations for select to authenticated
using (public.is_org_member(id));

create policy organization_members_select on public.organization_members for select to authenticated
using (public.is_org_member(organization_id));

create policy projects_select on public.projects for select to authenticated
using (public.is_project_member(id));
create policy project_members_select on public.project_members for select to authenticated
using (public.is_project_member(project_id));

create policy forms_select on public.forms for select to authenticated
using (public.is_project_member(project_id));
create policy forms_insert on public.forms for insert to authenticated
with check (public.project_role_at_least(project_id, 'researcher') and created_by = auth.uid());
create policy forms_update on public.forms for update to authenticated
using (public.project_role_at_least(project_id, 'researcher'))
with check (public.project_role_at_least(project_id, 'researcher'));

create policy form_versions_select on public.form_versions for select to authenticated
using (public.is_project_member(project_id));

create policy submissions_select on public.submissions for select to authenticated
using (
  public.is_project_member(project_id)
  and (
    ingestion_status = 'complete'
    or collector_id = auth.uid()
    or public.project_role_at_least(project_id, 'researcher')
  )
);
create policy attachments_select on public.submission_attachments for select to authenticated
using (public.is_project_member(project_id));
create policy map_packages_select on public.map_packages for select to authenticated
using (public.is_project_member(project_id));
create policy audit_select on public.audit_events for select to authenticated
using (public.current_org_role(organization_id) in ('owner', 'admin'));

create view public.organization_directory
with (security_invoker = true) as
select o.id, o.name, m.role
from public.organizations o
join public.organization_members m on m.organization_id = o.id
where m.user_id = auth.uid();

create view public.organization_member_directory
with (security_invoker = true) as
select m.organization_id, m.user_id, p.email, p.display_name, m.role
from public.organization_members m
join public.profiles p on p.id = m.user_id;

create view public.project_directory
with (security_invoker = true) as
select p.id, p.organization_id, p.name, p.description, m.role
from public.projects p
join public.project_members m on m.project_id = p.id
where m.user_id = auth.uid();

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on public.organization_directory, public.organization_member_directory, public.project_directory to authenticated, service_role;
grant usage on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

revoke insert, update, delete on public.form_versions from anon, authenticated;
revoke insert, update, delete on public.submissions from anon, authenticated;
revoke insert, update, delete on public.submission_attachments from anon, authenticated;
revoke insert, update, delete on public.organization_members from anon, authenticated;
revoke insert, update, delete on public.organizations from anon, authenticated;
revoke insert, update, delete on public.projects from anon, authenticated;
revoke insert, update, delete on public.project_members from anon, authenticated;
revoke insert, update, delete on public.audit_events from anon, authenticated;
revoke insert, update, delete on public.map_packages from anon, authenticated;
revoke all on function public.test_failing_org_creation(uuid) from public, anon, authenticated;
revoke all on all tables in schema public from anon;

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false), ('map-packages', 'map-packages', false)
on conflict (id) do update set public = false;

create or replace function public.storage_project_id(object_name text)
returns uuid
language plpgsql
stable
as $$
declare
  folder text;
begin
  folder := (storage.foldername(object_name))[1];
  if folder is null then
    return null;
  end if;
  return folder::uuid;
exception
  when others then
    return null;
end;
$$;

create policy attachments_read on storage.objects for select to authenticated
using (
  bucket_id = 'attachments'
  and public.is_project_member(public.storage_project_id(name))
);
create policy attachments_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'attachments'
  and public.project_role_at_least(public.storage_project_id(name), 'fieldworker')
);
create policy attachments_update on storage.objects for update to authenticated
using (
  bucket_id = 'attachments'
  and public.project_role_at_least(public.storage_project_id(name), 'fieldworker')
);
create policy map_read on storage.objects for select to authenticated
using (
  bucket_id = 'map-packages'
  and public.is_project_member(public.storage_project_id(name))
);
create policy map_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'map-packages'
  and public.project_role_at_least(public.storage_project_id(name), 'researcher')
);
