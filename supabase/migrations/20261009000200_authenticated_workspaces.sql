alter table public.workspaces
  add column created_by_user_id uuid references auth.users(id) on delete cascade;

create unique index workspaces_created_by_user_idx
on public.workspaces (created_by_user_id)
where created_by_user_id is not null;

create index workspace_members_user_workspace_idx
on public.workspace_members (user_id, workspace_id);

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select auth.uid())
  );
$$;
