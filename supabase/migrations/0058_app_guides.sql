-- How-to knowledge base for the in-app assistant (FLOW 6 v2 Fase 2). Single row (id=1) holding the
-- curated corpus, grounded in real app code. Read by the `assistant` edge (service-role); editable via
-- the `corpus-load` edge without a redeploy. Not exposed to anon (RLS on, no policies; service-role bypasses).
create table if not exists public.app_guides (
  id int primary key default 1,
  content text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.app_guides (id, content) values (1, '') on conflict (id) do nothing;
alter table public.app_guides enable row level security;
revoke all on public.app_guides from anon, authenticated;
